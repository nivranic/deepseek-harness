import Foundation

/// One device registered at the relay (chapter 69's rendezvous): identity
/// plus the push-token slot APNs/FCM delivery will fill — references only.
public struct RelayDevice: Equatable, Sendable {
    public let accountId: String
    public let deviceId: String
    public let platform: String
    public let pushToken: String?

    public init(accountId: String, deviceId: String, platform: String, pushToken: String? = nil) {
        self.accountId = accountId
        self.deviceId = deviceId
        self.platform = platform
        self.pushToken = pushToken
    }
}

/// One forwarded envelope — the chapter-70 minimized push vocabulary:
/// references only, never source code, prompt, credential, or diff content.
public struct RelayEnvelope: Equatable, Sendable {
    public let kind: String
    public let sessionId: String
    public let eventId: String?
    public let turn: Int?

    public init(kind: String, sessionId: String, eventId: String? = nil, turn: Int? = nil) {
        self.kind = kind
        self.sessionId = sessionId
        self.eventId = eventId
        self.turn = turn
    }
}

/// The relay's rendezvous skeleton (chapters 68/69): an in-memory, single-
/// account forwarding service — devices register, publishers push reference
/// envelopes, devices drain them by poll. It holds no session data, no
/// workspace state, and no authority: every byte it keeps is a pending
/// envelope, and the Windows/macOS host keeps full session authority.
public final class RelayRendezvous: @unchecked Sendable {
    private let guardLock = NSLock()
    private var devices: [String: RelayDevice] = [:]
    private var pending: [String: [RelayEnvelope]] = [:]

    public init() {}

    /// Register one device; re-registration under the same token refreshes
    /// its record.
    /// - Parameter device: the device identity and its push-token slot.
    /// - Returns: the opaque rendezvous token polling requires.
    public func register(_ device: RelayDevice) -> String {
        guardLock.lock()
        defer { guardLock.unlock() }
        let token = "rt-\(device.accountId)-\(device.deviceId)"
        devices[token] = device
        if pending[token] == nil { pending[token] = [] }
        return token
    }

    /// The devices registered under one account, in registration order —
    /// the account's presence.
    public func devices(accountId: String) -> [RelayDevice] {
        guardLock.lock()
        defer { guardLock.unlock() }
        return devices.values.filter { $0.accountId == accountId }
    }

    /// Forward one reference envelope to every device of the account.
    /// - Parameters:
    ///   - accountId: the account whose devices receive the envelope.
    ///   - envelope: the minimized, reference-only payload.
    /// - Returns: how many devices the envelope queued for.
    @discardableResult
    public func publish(accountId: String, envelope: RelayEnvelope) -> Int {
        guardLock.lock()
        defer { guardLock.unlock() }
        var delivered = 0
        for (token, device) in devices where device.accountId == accountId {
            pending[token, default: []].append(envelope)
            delivered += 1
        }
        return delivered
    }

    /// Drain one device's pending envelopes in arrival order; an unknown
    /// token drains nothing.
    /// - Parameter token: the rendezvous token from registration.
    /// - Returns: the forwarded envelopes, oldest first.
    public func poll(token: String) -> [RelayEnvelope] {
        guardLock.lock()
        defer { guardLock.unlock() }
        let drained = pending[token] ?? []
        pending[token] = []
        return drained
    }
}
