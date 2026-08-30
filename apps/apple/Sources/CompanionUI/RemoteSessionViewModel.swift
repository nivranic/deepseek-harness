import Foundation
import Observation

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
/// record/event type verbatim; `text` carries the summary the generic
/// projection could extract.
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
/// the follow stream's snapshot and live events into a timeline, send
/// prompts, cancel, and resubscribe after a carrier loss with the last
/// cursor — the reconnect the reference client prescribes.
@MainActor
@Observable
public final class RemoteSessionViewModel {
    /// Sessions list state.
    public private(set) var sessions: [SessionRow] = []
    public private(set) var listState: LoadState = .idle

    /// The currently open session, when one is.
    public private(set) var active: ActiveSession?

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
        let kind = WireShape.string(frame, field: "type") ?? "record"
        if kind == "snapshot" {
            let records = WireShape.array(frame, field: "records") ?? []
            var items: [SessionItem] = []
            for record in records {
                if let item = Self.projectItem(record) { items.append(item) }
            }
            let cursor = WireShape.number(frame, field: "cursor") ?? active?.cursor ?? 0
            apply { current in
                current.items = items
                current.cursor = cursor
                current.streaming = true
            }
            return
        }
        if let item = Self.projectItem(frame) {
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

    /// Project one timeline item from a history record or event entry.
    static func projectItem(_ value: WireValue) -> SessionItem? {
        guard let seq = WireShape.number(value, field: "seq") else { return nil }
        let kind = WireShape.string(value, field: "type") ?? "entry"
        let event = WireShape.string(value, field: "event") ?? ""
        let summary = Self.summary(of: value)
        return SessionItem(
            id: "\(Int(seq))-\(kind)-\(event)",
            seq: seq,
            kind: event.isEmpty ? kind : "\(kind)/\(event)",
            text: summary
        )
    }

    /// Best-effort text extraction from a record or event payload: the
    /// first textual content the generic projection can find. Refined
    /// per-event rendering lands with the session-event contract models.
    static func summary(of value: WireValue) -> String {
        if let text = WireShape.string(value, field: "text") { return text }
        for field in ["content", "message", "payload", "value"] {
            if let nested = WireShape.object(value, field: field) {
                let inner = summary(of: nested)
                if !inner.isEmpty { return inner }
                if case .array(let items) = (WireShape.object(value, field: field) ?? .null) {
                    for item in items {
                        let text = summary(of: item)
                        if !text.isEmpty { return text }
                    }
                }
            }
        }
        if case .string(let text) = value { return text }
        return ""
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
