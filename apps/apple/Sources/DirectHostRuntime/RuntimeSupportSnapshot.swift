#if os(macOS)
import Foundation
import SupportExportCore

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
