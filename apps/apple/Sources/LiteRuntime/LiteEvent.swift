import Foundation

/// One Native Harness Lite lifecycle event (the Lite Behavior Spec's
/// vocabulary): decoded from the golden fixtures' JSON and folded into the
/// runtime's domain state. The union discriminates on `type`.
public enum LiteEvent: Equatable {
    case promptAccepted(requestId: String, content: String)
    case promptRejected(requestId: String, reason: String)
    case streamDelta(text: String)
    case streamReasoning(text: String)
    case messageCompleted(text: String, usage: LiteUsage?)
    case turnCompleted
    case turnCancelled(reason: String)
    case toolCall(id: String, name: String, arguments: String)
    case toolResult(id: String, ok: Bool, text: String)
    case planChanged(active: Bool)
    case todoChanged(todos: [LiteTodo])
    case artifactCreated(id: String, kind: String, title: String)
    case artifactStatus(id: String, status: LiteArtifactStatus)
    case providerError(code: String, message: String)
    case networkError(kind: String)
    case handoffRequested(capability: String)
}

/// Token accounting a completed message may carry.
public struct LiteUsage: Equatable, Decodable {
    public let inputTokens: Double
    public let outputTokens: Double
}

/// One whole-list todo entry.
public struct LiteTodo: Equatable, Decodable {
    public let content: String
    public let status: String
}

/// Artifact lifecycle; content never rides the spec.
public enum LiteArtifactStatus: String, Equatable, Decodable {
    case pending
    case ready
    case failed
}

extension LiteEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, requestId, content, reason, text, usage
        case id, name, arguments, ok
        case active, todos, kind, title, status
        case code, message, capability
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        func field(_ key: CodingKeys) throws -> String { try container.decode(String.self, forKey: key) }
        switch type {
        case "prompt/accepted": self = .promptAccepted(requestId: try field(.requestId), content: try field(.content))
        case "prompt/rejected": self = .promptRejected(requestId: try field(.requestId), reason: try field(.reason))
        case "stream/delta": self = .streamDelta(text: try field(.text))
        case "stream/reasoning": self = .streamReasoning(text: try field(.text))
        case "message/completed":
            self = .messageCompleted(
                text: try field(.text),
                usage: try container.decodeIfPresent(LiteUsage.self, forKey: .usage)
            )
        case "turn/completed": self = .turnCompleted
        case "turn/cancelled": self = .turnCancelled(reason: try field(.reason))
        case "tool/call": self = .toolCall(id: try field(.id), name: try field(.name), arguments: try field(.arguments))
        case "tool/result": self = .toolResult(id: try field(.id), ok: try container.decode(Bool.self, forKey: .ok), text: try field(.text))
        case "plan/changed": self = .planChanged(active: try container.decode(Bool.self, forKey: .active))
        case "todo/changed": self = .todoChanged(todos: try container.decode([LiteTodo].self, forKey: .todos))
        case "artifact/created": self = .artifactCreated(id: try field(.id), kind: try field(.kind), title: try field(.title))
        case "artifact/status": self = .artifactStatus(id: try field(.id), status: try container.decode(LiteArtifactStatus.self, forKey: .status))
        case "provider/error": self = .providerError(code: try field(.code), message: try field(.message))
        case "network/error": self = .networkError(kind: try field(.kind))
        case "handoff/requested": self = .handoffRequested(capability: try field(.capability))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "unknown Lite event type \(type)")
        }
    }
}
