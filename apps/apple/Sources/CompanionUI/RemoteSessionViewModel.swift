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

    public init(id: String, seq: Double, kind: String, text: String) {
        self.id = id
        self.seq = seq
        self.kind = kind
        self.text = text
    }
}

/// The open session's projected state; `items` mirrors the pure fold's
/// timeline rows for the list view.
public struct ActiveSession: Equatable {
    public let sessionId: String
    public var items: [SessionItem]
    public var cursor: Double
    public var streaming: Bool
}

/// One image the composer attaches to a prompt: the upload half of the
/// attachment surface, carried inline on `session/prompt` as base64.
public struct CompanionImageUpload: Sendable {
    public let mediaType: String
    public let base64: String
    public let name: String?

    public init(mediaType: String, base64: String, name: String? = nil) {
        self.mediaType = mediaType
        self.base64 = base64
        self.name = name
    }
}

/// Session-slice state machine over the wire: list sessions, open one, fold
/// the follow stream's snapshot and live events through the pure
/// domain-state fold (the conformance-tested companion projection), send
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

    /// The pure fold owning the open session's domain state; the pane and
    /// trajectory projections below read it live.
    private var sessionFold = CompanionSessionFold()

    /// Plan / Todo / Goal pane state projected from the fold.
    public var planTodoGoal: PlanTodoGoalSnapshot {
        PlanTodoGoalSnapshot(
            planActive: sessionFold.state.planActive,
            todos: sessionFold.state.todos.enumerated().map { index, todo in
                PlanTodoGoalSnapshot.TodoItem(id: "\(index)", text: todo.text, status: todo.status)
            },
            goals: sessionFold.state.goals.map { goal in
                PlanTodoGoalSnapshot.GoalRecord(id: goal.id, title: goal.title, state: goal.state)
            }
        )
    }

    /// Tool trajectory of the open session, straight from the fold.
    public var toolCalls: [CompanionDomainState.ToolCall] {
        sessionFold.state.toolCalls
    }

    /// Image references the folded log mentions, in first-appearance order;
    /// `readAttachment(_:)` fills the byte cache these rows render from.
    public var images: [CompanionDomainState.ImageRef] {
        sessionFold.state.images
    }

    /// Artifact references the folded log carries (chapter 56): metadata
    /// and status only; content never rides this pane.
    public var artifacts: [CompanionDomainState.Artifact] {
        sessionFold.state.artifacts
    }

    /// The prompt submission state for the composer.
    public private(set) var sending = false

    /// Image bytes fetched by attachment id, the download half of the
    /// attachment surface; the fold's inline summary names the reference.
    public private(set) var attachments: [String: Data] = [:]
    /** Decoded artifact content by reference id; the pane renders from it. */
    public private(set) var artifactBytes: [String: Data] = [:]

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
    /** Parent of an open subagent child, for resubscribing by address. */
    private var reconnectParent: String?
    private var reconnectMode: String = "continuable"

    /// - Parameter wire: the wire driver; tests pass a fake.
    public init(wire: any CompanionWireDriving) {
        self.wire = wire
    }

    deinit {
        // The view model is main-actor-bound by construction; its deinit
        // runs nonisolated, so the cancel borrows the isolation it knows holds.
        MainActor.assumeIsolated { followTask?.cancel() }
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
        sessionFold.reset()
        active = ActiveSession(sessionId: sessionId, items: [], cursor: 0, streaming: true)
        reconnectParent = nil
        await followAddress(["kind": .string("session"), "sessionId": .string(sessionId)])
    }

    /// Open one subagent child's timeline read-only: the same follow stream
    /// addressed to the durable parent/child pair. The fold is unchanged —
    /// a child's records speak the same session-event vocabulary.
    public func openSubagent(parentSessionId: String, childSessionId: String, mode: String) async {
        followTask?.cancel()
        sessionFold.reset()
        active = ActiveSession(sessionId: childSessionId, items: [], cursor: 0, streaming: true)
        await followAddress([
            "kind": .string("subagent"),
            "parentSessionId": .string(parentSessionId),
            "childSessionId": .string(childSessionId),
            "mode": .string(mode),
        ])
        reconnectParent = parentSessionId
        reconnectMode = mode
    }

    /// Close the open session and stop following.
    public func close() {
        followTask?.cancel()
        followTask = nil
        active = nil
    }

    /// Submit one user prompt in queue mode.
    public func send(text: String) async {
        await send(text: text, images: [])
    }

    /// Submit one user prompt in queue mode with optional inline image
    /// uploads; the host promotes the base64 bytes to durable references
    /// during prompt admission.
    public func send(text: String, images: [CompanionImageUpload]) async {
        guard let active, !text.isEmpty || !images.isEmpty else { return }
        sending = true
        defer { sending = false }
        let requestId = "companion-" + UUID().uuidString
        var content: [WireValue] = [.object(["type": .string("text"), "text": .string(text)])]
        for image in images {
            var part: [String: WireValue] = [
                "type": .string("image"),
                "mediaType": .string(image.mediaType),
                "data": .string(image.base64),
            ]
            if let name = image.name { part["name"] = .string(name) }
            content.append(.object(part))
        }
        // The session verbs take one `request` object parameter; the wire
        // carries its fields under that name, not flat.
        _ = try? await wire.call("session/prompt", args: [
            "request": .object([
                "requestId": .string(requestId),
                "sessionId": .string(active.sessionId),
                "mode": .string("queue"),
                "content": .array(content),
            ]),
        ])
    }

    /// Fetch one durable image by attachment id over `session/attachment`
    /// and cache its decoded bytes; returns the reference on success.
    @discardableResult
    public func readAttachment(_ attachmentId: String) async -> LinkAttachmentReadValue? {
        guard let active else { return nil }
        guard let value = try? await wire.call("session/attachment", args: [
            "request": .object([
                "sessionId": .string(active.sessionId),
                "attachmentId": .string(attachmentId),
            ]),
        ]) else { return nil }
        guard let read = ContractCodec.decode(LinkAttachmentReadValue.self, from: value) else { return nil }
        attachments[attachmentId] = Data(base64Encoded: read.data)
        return read
    }

    /// Fetch one artifact the open session references over `session/artifact`
    /// and cache its decoded bytes (unbounded reads only — a paged read
    /// returns its range without caching); returns the read on success.
    /// - Parameters:
    ///   - artifactId: the reference identity from an artifact/created row.
    ///   - offset: range start in UTF-16 code units; nil starts at zero.
    ///   - limit: maximum returned code units; nil reads through the end.
    @discardableResult
    public func readArtifact(_ artifactId: String, offset: Int? = nil, limit: Int? = nil) async -> LinkArtifactReadValue? {
        guard let active else { return nil }
        var fields: [String: WireValue] = [
            "sessionId": .string(active.sessionId),
            "artifactId": .string(artifactId),
        ]
        if let offset { fields["offset"] = .number(Double(offset)) }
        if let limit { fields["limit"] = .number(Double(limit)) }
        guard let value = try? await wire.call("session/artifact", args: [
            "request": .object(fields),
        ]) else { return nil }
        guard let read = ContractCodec.decode(LinkArtifactReadValue.self, from: value) else { return nil }
        if limit == nil { artifactBytes[artifactId] = Data(base64Encoded: read.data) }
        return read
    }

    /// Cancel the open session's in-flight work.
    public func cancelActive() async {
        guard let active else { return }
        _ = try? await wire.call("session/cancel", args: [
            "request": .object(["sessionId": .string(active.sessionId)]),
        ])
    }

    /// Resubscribe the open session from its last cursor after a loss.
    public func reconnect() async {
        guard let current = active else { return }
        reconnecting = true
        reconnectAttempt += 1
        var address: [String: WireValue] = ["kind": .string("session"), "sessionId": .string(current.sessionId)]
        if current.sessionId != reconnectParent, let parent = reconnectParent {
            address = [
                "kind": .string("subagent"),
                "parentSessionId": .string(parent),
                "childSessionId": .string(current.sessionId),
                "mode": .string(reconnectMode),
            ]
        }
        await followAddress(address)
        reconnecting = false
    }

    // MARK: - Internals

    private func followAddress(_ address: [String: WireValue]) async {
        followTask?.cancel()
        followTask = Task { [weak self] in
            guard let self else { return }
            do {
                // The follow request carries the durable address; a
                // resubscription replays a fresh snapshot, and the fold
                // replaces its state from it.
                let frames = try await self.wire.stream("session/follow", payload: [
                    "request": .object(["address": .object(address)]),
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

    /// Fold one follow frame: a snapshot generation resets and replays its
    /// records; any other frame is one live event entry.
    private func fold(_ frame: WireValue) async {
        guard active != nil else { return }
        let kind = WireShape.string(frame, field: "type") ?? ""
        if kind == "snapshot" {
            sessionFold.reset()
            for record in WireShape.array(frame, field: "records") ?? [] {
                sessionFold.ingest(record)
            }
            let cursor = max(WireShape.number(frame, field: "cursor") ?? 0, sessionFold.state.cursor)
            apply { current in
                current.items = Self.timelineItems(sessionFold.state.items)
                current.cursor = cursor
                current.streaming = true
            }
            return
        }
        sessionFold.ingest(frame)
        apply { current in
            current.items = Self.timelineItems(sessionFold.state.items)
            current.cursor = max(current.cursor, sessionFold.state.cursor)
        }
    }

    private func apply(_ mutate: (inout ActiveSession) -> Void) {
        guard active != nil else { return }
        mutate(&active!)
    }

    private static func timelineItems(_ folded: [CompanionDomainState.Item]) -> [SessionItem] {
        folded.map { item in
            SessionItem(id: item.id, seq: item.seq, kind: item.kind, text: item.text)
        }
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
