import Foundation

/// The device identity one pairing established, persisted between runs.
/// The signing key never leaves secure storage in a real deployment; the
/// `Codable` form carries only its raw bytes so tests can round-trip it.
public struct LinkCredentials: Codable, Equatable {
    public let deviceId: String
    public let hostId: String
    public let hostName: String
    public let role: String
    /// Base64 of the Ed25519 private key's 32 raw bytes.
    public let signingKeyBase64: String

    public init(deviceId: String, hostId: String, hostName: String, role: String, signingKeyBase64: String) {
        self.deviceId = deviceId
        self.hostId = hostId
        self.hostName = hostName
        self.role = role
        self.signingKeyBase64 = signingKeyBase64
    }
}

/// Where the credentials live. The system implementation wraps the Keychain;
/// the in-memory implementation backs previews and tests.
public protocol LinkCredentialsStoring {
    /// Load the persisted credentials, or nil before the first pairing.
    func load() -> LinkCredentials?
    /// Persist one identity, replacing any previous one.
    func save(_ credentials: LinkCredentials)
    /// Remove the persisted identity.
    func clear()
}

/// Process-lifetime storage; previews and tests.
public final class MemoryLinkCredentialsStore: LinkCredentialsStoring {
    private let lock = NSLock()
    private var stored: LinkCredentials?

    public init() {}

    public func load() -> LinkCredentials? {
        lock.lock(); defer { lock.unlock() }
        return stored
    }

    public func save(_ credentials: LinkCredentials) {
        lock.lock(); defer { lock.unlock() }
        stored = credentials
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        stored = nil
    }
}
