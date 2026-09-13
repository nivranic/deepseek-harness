#if os(macOS)
import Foundation

/// Observes the existing local HTML probe; it cannot establish provider, Gateway or Session health.
struct RuntimeCarrierProbe {
    enum State: String, Encodable { case unavailable, checking, reachable, failed }

    private var state: State = .unavailable
    private var attempts: UInt32 = 0
    private var successes: UInt32 = 0
    private var failures: UInt32 = 0

    mutating func started() {
        attempts = Self.increment(attempts)
        state = .checking
    }

    mutating func completed(success: Bool) {
        if success { successes = Self.increment(successes); state = .reachable }
        else { failures = Self.increment(failures); state = .failed }
    }

    /// A retired activation cannot retain an available result while the supervisor owns no probe.
    mutating func retire() { state = .unavailable }

    var snapshot: RuntimeCarrierProbeSnapshot {
        RuntimeCarrierProbeSnapshot(state: state, attempts: attempts, successes: successes, failures: failures)
    }

    private static func increment(_ value: UInt32) -> UInt32 { value == .max ? .max : value + 1 }
}

/// Counters span this supervisor's lifetime; results describe only its currently owned activation.
struct RuntimeCarrierProbeSnapshot: Encodable {
    let producer = "RuntimeSupervisor.carrierProbe"
    let activityScope = "supervisor-lifetime"
    let observation: String
    let state: RuntimeCarrierProbe.State
    let attempts: UInt32
    let successes: UInt32
    let failures: UInt32
    let countsSaturated: Bool

    init(state: RuntimeCarrierProbe.State, attempts: UInt32, successes: UInt32, failures: UInt32) {
        self.state = state
        self.attempts = attempts
        self.successes = successes
        self.failures = failures
        observation = state == .reachable || state == .failed ? "last-known" : "current"
        countsSaturated = [attempts, successes, failures].contains(.max)
    }
}
#endif
