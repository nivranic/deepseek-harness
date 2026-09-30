/// The persisted native Host roster contract as the Android core encodes it:
/// one whole-document, atomically selected set of trusted Host identities.
/// Mirrors NativeHostCatalog/FileNativeHostStore in apps/android/core — the
/// Kotlin implementation is the authority; this mirror adopts the same JSON
/// vocabulary and invariants so an Apple client can read the same document.
import Foundation
import CryptoKit

/// One saved Host identity; every field is a non-blank string on the wire.
public struct NativeHostCredentials: Equatable, Sendable {
    public let hostId: String
    public let hostName: String
    public let deviceId: String
    public let role: String
    public let endpoint: String
    public let pinnedFingerprint: String
    public let signingKeyBase64: String
    public let transportFormat: String

    public init(hostId: String, hostName: String, deviceId: String, role: String,
                endpoint: String, pinnedFingerprint: String, signingKeyBase64: String,
                transportFormat: String) {
        self.hostId = hostId
        self.hostName = hostName
        self.deviceId = deviceId
        self.role = role
        self.endpoint = endpoint
        self.pinnedFingerprint = pinnedFingerprint
        self.signingKeyBase64 = signingKeyBase64
        self.transportFormat = transportFormat
    }
}

/// The decoded roster: the saved Hosts and the one selected key, if any.
public struct NativeHostRoster: Equatable, Sendable {
    public let active: String?
    public let hosts: [NativeHostCredentials]

    public init(active: String?, hosts: [NativeHostCredentials]) {
        self.active = active
        self.hosts = hosts
    }
}

/// One roster validation failure, named by the rule that rejected the document.
public struct NativeHostRosterError: Error, Equatable, Sendable {
    public let rule: String
    public init(_ rule: String) { self.rule = rule }
}

/// Device roles a native pairing can grant; mirrors NativePairing.roles.
public enum NativePairingRoles {
    public static let all: Set<String> = ["viewer", "collaborator", "controller", "owner"]
}

/// The credential transport format every saved Host must declare.
public let nativeCredentialFormat = "native-gateway-v1"

extension NativeHostRoster {
    /// The verified-Host identity key, independent of the replaceable device
    /// grant: SHA-256 hex of the JSON array `[hostId, pinnedFingerprint]`.
    public static func hostKey(hostId: String, pinnedFingerprint: String) -> String {
        let identity = "[\"" + hostId + "\",\"" + pinnedFingerprint + "\"]"
        return SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Strict decode mirroring FileNativeHostStore.decode: exact field sets on
    /// the root and every row, non-blank strings, the pinned transport format,
    /// a known pairing role, a 64-lowercase-hex fingerprint, a 32-byte signing
    /// key, a canonical reachable HTTPS origin, distinct Host keys, and an
    /// active key that names a saved identity (absent when the roster is empty).
    public static func decode(_ data: Data) throws -> NativeHostRoster {
        let root = try jsonObject(data)
        try requireKeys(root, ["version", "active", "hosts"], "root fields")
        // JSONSerialization bridges true/false as NSNumber, and NSNumber(value: true)
        // compares equal to 1; Kotlin's intOrNull rejects booleans, so reject them first.
        guard let version = (root["version"] as? NSNumber), (root["version"] as? Bool) == nil, version == 1 else {
            throw NativeHostRosterError("unsupported Host catalog version")
        }
        guard let rows = root["hosts"] as? [Any] else { throw NativeHostRosterError("Host catalog array required") }
        var hosts: [NativeHostCredentials] = []
        for row in rows {
            guard let object = row as? [String: Any] else { throw NativeHostRosterError("Host catalog object required") }
            try requireKeys(object,
                ["hostId", "hostName", "deviceId", "role", "endpoint", "pinnedFingerprint", "signingKeyBase64", "transportFormat"],
                "host fields")
            let credentials = NativeHostCredentials(
                hostId: try text(object, "hostId"),
                hostName: try text(object, "hostName"),
                deviceId: try text(object, "deviceId"),
                role: try text(object, "role"),
                endpoint: try nativeOrigin(try text(object, "endpoint")),
                pinnedFingerprint: try text(object, "pinnedFingerprint"),
                signingKeyBase64: try text(object, "signingKeyBase64"),
                transportFormat: try text(object, "transportFormat"))
            guard credentials.transportFormat == nativeCredentialFormat,
                NativePairingRoles.all.contains(credentials.role),
                isLowercaseHex64(credentials.pinnedFingerprint) else {
                throw NativeHostRosterError("invalid native Host identity")
            }
            guard let key = Data(base64Encoded: credentials.signingKeyBase64), key.count == 32 else {
                throw NativeHostRosterError("invalid native Host identity")
            }
            hosts.append(credentials)
        }
        let keys = hosts.map { hostKey(hostId: $0.hostId, pinnedFingerprint: $0.pinnedFingerprint) }
        guard Set(keys).count == keys.count else { throw NativeHostRosterError("duplicate saved Host") }
        var active: String?
        switch root["active"] {
        case .none:
            throw NativeHostRosterError("active Host key required")
        case .some(let value) where value is NSNull:
            active = nil
        case .some(let value):
            guard let id = value as? String else { throw NativeHostRosterError("active Host key must be a string") }
            active = id
        }
        guard hosts.isEmpty ? active == nil : active.map { keys.contains($0) } == true else {
            throw NativeHostRosterError("active Host does not name a saved identity")
        }
        return NativeHostRoster(active: active, hosts: hosts)
    }
}

/// Kotlin's `[a-f0-9]{64}` fingerprint pattern, as a character predicate.
private func isLowercaseHex64(_ value: String) -> Bool {
    value.count == 64 && value.allSatisfy { $0.isHexDigit && !$0.isUppercase }
}

private func jsonObject(_ data: Data) throws -> [String: Any] {
    guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw NativeHostRosterError("Host catalog object required")
    }
    return value
}

private func requireKeys(_ object: [String: Any], _ expected: [String], _ rule: String) throws {
    guard Set(object.keys) == Set(expected) else { throw NativeHostRosterError("unexpected \(rule)") }
}

private func text(_ object: [String: Any], _ field: String) throws -> String {
    guard let value = object[field] as? String, !value.trimmingCharacters(in: .whitespaces).isEmpty else {
        throw NativeHostRosterError("invalid \(field)")
    }
    return value
}

/// Only a pinned HTTPS origin can hold a saved Host: no userinfo, query, or
/// fragment, an empty-or-root path, a plausible port, and a concrete host.
/// Kotlin's URI reports the IPv6 any-address as "[::]" while URLComponents
/// reports "::"; both spellings are rejected here.
private func nativeOrigin(_ value: String) throws -> String {
    guard let components = URLComponents(string: value),
        let scheme = components.scheme?.lowercased(), scheme == "https",
        let host = components.host, !host.isEmpty,
        components.percentEncodedUser == nil, components.percentEncodedPassword == nil,
        components.percentEncodedQuery == nil, components.percentEncodedFragment == nil,
        components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/",
        components.port == nil || (1...65535).contains(components.port!),
        !(["0.0.0.0", "::", "[::]"].contains(host)) else {
        throw NativeHostRosterError("native endpoint must be a reachable HTTPS origin")
    }
    return value.hasSuffix("/") ? String(value.dropLast()) : value
}
