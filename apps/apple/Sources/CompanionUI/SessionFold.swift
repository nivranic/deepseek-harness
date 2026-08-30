import Foundation
import SharedAppleRemoteCore

/// The companion domain state both languages fold identically: the
/// generated `conformance/<id>.json` fixtures carry this shape as
/// `expected`, produced by the TypeScript reference fold — the
/// chapter-62 guarantee that the same records reach the same state in
/// every runtime.
public struct CompanionDomainState: Codable, Equatable {
    /// One folded timeline row: the record tag plus its rendered summary.
    public struct Item: Codable, Equatable, Identifiable {
        public let seq: Double
        public let kind: String
        public let text: String

        public init(seq: Double, kind: String, text: String) {
            self.seq = seq
            self.kind = kind
            self.text = text
        }

        public var id: String { "\(Int(seq))-\(kind)" }
    }

    /// One folded todo row; the wire status rides verbatim.
    public struct Todo: Codable, Equatable {
        public let text: String
        public let status: String

        public init(text: String, status: String) {
            self.text = text
            self.status = status
        }
    }

    /// One folded goal row; the wire phase rides verbatim.
    public struct Goal: Codable, Equatable, Identifiable {
        public let id: String
        public let title: String
        public let state: String

        public init(id: String, title: String, state: String) {
            self.id = id
            self.title = title
            self.state = state
        }
    }

    /// One folded tool invocation, paired across the wire by `callId`.
    public struct ToolCall: Codable, Equatable, Identifiable {
        /// Lifecycle of one invocation on the wire.
        public enum Phase: String, Codable {
            case running
            case completed
            case failed
        }

        public let id: String
        public let seq: Double
        public let name: String
        public let arguments: String
        public let phase: Phase
        public let resultText: String

        public init(
            id: String, seq: Double, name: String, arguments: String,
            phase: Phase = .running, resultText: String = ""
        ) {
            self.id = id
            self.seq = seq
            self.name = name
            self.arguments = arguments
            self.phase = phase
            self.resultText = resultText
        }
    }

    public var cursor: Double
    public var items: [Item]
    public var planActive: Bool
    public var todos: [Todo]
    public var goals: [Goal]
    public var toolCalls: [ToolCall]

    public init(
        cursor: Double = 0,
        items: [Item] = [],
        planActive: Bool = false,
        todos: [Todo] = [],
        goals: [Goal] = [],
        toolCalls: [ToolCall] = []
    ) {
        self.cursor = cursor
        self.items = items
        self.planActive = planActive
        self.todos = todos
        self.goals = goals
        self.toolCalls = toolCalls
    }

    /// The state before any record arrives.
    public static let empty = CompanionDomainState()
}

/// Pure fold of follow records into the companion domain state — the Swift
/// half of the domain-state conformance. Whole-value pane states are
/// last-write-wins; the trajectory pairs calls with results by `callId` and
/// tolerates orphan results as no-ops; unknown tags render as marker rows.
public struct CompanionSessionFold {
    /// The folded state; every ingest mutates it in place.
    public private(set) var state: CompanionDomainState

    public init() {
        state = .empty
    }

    /// Drop the folded state back to empty (a new snapshot generation or a
    /// freshly opened session).
    public mutating func reset() {
        state = .empty
    }

    /// Fold one wire record — `{type: "event"|"chunks", event: {…}}` —
    /// decoding known payloads through the generated contract models.
    /// Records whose envelope is missing are no-ops.
    public mutating func ingest(_ record: WireValue) {
        guard let event = WireShape.object(record, field: "event") else { return }
        let tag = WireShape.string(event, field: "type") ?? "event"
        let seq = WireShape.number(event, field: "seq") ?? 0
        let data = WireShape.object(event, field: "data") ?? .null
        state.cursor = max(state.cursor, seq)
        state.items.append(CompanionDomainState.Item(
            seq: seq,
            kind: tag,
            text: Self.renderEvent(tag: tag, data: data)
        ))
        switch tag {
        case "plan/mode":
            if let payload = ContractCodec.decode(LinkPlanModeData.self, from: data) {
                state.planActive = payload.active
            }
        case "todo/write":
            if let payload = ContractCodec.decode(LinkTodoWriteData.self, from: data) {
                state.todos = payload.todos.map { todo in
                    CompanionDomainState.Todo(text: todo.content, status: todo.status.rawValue)
                }
            }
        case "goal/change":
            if let payload = ContractCodec.decode(LinkGoalChangeData.self, from: data) {
                if let goal = payload.goal {
                    state.goals = [
                        CompanionDomainState.Goal(
                            id: goal.id,
                            title: goal.objective,
                            state: goal.phase.rawValue
                        ),
                    ]
                } else {
                    state.goals = []
                }
            }
        case "tool/call":
            if let payload = ContractCodec.decode(LinkToolCallData.self, from: data) {
                state.toolCalls.append(CompanionDomainState.ToolCall(
                    id: payload.callId,
                    seq: seq,
                    name: payload.name,
                    arguments: payload.arguments
                ))
            }
        case "tool/result":
            if let payload = ContractCodec.decode(LinkToolResultData.self, from: data),
               let callId = payload.message.content.first?.toolCallId,
               let index = state.toolCalls.firstIndex(where: { $0.id == callId }) {
                state.toolCalls[index] = CompanionDomainState.ToolCall(
                    id: state.toolCalls[index].id,
                    seq: state.toolCalls[index].seq,
                    name: state.toolCalls[index].name,
                    arguments: state.toolCalls[index].arguments,
                    phase: payload.error == nil ? .completed : .failed,
                    resultText: Self.blockText(payload.message.content)
                )
            }
        default:
            break
        }
    }

