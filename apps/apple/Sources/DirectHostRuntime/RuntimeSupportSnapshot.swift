#if os(macOS)
import Foundation

/// Fixed export refusals; messages, paths and scanner output never become user-facing errors.
public enum SupportExportError: Error, Equatable {
    case invalidIdentity, invalidPolicy, unavailable, invalidScanner, oversized
    case scanFailed, secretsDetected, timedOut, cancelled, cleanupFailed
}

/// Deployment limits supplied by the native carrier for the complete export and scanner report.
public struct SupportExportPolicy {
    let maximumBytes: Int
    let maximumReportBytes: Int
    let scanMilliseconds: UInt64
    let shutdownMilliseconds: UInt64

    public init(maximumBytes: Int, maximumReportBytes: Int, scanMilliseconds: UInt64, shutdownMilliseconds: UInt64) throws {
        guard maximumBytes > 0, maximumReportBytes > 0, (1...60000).contains(scanMilliseconds),
              (1...60000).contains(shutdownMilliseconds) else {
            throw SupportExportError.invalidPolicy
        }
        self.maximumBytes = maximumBytes
        self.maximumReportBytes = maximumReportBytes
        self.scanMilliseconds = scanMilliseconds
        self.shutdownMilliseconds = shutdownMilliseconds
    }
}

/// Application identity selected from the expanded bundle metadata, never from a connection or runtime URL.
struct SupportProductIdentity: Encodable {
    let version: String
    let buildNumber: Int
    let channel: String

    init(info: [String: Any]) throws {
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

/// Closed lifecycle vocabulary bounds both memory usage and exported text.
enum SupportRuntimeEvent: String, CaseIterable, Encodable {
    case stopped, starting, ready, stopping
    case unavailable, invalidConfiguration, startFailed, startupTimeout
    case invalidAnnouncement, healthFailed, unexpectedExit, shutdownFailed

    init(_ status: RuntimeStatus) {
        switch status {
        case .stopped: self = .stopped
        case .starting: self = .starting
        case .ready: self = .ready
        case .stopping: self = .stopping
        case .failed(.unavailable): self = .unavailable
        case .failed(.invalidConfiguration): self = .invalidConfiguration
        case .failed(.startFailed): self = .startFailed
        case .failed(.startupTimeout): self = .startupTimeout
        case .failed(.invalidAnnouncement): self = .invalidAnnouncement
        case .failed(.healthFailed): self = .healthFailed
        case .failed(.unexpectedExit): self = .unexpectedExit
        case .failed(.shutdownFailed): self = .shutdownFailed
        }
    }

    var state: String {
        switch self {
        case .stopped, .starting, .ready, .stopping: return rawValue
        case .unavailable, .invalidConfiguration, .startFailed, .startupTimeout,
             .invalidAnnouncement, .healthFailed, .unexpectedExit, .shutdownFailed: return "failed"
        }
    }
}

/// Per-application lifecycle counts; no session data or telemetry identity is retained.
struct SupportRuntimeCounts {
    private var values: [SupportRuntimeEvent: UInt32] = [.stopped: 1]

    mutating func record(_ status: RuntimeStatus) {
        let key = SupportRuntimeEvent(status)
        let next = values[key, default: 0].addingReportingOverflow(1)
        values[key] = next.overflow ? UInt32.max : next.partialValue
    }

    var snapshot: [SupportRuntimeCount] {
        SupportRuntimeEvent.allCases.compactMap { event in
            values[event].map { SupportRuntimeCount(event: event, count: $0, saturated: $0 == UInt32.max) }
        }
    }
}

struct SupportRuntimeCount: Encodable {
    let event: SupportRuntimeEvent
    let count: UInt32
    let saturated: Bool
}

/// A value snapshot taken before scanning; it owns no runtime handles or user-identifying fields.
public struct RuntimeSupportSnapshot: Encodable {
    let state: String
    let failure: String?
    let lifecycleCounts: [SupportRuntimeCount]

    init(status: RuntimeStatus, counts: SupportRuntimeCounts) {
        let event = SupportRuntimeEvent(status)
        state = event.state
        failure = state == "failed" ? event.rawValue : nil
        lifecycleCounts = counts.snapshot
    }
}

/// Metadata for the scanner that will admit these exact bytes; no verdict is added after scanning.
struct SupportScannerIdentity: Codable {
    let schemaVersion: Int
    let version: String
    let archiveSha256: String
    let originalBinarySha256: String
    let binarySha256: String
    let licenseSha256: String
}

private struct RuntimeSupportBundle: Encodable {
    let schemaVersion = 1
    let platform = "macos"
    let runtimeClass = "full"
    let complete = false
    let product: SupportProductIdentity
    let runtime: RuntimeSupportSnapshot
    let scanner: SupportScannerIdentity
    let uncollected = ["connection", "protocol", "role", "capabilities", "updates", "native-crashes", "session-diagnostics"]
}

func encodeRuntimeSupport(info: [String: Any], snapshot: RuntimeSupportSnapshot,
                          scanner: SupportScannerIdentity, maximumBytes: Int) throws -> Data {
    let value = RuntimeSupportBundle(product: try SupportProductIdentity(info: info), runtime: snapshot, scanner: scanner)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    var data = try encoder.encode(value)
    data.append(10)
    guard data.count <= maximumBytes else { throw SupportExportError.oversized }
    return data
}
#endif
