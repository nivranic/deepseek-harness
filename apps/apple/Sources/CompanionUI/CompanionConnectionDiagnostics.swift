import Foundation
import SharedAppleRemoteCore

/// Subscription ownership does not establish Host health or permission to perform an operation.
public struct CompanionConnectionSnapshot: Encodable, Sendable {
    public enum State: String, Encodable, Sendable {
        case idle, opening, open, reconnecting, ended, stopping, stopped
    }

    public let state: State
    public let attempts: UInt32
    public let interruptions: UInt32
    public let countsSaturated: Bool
    public let lastFailure: LinkDiagnosticFailure?
}

/// Every fixed subscription reports its own current owner state; absent models remain unavailable.
public struct CompanionConnectionSnapshots: Encodable, Sendable {
    struct Section: Encodable, Sendable {
        let producer: String
        let observation: String
        let activityScope = "model-lifetime"
        let snapshot: CompanionConnectionSnapshot?

        init(_ producer: String, _ snapshot: CompanionConnectionSnapshot?) {
            self.producer = producer
            self.snapshot = snapshot
            observation = snapshot == nil ? "unavailable" : "current"
        }
    }

    let sessionFollow: Section
    let interactions: Section
    let workspaces: Section
    let pushes: Section

    public init(session: CompanionConnectionSnapshot?, interactions: CompanionConnectionSnapshot?,
                workspaces: CompanionConnectionSnapshot?, pushes: CompanionConnectionSnapshot?) {
        sessionFollow = Section("RemoteSessionViewModel", session)
        self.interactions = Section("InteractionViewModel", interactions)
        self.workspaces = Section("FilesViewModel", workspaces)
        self.pushes = Section("PushViewModel", pushes)
    }

    public static var unavailable: Self {
        Self(session: nil, interactions: nil, workspaces: nil, pushes: nil)
    }
}

/// Tokens prevent a retired task from changing the next subscription's diagnostic state.
@MainActor
final class CompanionConnectionDiagnostics {
    private var owner: UUID?
    private var stopping = false
    private var state = CompanionConnectionSnapshot.State.idle
    private var attempts: UInt32 = 0
    private var interruptions: UInt32 = 0
    private var lastFailure: LinkDiagnosticFailure?

    var snapshot: CompanionConnectionSnapshot {
        .init(state: state, attempts: attempts, interruptions: interruptions,
              countsSaturated: attempts == .max || interruptions == .max, lastFailure: lastFailure)
    }

    func begin(reconnecting: Bool) -> UUID {
        let token = UUID()
        owner = token
        stopping = false
        state = reconnecting ? .reconnecting : .opening
        lastFailure = nil
        return token
    }

    func attempt(_ token: UUID) {
        guard accepts(token) else { return }
        if attempts < .max { attempts += 1 }
    }

    func opened(_ token: UUID) {
        guard accepts(token) else { return }
        state = .open
        lastFailure = nil
    }

    func interrupted(_ token: UUID, error: Error?) {
        guard accepts(token) else { return }
        state = .ended
        lastFailure = error.map(LinkDiagnosticFailure.init)
        if interruptions < .max { interruptions += 1 }
    }

    func retrying(_ token: UUID) {
        guard accepts(token) else { return }
        state = .reconnecting
    }

    func stop() {
        stopping = true
        state = owner == nil ? .stopped : .stopping
        lastFailure = nil
    }

    func finished(_ token: UUID) {
        guard owner == token else { return }
        owner = nil
        state = stopping ? .stopped : .ended
    }

    private func accepts(_ token: UUID) -> Bool { owner == token && !stopping }
}
