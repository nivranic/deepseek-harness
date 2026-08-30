import Foundation
import Observation
import SharedAppleRemoteCore
import UserNotifications

/// The chapter-70 minimized push vocabulary: reference data only. A push
/// names WHAT happened and WHERE — never source code, prompt, credential,
/// or diff content; details are fetched over the secure remote link after
/// the app opens. The relay (APNs/FCM) carries this same shape later.
public enum CompanionPush: Equatable {
    /// One approval the host is waiting on.
    case approvalWaiting(sessionId: String, eventId: String)

    /// One question the host is waiting on.
    case questionWaiting(sessionId: String, eventId: String)

    /// One turn the open session completed.
    case taskCompleted(sessionId: String, turn: Int)

    /// The device-side localized title; no wire content ever rides it.
    public var title: String {
        switch self {
        case .approvalWaiting: return "宿主等待审批"
        case .questionWaiting: return "宿主等待答复"
        case .taskCompleted: return "任务完成"
        }
    }

    /// The device-side body line every push shares: details live behind
    /// the secure link, not in the notification.
    public var body: String { "打开应用，经安全连接查看详情。" }

    /// The platform notification content for this push.
    public var localContent: UNNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        return content
    }
}

/// Parse one `$events` forward frame into a minimized push. Approval and
/// question titles and texts never ride the push — only the session and
/// event references are extracted; other frames project nothing.
public func pushFromForward(_ frame: WireValue) -> CompanionPush? {
    guard let eventName = WireShape.string(frame, field: "event"),
          let sessionId = WireShape.string(frame, field: "sessionId"),
          let eventId = WireShape.string(frame, field: "eventId") else { return nil }
    if eventName.contains("approval") { return .approvalWaiting(sessionId: sessionId, eventId: eventId) }
    if eventName.contains("question") { return .questionWaiting(sessionId: sessionId, eventId: eventId) }
    return nil
}

/// Parse one follow record for a completed turn end — the task-completed
/// push. Records that end a turn any other way project nothing.
/// - Parameters:
///   - record: one `{type:"event", event:{…}}` follow frame.
///   - openSessionId: the session the record belongs to.
public func pushFromTurnEnd(_ record: WireValue, openSessionId: String) -> CompanionPush? {
    guard let event = WireShape.object(record, field: "event"),
          WireShape.string(event, field: "type") == "turn/end",
          let data = WireShape.object(event, field: "data"),
          let reason = WireShape.object(data, field: "reason"),
          WireShape.string(reason, field: "kind") == "completed",
          let turn = WireShape.number(data, field: "turn") else { return nil }
    return .taskCompleted(sessionId: openSessionId, turn: Int(turn))
}

/// The platform presentation seam: hand one minimized push to the system
/// notifier. Details load over the secure link after the app opens.
public protocol CompanionPushPresenting: Sendable {
    /// Present one push; delivery is best-effort.
    func present(_ push: CompanionPush) async
}

/// The UNUserNotificationCenter-backed default. Without the user's
/// authorization the system drops the notification silently — both the
/// request and the add swallow only that expected refusal.
public struct SystemPushPresenter: CompanionPushPresenting {
    public init() {}

    public func present(_ push: CompanionPush) async {
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: push.localContent, trigger: nil)
        try? await center.add(request)
    }
}

/// The minimal host-to-companion push chain over the live `$events`
/// stream: each forwarded approval or question becomes one minimized
/// push, deduplicated by equality, in arrival order — and reaches the
/// platform notifier when a presenter is wired. A lost stream simply
/// ends the watch: the inbox keeps its own subscription, and the relay
/// will carry these pushes when it exists.
@MainActor
@Observable
public final class PushViewModel {
    /// The minimized pushes collected so far.
    public private(set) var pushes: [CompanionPush] = []

    private let wire: any CompanionWireDriving
    private let presenter: (any CompanionPushPresenting)?
    private var watchTask: Task<Void, Never>?

    /// - Parameters:
    ///   - wire: the wire driver; tests pass a fake.
    ///   - presenter: the platform notifier, or nil to only collect.
    public init(wire: any CompanionWireDriving, presenter: (any CompanionPushPresenting)? = nil) {
        self.wire = wire
        self.presenter = presenter
    }

    deinit {
        // The view model is main-actor-bound by construction; its deinit
        // runs nonisolated, so the cancel borrows the isolation it knows holds.
        MainActor.assumeIsolated { watchTask?.cancel() }
    }

    /// Open the `$events` stream and collect minimized pushes.
    public func startWatching() async {
        watchTask?.cancel()
        watchTask = Task { [weak self] in
            guard let self else { return }
            do {
                let frames = try await self.wire.stream("$events", payload: [:])
                for try await frame in frames {
                    self.collect(frame)
                }
            } catch is CancellationError {
                // Deliberate stop.
            } catch {
                // Stream loss ends the watch; nothing else can reach here.
            }
        }
    }

    /// Stop watching; collected pushes stay for review.
    public func stopWatching() {
        watchTask?.cancel()
        watchTask = nil
    }

    /// Collect one `$events` frame; a re-forward of a known push is a no-op.
    func collect(_ frame: WireValue) {
        guard let push = pushFromForward(frame), !pushes.contains(push) else { return }
        pushes.append(push)
        if let presenter {
            Task { await presenter.present(push) }
        }
    }
}

/// Bridge a forwarded relay envelope onto the chapter-70 push vocabulary —
/// the dependency link APNs/FCM delivery will ride (references only).
/// - Parameter envelope: the relay-forwarded reference payload.
/// - Returns: the minimized push, or nil for a non-push kind.
public func pushFromRelayEnvelope(_ envelope: RelayEnvelope) -> CompanionPush? {
    switch envelope.kind {
    case "approval-waiting":
        return envelope.eventId.map { CompanionPush.approvalWaiting(sessionId: envelope.sessionId, eventId: $0) }
    case "question-waiting":
        return envelope.eventId.map { CompanionPush.questionWaiting(sessionId: envelope.sessionId, eventId: $0) }
    case "task-completed":
        return envelope.turn.map { CompanionPush.taskCompleted(sessionId: envelope.sessionId, turn: $0) }
    default:
        return nil
    }
}
