import Foundation
import Observation

/// One pending remote interaction: an approval or a question the host
/// forwarded over `$events`, answerable from the device when the host's
/// independent approval switch allows it.
public struct PendingInteraction: Identifiable, Equatable {
    public enum Kind: Equatable {
        case approval
        case question
    }

    public let id: String
    public let kind: Kind
    public let sessionId: String
    public let title: String
    public let detail: String

    public init(id: String, kind: Kind, sessionId: String, title: String, detail: String) {
        self.id = id
        self.kind = kind
        self.sessionId = sessionId
        self.title = title
        self.detail = detail
    }
}

/// The approval answer vocabulary the host's approval seam defines; the
/// wire carries it as the `$events/result` outcome value.
public enum InteractionAnswer: String {
    case allowedOnce = "allowed-once"
    case rejected
    case cancelled
}

/// Watches `$events` for forwarded interactions and answers them through
/// `$events/result`. Seeing a prompt never implies the right to answer: a
/// refusal surfaces the host's decision (usually the approval switch being
/// off) as inbox state, never as a silent drop.
@MainActor
@Observable
public final class InteractionViewModel {
    /// The inbox of unanswered interactions.
    public private(set) var inbox: [PendingInteraction] = []

    /// The answer in flight, when one is.
    public private(set) var answering = false

    /// The last refusal the host returned, when an answer was denied.
    public private(set) var lastRefusal: String?

    public private(set) var clientId: String = ""

    private let wire: any CompanionWireDriving
    private var watchTask: Task<Void, Never>?

    /// - Parameter wire: the wire driver; tests pass a fake.
    public init(wire: any CompanionWireDriving) {
        self.wire = wire
    }

    deinit {
        watchTask?.cancel()
    }

    /// Open the `$events` stream and collect forwarded interactions. The
    /// stream resubscribes on loss, minting a fresh clientId each time so
    /// the host's correlation never crosses subscriptions.
    public func startWatching() async {
        watchTask?.cancel()
        let freshId = "companion-\(UUID().uuidString)"
        clientId = freshId
        watchTask = Task { [weak self] in
            guard let self else { return }
            do {
                let frames = try await self.wire.stream("$events", payload: [:])
                for try await frame in frames {
                    self.collect(frame)
                }
                await self.restart()
            } catch is CancellationError {
                // Deliberate stop.
            } catch {
                await self.restart()
            }
        }
    }

    /// Stop watching; the inbox stays for review but no new events arrive.
    public func stopWatching() {
        watchTask?.cancel()
        watchTask = nil
    }

    /// Answer one pending interaction.
    public func answer(_ interaction: PendingInteraction, with answer: InteractionAnswer) async {
        answering = true
        lastRefusal = nil
        defer { answering = false }
        do {
            _ = try await wire.call("$events/result", args: [
                "clientId": .string(clientId),
                "eventId": .string(interaction.id),
                "outcome": .object([
                    "kind": .string("result"),
                    "value": .string(answer.rawValue),
                ]),
            ])
            inbox.removeAll { $0.id == interaction.id }
        } catch {
            lastRefusal = RemoteSessionViewModel.message(of: error)
        }
    }

    // MARK: - Internals

    private func restart() async {
        guard watchTask != nil else { return }
        try? await Task.sleep(for: .seconds(1))
        guard watchTask != nil else { return }
        await startWatching()
    }

    /// Collect one `$events` frame's interactions.
    func collect(_ frame: WireValue) {
        // Delivered events carry the host's payload under `event`; the
        // interaction kinds the companion answers arrive as approval or
        // question forwards. Unknown frames leave the inbox untouched.
        let eventName = WireShape.string(frame, field: "event") ?? ""
        let isApproval = eventName.contains("approval")
        let isQuestion = eventName.contains("question")
        guard isApproval || isQuestion else { return }
        let id = WireShape.string(frame, field: "eventId")
            ?? WireShape.string(frame, field: "id")
            ?? "\(inbox.count)"
        let sessionId = WireShape.string(frame, field: "sessionId") ?? ""
        let payload = WireShape.object(frame, field: "event") ?? frame
        let title = WireShape.string(payload, field: "title") ?? (isApproval ? "Approval requested" : "Question asked")
        let detail = RemoteSessionViewModel.summary(of: payload)
        let pending = PendingInteraction(
            id: id,
            kind: isApproval ? .approval : .question,
            sessionId: sessionId,
            title: title,
            detail: detail
        )
        guard !inbox.contains(pending) else { return }
        inbox.append(pending)
    }
}
