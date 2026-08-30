import Foundation
import Observation
import SharedAppleRemoteCore

/// One session row as the companion lists it.
public struct SessionRow: Identifiable, Equatable {
    public let id: String
    public let title: String
    public let updatedAt: Double?

    public init(id: String, title: String, updatedAt: Double?) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
    }
}

/// One timeline item in the open session: a history record from the follow
/// snapshot or a live event appended after it. `kind` carries the wire's
/// record tag verbatim (`user/message`, `chunkrow/text-chunks`, …); `text`
/// carries the per-event summary the contract models decoded.
public struct SessionItem: Identifiable, Equatable {
    public let id: String
    public let seq: Double
    public let kind: String
    public let text: String
}

/// The open session's projected state.
public struct ActiveSession: Equatable {
    public let sessionId: String
    public var items: [SessionItem]
    public var cursor: Double
    public var streaming: Bool
}

/// Session-slice state machine over the wire: list sessions, open one, fold
/// the follow stream's snapshot and live events into a timeline rendered
/// through the session-event contract models, track the plan/todo/goal pane
/// state from the same records, send prompts, cancel, and resubscribe after
/// a carrier loss with the last cursor — the reconnect the reference client
/// prescribes.
@MainActor
@Observable
public final class RemoteSessionViewModel {
    /// Sessions list state.
    public private(set) var sessions: [SessionRow] = []
    public private(set) var listState: LoadState = .idle

    /// The currently open session, when one is.
    public private(set) var active: ActiveSession?

    /// Plan / Todo / Goal pane state folded from the same records as the
    /// timeline; whole-value states, so the fold is last-write-wins.
    public private(set) var planTodoGoal = PlanTodoGoalSnapshot.empty

    /// The prompt submission state for the composer.
    public private(set) var sending = false

    /// Reconnect bookkeeping for the open follow stream.
    public private(set) var reconnecting = false

    public enum LoadState: Equatable {
        case idle
        case loading
        case ready
        case failed(String)
    }

    private let wire: any CompanionWireDriving
    private var followTask: Task<Void, Never>?
    private var reconnectAttempt = 0

    /// - Parameter wire: the wire driver; tests pass a fake.
    public init(wire: any CompanionWireDriving) {
        self.wire = wire
    }

    deinit {
        followTask?.cancel()
    }

    /// Load the session list.
    public func loadSessions() async {
        listState = .loading
        do {
            let value = try await wire.call("session/list", args: ["_request": .object([:])])
            sessions = Self.projectSessionRows(value)
            listState = .ready
        } catch {
            listState = .failed(Self.message(of: error))
        }
    }

    /// Open one session and follow it: the snapshot seeds the timeline, live
    /// events append, and the cursor tracks the last seen seq.
    public func open(sessionId: String) async {
        followTask?.cancel()
        active = ActiveSession(sessionId: sessionId, items: [], cursor: 0, streaming: true)
        planTodoGoal = .empty
        await follow(sessionId: sessionId, cursor: 0)
    }

    /// Close the open session and stop following.
    public func close() {
        followTask?.cancel()
        followTask = nil
        active = nil
    }

    /// Submit one user prompt in queue mode.
    public func send(text: String) async {
        guard let active, !text.isEmpty else { return }
        sending = true
        defer { sending = false }
        let requestId = "companion-\(UUID().uuidString)"
        _ = try? await wire.call("session/prompt", args: [
            "requestId": .string(requestId),
            "sessionId": .string(active.sessionId),
            "mode": .string("queue"),
            "content": .array([.object(["type": .string("text"), "text": .string(text)])]),
        ])
    }

    /// Cancel the open session's in-flight work.
    public func cancelActive() async {
        guard let active else { return }
        _ = try? await wire.call("session/cancel", args: [
            "sessionId": .string(active.sessionId),
        ])
    }

    /// Resubscribe the open session from its last cursor after a loss.
    public func reconnect() async {
        guard let current = active else { return }
        reconnecting = true
        reconnectAttempt += 1
        await follow(sessionId: current.sessionId, cursor: current.cursor)
        reconnecting = false
    }

    // MARK: - Internals

    private func follow(sessionId: String, cursor: Double) async {
        followTask?.cancel()
        followTask = Task { [weak self] in
            guard let self else { return }
            do {
                let frames = try await self.wire.stream("session/follow", payload: [
                    "sessionId": .string(sessionId),
                    "cursor": .number(cursor),
                ])
                for try await frame in frames {
                    await self.fold(frame)
                }
                // A clean end is still a loss for a follow: resubscribe.
                await self.scheduleReconnect()
            } catch is CancellationError {
                // Deliberate close; nothing to do.
            } catch {
                await self.scheduleReconnect()
            }
        }
    }

    private func scheduleReconnect() async {
        guard active != nil else { return }
        reconnecting = true
        let delay = Double(min(reconnectAttempt, 5))
        try? await Task.sleep(for: .seconds(delay))
        await reconnect()
    }

