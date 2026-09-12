import Foundation

/// Fixed export refusals; messages, paths and scanner output never become user-facing errors.
public enum SupportExportError: Error, Equatable, Sendable {
    case invalidIdentity, invalidPolicy, unavailable, invalidScanner, oversized
    case scanFailed, secretsDetected, timedOut, cancelled, cleanupFailed
}

/// Application identity selected from the expanded bundle metadata, never from a connection or runtime URL.
public struct SupportProductIdentity: Encodable, Sendable {
    public let version: String
    public let buildNumber: Int
    public let channel: String

    public init(info: [String: Any]) throws {
        guard let version = info["DSHProductVersion"] as? String,
              !version.isEmpty,
              version.utf8.count <= 128,
              let build = info["DSHBuildNumber"] as? String,
              let buildNumber = Int(build), String(buildNumber) == build,
              (1...65535).contains(buildNumber),
              let channel = info["DSHDistributionChannel"] as? String,
              ["dev", "canary", "beta", "stable"].contains(channel) else {
            throw SupportExportError.invalidIdentity
        }
        let parts = version.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let numbers = parts[0].split(separator: ".", omittingEmptySubsequences: false)
        guard numbers.count == 3, numbers.allSatisfy({ part in
            guard let number = Int(part), (0...65535).contains(number) else { return false }
            return String(number) == part
        }) else { throw SupportExportError.invalidIdentity }
        if parts.count == 2 {
            let identifiers = parts[1].split(separator: ".", omittingEmptySubsequences: false)
            guard identifiers.allSatisfy({ part in
                guard !part.isEmpty, part.utf8.allSatisfy({
                    (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45
                }) else { return false }
                return !part.utf8.allSatisfy { (48...57).contains($0) } || part == "0" || part.first != "0"
            }) else { throw SupportExportError.invalidIdentity }
        }
        guard !(channel == "stable" && parts.count == 2),
              !(channel == "canary" && parts.count == 1),
              channel != "beta" || (parts.count == 2 && ["beta", "rc"].contains(String(parts[1].split(separator: ".")[0]))) else {
            throw SupportExportError.invalidIdentity
        }
        self.version = version
        self.buildNumber = buildNumber
        self.channel = channel
    }
}
