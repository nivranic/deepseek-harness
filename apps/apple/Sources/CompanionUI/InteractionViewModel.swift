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
    private var watching = false

    /// - Parameter wire: the wire driver; tests pass a fake.
    public init(wire: any CompanionWireDriving) {
        self.wire = wire
    }

    deinit {
        // The view model is main-actor-bound by construction; its deinit
        // runs nonisolated, so the cancel borrows the isolation it knows holds.
        MainActor.assumeIsolated { watchTask?.cancel() }
    }

    /// Open the `$events` stream and collect forwarded interactions. The
    /// stream resubscribes on loss and waits for each generation's Host-owned
    /// ready frame before an answer can use its client identity. Repeated
    /// starts are idempotent; a start after stop awaits the prior task.
    public func startWatching() async {
        guard !watching else { return }
        watching = true
        if let previous = watchTask {
            previous.cancel()
            await previous.value
        }
        guard watching else { return }
        let wire = self.wire
        watchTask = Task { [weak self] in
            while !Task.isCancelled {
                guard self != nil else { return }
                self?.clientId = ""
                do {
                    let frames = try await wire.stream("$events", payload: [:])
                    for try await frame in frames {
                        try Task.checkCancellation()
                        guard let self else { return }
                        self.collect(frame)
                    }
                } catch is CancellationError {
                    return
                } catch {
                    // A carrier failure and a clean end both invalidate this generation.
                }
                guard !Task.isCancelled else { return }
                self?.clientId = ""
                do {
                    try await Task.sleep(for: .seconds(1))
                } catch is CancellationError {
                    return
                } catch {
                    return
                }
            }
        }
    }

    /// Stop watching; the inbox stays for review but no new events arrive.
    /// A later start waits for cancellation to complete before opening another generation.
    public func stopWatching() {
        watching = false
        watchTask?.cancel()
        clientId = ""
    }

    /// Answer one pending interaction.
    public func answer(_ interaction: PendingInteraction, with answer: InteractionAnswer) async {
        answering = true
        lastRefusal = nil
        defer { answering = false }
        guard !clientId.isEmpty else {
            lastRefusal = "Remote Event stream is not ready."
            return
        }
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

    /// Collect one `$events` frame's interactions.
    func collect(_ frame: WireValue) {
        let frameType = WireShape.string(frame, field: "type") ?? ""
        if frameType == "ready" {
            clientId = WireShape.string(frame, field: "clientId") ?? ""
            return
        }
        if frameType == "cancel" {
            guard let eventId = WireShape.string(frame, field: "eventId") else { return }
            inbox.removeAll { $0.id == eventId }
            return
        }
        guard frameType == "waterfall",
              let id = WireShape.string(frame, field: "eventId"),
              let agentId = WireShape.string(frame, field: "agentId"),
              !agentId.isEmpty,
              let request = WireShape.object(frame, field: "request")
        else { return }
        let eventName = WireShape.string(frame, field: "event") ?? ""
        let isApproval = eventName.contains("approval")
        let isQuestion = eventName.contains("question")
        guard isApproval || isQuestion else { return }
        let title = WireShape.string(request, field: "title")
            ?? WireShape.string(request, field: "toolName")
            ?? (isApproval ? "Approval requested" : "Question asked")
        let detail = Self.detailText(of: request)
        let pending = PendingInteraction(
            id: id,
            kind: isApproval ? .approval : .question,
            sessionId: agentId,
            title: title,
            detail: detail
        )
        // The host re-forwards the same interaction after a reconnect; the
        // event id, not the whole card, is the identity.
        guard !inbox.contains(where: { $0.id == id }) else { return }
        inbox.append(pending)
    }

    /// Best-effort visible text of a forwarded interaction payload.
    private static func detailText(of value: WireValue) -> String {
        if let reason = WireShape.string(value, field: "reason") { return reason }
        if let text = WireShape.string(value, field: "text") { return text }
        for field in ["content", "message"] {
            if let nested = WireShape.object(value, field: field),
               let text = WireShape.string(nested, field: "text") { return text }
        }
        return ""
    }
}