    /// Fold one follow frame into the open session's timeline.
    private func fold(_ frame: WireValue) async {
        guard active != nil else { return }
        let kind = WireShape.string(frame, field: "type") ?? ""
        if kind == "snapshot" {
            let records = WireShape.array(frame, field: "records") ?? []
            var items: [SessionItem] = []
            for record in records {
                if let item = ingest(record) { items.append(item) }
            }
            let cursor = WireShape.number(frame, field: "cursor") ?? active?.cursor ?? 0
            apply { current in
                current.items = items
                current.cursor = cursor
                current.streaming = true
            }
            return
        }
        if let item = ingest(frame) {
            apply { current in
                current.items.append(item)
                current.cursor = max(current.cursor, item.seq)
            }
        }
    }

    private func apply(_ mutate: (inout ActiveSession) -> Void) {
        guard active != nil else { return }
        mutate(&active!)
    }

    /// Project one session row from `session/list`'s value.
    static func projectSessionRows(_ value: WireValue) -> [SessionRow] {
        let items = WireShape.array(value, field: "items") ?? []
        return items.compactMap { item in
            guard let id = WireShape.string(item, field: "sessionId") else { return nil }
            let title = WireShape.string(item, field: "title") ?? id
            let updatedAt = WireShape.number(item, field: "updatedAt")
            return SessionRow(id: id, title: title, updatedAt: updatedAt)
        }
    }

    /// Decode one history record or live event entry (`{type: "event"|"chunks",
    /// event: {…}}`) into a timeline item, folding the plan/todo/goal pane
    /// state from the same payload. Unknown tags render as marker rows.
    private func ingest(_ record: WireValue) -> SessionItem? {
        guard let event = WireShape.object(record, field: "event") else { return nil }
        let tag = WireShape.string(event, field: "type") ?? "event"
        let seq = WireShape.number(event, field: "seq") ?? 0
        let data = WireShape.object(event, field: "data") ?? .null
        foldPaneState(tag: tag, data: data)
        return SessionItem(
            id: "\(Int(seq))-\(tag)",
            seq: seq,
            kind: tag,
            text: Self.renderEvent(tag: tag, data: data)
        )
    }

    /// Last-write-wins fold of the pane's whole-value states.
    private func foldPaneState(tag: String, data: WireValue) {
        switch tag {
        case "plan/mode":
            if let payload = ContractCodec.decode(LinkPlanModeData.self, from: data) {
                planTodoGoal.planActive = payload.active
            }
        case "todo/write":
            if let payload = ContractCodec.decode(LinkTodoWriteData.self, from: data) {
                planTodoGoal.todos = payload.todos.enumerated().map { index, todo in
                    PlanTodoGoalSnapshot.TodoItem(
                        id: "\(index)",
                        text: todo.content,
                        status: todo.status.rawValue
                    )
                }
            }
        case "goal/change":
            if let payload = ContractCodec.decode(LinkGoalChangeData.self, from: data) {
                if let goal = payload.goal {
                    planTodoGoal.goals = [
                        PlanTodoGoalSnapshot.GoalRecord(
                            id: goal.id,
                            title: goal.objective,
                            state: goal.phase.rawValue
                        ),
                    ]
                } else {
                    planTodoGoal.goals = []
                }
            }
        default:
            break
        }
    }

    /// Per-event summary through the contract models: the fine-grained
    /// rendering the timeline shows under each record's tag.
    static func renderEvent(tag: String, data: WireValue) -> String {
        switch tag {
        case "turn/start":
            guard let payload = ContractCodec.decode(LinkTurnStartData.self, from: data) else { return "" }
            return "第 \(Int(payload.turn)) 轮开始"
        case "turn/end":
            guard let payload = ContractCodec.decode(LinkTurnEndData.self, from: data) else { return "" }
            return turnEndSummary(payload)
        case "step/start", "step/end":
            return ""
        case "user/message":
            guard let payload = ContractCodec.decode(LinkUserMessageData.self, from: data) else { return "" }
            return Self.blockText(payload.content)
        case "assistant/chunk":
            guard let payload = ContractCodec.decode(LinkAssistantChunkData.self, from: data) else { return "" }
            return payload.chunk.text ?? ""
        case "assistant/message":
            guard let payload = ContractCodec.decode(LinkAssistantMessageData.self, from: data) else { return "" }
            let base = Self.blockText(payload.message.content)
            return payload.interrupted == true && !base.isEmpty ? "\(base)（已中断）" : base
        case "tool/call":
            guard let payload = ContractCodec.decode(LinkToolCallData.self, from: data) else { return "" }
            return "调用工具 \(payload.name)"
        case "tool/result":
            guard let payload = ContractCodec.decode(LinkToolResultData.self, from: data) else { return "" }
            if let error = payload.error { return "工具失败：\(error.name)" }
            return Self.blockText(payload.message.content)
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

    static func message(of error: Error) -> String {
        if let linkError = error as? LinkClientError {
            switch linkError {
            case .carrier(let status, let message): return "carrier \(status): \(message)"
            case .unpaired: return "not paired with a host"
            case .refused(let code, let message): return "\(code): \(message)"
            case .badWire(let detail): return "bad wire: \(detail)"
            }
        }
        return String(describing: error)
    }
}