    /// Per-tag summary through the contract models: identical strings to
    /// the TypeScript reference fold, pinned by the conformance fixtures.
    static func renderEvent(tag: String, data: WireValue) -> String {
        switch tag {
        case "turn/start":
            guard let payload = ContractCodec.decode(LinkTurnStartData.self, from: data) else { return "" }
            return "第 \(Int(payload.turn)) 轮开始"
        case "turn/end":
            guard let payload = ContractCodec.decode(LinkTurnEndData.self, from: data) else { return "" }
            return turnEndSummary(payload)
        case "step/start", "step/end", "session/end-seed":
            return ""
        case "user/message":
            guard let payload = ContractCodec.decode(LinkUserMessageData.self, from: data) else { return "" }
            return blockText(payload.content)
        case "assistant/chunk":
            guard let payload = ContractCodec.decode(LinkAssistantChunkData.self, from: data) else { return "" }
            return payload.chunk.text ?? ""
        case "assistant/message":
            guard let payload = ContractCodec.decode(LinkAssistantMessageData.self, from: data) else { return "" }
            let base = blockText(payload.message.content)
            return payload.interrupted == true && !base.isEmpty ? "\(base)（已中断）" : base
        case "tool/call":
            guard let payload = ContractCodec.decode(LinkToolCallData.self, from: data) else { return "" }
            return "调用工具 \(payload.name)"
        case "tool/result":
            guard let payload = ContractCodec.decode(LinkToolResultData.self, from: data) else { return "" }
            if let error = payload.error { return "工具失败：\(error.name)" }
            return blockText(payload.message.content)
        case "plan/mode":
            guard let payload = ContractCodec.decode(LinkPlanModeData.self, from: data) else { return "" }
            return payload.active ? "进入计划模式" : "退出计划模式"
        case "todo/write":
            guard let payload = ContractCodec.decode(LinkTodoWriteData.self, from: data) else { return "" }
            return "更新待办（\(payload.todos.count) 项）"
        case "goal/change":
            guard let payload = ContractCodec.decode(LinkGoalChangeData.self, from: data) else { return "" }
            if let goal = payload.goal { return "目标：\(goal.objective)" }
            return "目标已清除"
        case "chunkrow/text-chunks", "chunkrow/reasoning-chunks":
            guard let payload = ContractCodec.decode(LinkTextChunksData.self, from: data) else { return "" }
            return payload.texts.joined()
        case "chunkrow/tool-call-chunks":
            return ""
        default:
            return ""
        }
    }

    private static func turnEndSummary(_ payload: LinkTurnEndData) -> String {
        let turn = Int(payload.turn)
        switch payload.reason.kind {
        case .completed: return "第 \(turn) 轮完成"
        case .aborted: return "第 \(turn) 轮已中止"
        case .blocked: return "第 \(turn) 轮被阻断"
        case .error: return "第 \(turn) 轮出错"
        case .maxTokens: return "第 \(turn) 轮达到输出上限"
        case .interrupted: return "第 \(turn) 轮因中断收尾"
        }
    }

    /// Visible text of a content-block list: text and reasoning blocks carry
    /// it; tool-result blocks carry it one level deeper.
    static func blockText(_ blocks: [LinkContentBlock]) -> String {
        blocks.map { block -> String in
            if let text = block.text { return text }
            if let nested = block.content { return blockText(nested) }
            return ""
        }
        .filter { !$0.isEmpty }
        .joined(separator: "\n")
    }
}
