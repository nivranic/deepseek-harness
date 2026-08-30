import Foundation

/// One completed conversation row.
public struct LiteMessage: Equatable, Decodable {
    public let role: String
    public let text: String
    public let interrupted: Bool?

    public init(role: String, text: String, interrupted: Bool? = nil) {
        self.role = role
        self.text = text
        self.interrupted = interrupted
    }
}

/// One paired tool invocation.
public struct LiteToolRecord: Equatable, Decodable {
    public enum Phase: String, Equatable, Decodable {
        case running, completed, failed
    }

    public let id: String
    public let name: String
    public let arguments: String
    public let phase: Phase
    public let resultText: String

    public init(id: String, name: String, arguments: String, phase: Phase, resultText: String) {
        self.id = id
        self.name = name
        self.arguments = arguments
        self.phase = phase
        self.resultText = resultText
    }
}

/// One artifact reference — metadata only, never content.
public struct LiteArtifactRecord: Equatable, Decodable {
    public let id: String
    public let kind: String
    public let title: String
    public let status: LiteArtifactStatus

    public init(id: String, kind: String, title: String, status: LiteArtifactStatus) {
        self.id = id
        self.kind = kind
        self.title = title
        self.status = status
    }
}

/// One recorded failure.
public struct LiteFailureRecord: Equatable, Decodable {
    public let kind: String
    public let code: String
    public let message: String
}

/// Why a Lite turn ended.
public enum LiteTurnEnd: String, Equatable, Decodable {
    case completed
    case cancelled
    case providerError = "provider-error"
    case networkError = "network-error"
}

/// The complete Lite-visible runtime state at one event cut — JSON-keyed to
/// the TypeScript reference fold's emission.
public struct LiteDomainState: Equatable, Decodable {
    public struct Streaming: Equatable, Decodable {
        public var active: Bool
        public var partialText: String
        public var partialReasoning: String

        public init(active: Bool = false, partialText: String = "", partialReasoning: String = "") {
            self.active = active
            self.partialText = partialText
            self.partialReasoning = partialReasoning
        }
    }

    public var conversation: [LiteMessage]
    public var streaming: Streaming
    public var interrupted: Bool
    public var toolCalls: [LiteToolRecord]
    public var planActive: Bool
    public var todos: [LiteTodo]
    public var artifacts: [LiteArtifactRecord]
    public var lastTurnEnd: LiteTurnEnd?
    public var errors: [LiteFailureRecord]
    public var pendingHandoff: String?

    public init(
        conversation: [LiteMessage] = [], streaming: Streaming = Streaming(active: false, partialText: "", partialReasoning: ""),
        interrupted: Bool = false, toolCalls: [LiteToolRecord] = [], planActive: Bool = false,
        todos: [LiteTodo] = [], artifacts: [LiteArtifactRecord] = [], lastTurnEnd: LiteTurnEnd? = nil,
        errors: [LiteFailureRecord] = [], pendingHandoff: String? = nil
    ) {
        self.conversation = conversation
        self.streaming = streaming
        self.interrupted = interrupted
        self.toolCalls = toolCalls
        self.planActive = planActive
        self.todos = todos
        self.artifacts = artifacts
        self.lastTurnEnd = lastTurnEnd
        self.errors = errors
        self.pendingHandoff = pendingHandoff
    }
}

/// The Swift half of the Lite Behavior Spec: folds lifecycle events into
/// the domain state with exactly the TypeScript reference's semantics — a
/// cancel finalizes the delivered stream prefix as an interrupted assistant
/// row, a network drop stops the stream but keeps the partial, a provider
/// error clears streaming and sets the terminal outcome.
public struct LiteFold {
    public private(set) var state: LiteDomainState

    public init() {
        state = LiteDomainState()
    }

    /// Fold one lifecycle event.
    public mutating func apply(_ event: LiteEvent) {
        switch event {
        case .promptAccepted(_, let content):
            state.conversation.append(LiteMessage(role: "user", text: content))
        case .promptRejected(_, let reason):
            state.errors.append(LiteFailureRecord(kind: "provider", code: "PROMPT_REJECTED", message: reason))
        case .streamDelta(let text):
            state.streaming.active = true
            state.streaming.partialText += text
        case .streamReasoning(let text):
            state.streaming.active = true
            state.streaming.partialReasoning += text
        case .messageCompleted(let text, _):
            state.conversation.append(LiteMessage(role: "assistant", text: text))
            state.streaming = .init(active: false, partialText: "", partialReasoning: "")
        case .turnCompleted:
            state.lastTurnEnd = .completed
        case .turnCancelled:
            if state.streaming.active && !state.streaming.partialText.isEmpty {
                state.conversation.append(LiteMessage(role: "assistant", text: state.streaming.partialText, interrupted: true))
                state.interrupted = true
            }
            state.streaming = .init(active: false, partialText: "", partialReasoning: "")
            state.lastTurnEnd = .cancelled
        case .toolCall(let id, let name, let arguments):
            state.toolCalls.append(LiteToolRecord(id: id, name: name, arguments: arguments, phase: .running, resultText: ""))
        case .toolResult(let id, let ok, let text):
            guard let index = state.toolCalls.firstIndex(where: { $0.id == id }) else { return }
            let call = state.toolCalls[index]
            state.toolCalls[index] = LiteToolRecord(
                id: call.id, name: call.name, arguments: call.arguments,
                phase: ok ? .completed : .failed, resultText: text
            )
        case .planChanged(let active):
            state.planActive = active
        case .todoChanged(let todos):
            state.todos = todos
        case .artifactCreated(let id, let kind, let title):
            state.artifacts.append(LiteArtifactRecord(id: id, kind: kind, title: title, status: .pending))
        case .artifactStatus(let id, let status):
            if let index = state.artifacts.firstIndex(where: { $0.id == id }) {
                let record = state.artifacts[index]
                state.artifacts[index] = LiteArtifactRecord(id: record.id, kind: record.kind, title: record.title, status: status)
            }
        case .providerError(let code, let message):
            state.errors.append(LiteFailureRecord(kind: "provider", code: code, message: message))
            state.streaming = .init(active: false, partialText: "", partialReasoning: "")
            state.lastTurnEnd = .providerError
        case .networkError(let kind):
            state.streaming.active = false
            state.errors.append(LiteFailureRecord(kind: "network", code: kind, message: kind))
            state.lastTurnEnd = .networkError
        case .handoffRequested(let capability):
            state.pendingHandoff = capability
        }
    }
}
