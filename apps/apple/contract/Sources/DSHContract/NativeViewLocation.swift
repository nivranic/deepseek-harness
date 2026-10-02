/// The §26 view-location handoff payload as the Android core (and the Web
/// Client) encode it: a prefixed base64url document carrying the Host id,
/// Session id, and one inclusive durable anchor seq — transfer the viewing
/// position, never the runtime. Mirrors NativeViewLocations in
/// apps/android/core — the Kotlin implementation is the authority; this mirror
/// adopts the same grammar (exact field order on encode, exactly three keys on
/// decode, base64url, safe-integer anchors, fail-loud parse boundaries), so an
/// Apple client reads and writes the same payload bytes. Caller-side size
/// limits and the Companion deep-link wrapper stay client-owned.
import Foundation

/// One durable viewing position on one trusted Host; it carries neither authorization nor runtime state.
public struct NativeViewLocation: Equatable, Sendable {
    public let hostId: String
    public let sessionId: String
    public let anchorSeq: Int64

    public init(hostId: String, sessionId: String, anchorSeq: Int64) {
        self.hostId = hostId
        self.sessionId = sessionId
        self.anchorSeq = anchorSeq
    }
}

public enum NativeViewLocations {
    /// Wire form prefix pinning the payload grammar for future revisions.
    private static let prefix = "dsh-session-view.v1."
    /// JSON numbers the grammar admits: integers in the safe range, never -0.
    private static let maxSafeInteger = 9_007_199_254_740_991.0

    /// JSON string escaping for the two characters the ASCII grammar can carry verbatim.
    private static func jsonString(_ value: String) -> String {
        "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    /// Encode one view location: the exact ordered ASCII JSON fields the Web v1 grammar writes.
    public static func encode(_ location: NativeViewLocation) -> String {
        precondition(!location.hostId.isEmpty && !location.sessionId.isEmpty
            && Double(location.anchorSeq) >= 0 && Double(location.anchorSeq) <= maxSafeInteger)
        let json = "{\"hostId\":" + jsonString(location.hostId)
            + ",\"sessionId\":" + jsonString(location.sessionId)
            + ",\"anchorSeq\":" + String(location.anchorSeq) + "}"
        precondition(json.allSatisfy { $0.isASCII && $0.asciiValue! >= 0x20 && $0.asciiValue! <= 0x7e },
            "session view location must be ASCII-encoded")
        let base64 = Data(json.utf8).base64EncodedString()
        return prefix + base64.replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// Decode a v1 payload; every parse boundary fails loud instead of coercing.
    public static func decode(_ encoded: String) throws -> NativeViewLocation {
        guard encoded.hasPrefix(prefix) else { throw NativeViewLocationError.unknownGrammar }
        let body = String(encoded.dropFirst(prefix.count))
        guard body.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else {
            throw NativeViewLocationError.notBase64url
        }
        let padded = body.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            + String(repeating: "=", count: (4 - body.count % 4) % 4)
        guard let bytes = Data(base64Encoded: padded),
            let json = String(data: bytes, encoding: .isoLatin1) else {
            throw NativeViewLocationError.notBase64url
        }
        guard let parsed = try? JSONSerialization.jsonObject(with: Data(json.utf8)),
            let value = parsed as? [String: Any] else {
            throw NativeViewLocationError.notJson
        }
        guard value.count == 3, let hostId = value["hostId"] as? String, !hostId.isEmpty,
            let sessionId = value["sessionId"] as? String, !sessionId.isEmpty,
            let anchor = value["anchorSeq"] as? NSNumber else {
            throw NativeViewLocationError.grammar
        }
        // NSNumber bridges booleans to numbers on macOS; the CF type id is the reliable boolean test.
        guard CFGetTypeID(anchor) != CFBooleanGetTypeID() else { throw NativeViewLocationError.grammar }
        let number = anchor.doubleValue
        guard number.isFinite, number >= 0, number <= maxSafeInteger,
            number == number.rounded(.towardZero),
            !(number == 0 && number.sign == .minus) else {
            throw NativeViewLocationError.grammar
        }
        return NativeViewLocation(hostId: hostId, sessionId: sessionId, anchorSeq: Int64(number))
    }
}

/// The v1 grammar's parse-boundary failures; callers present them, never coerce them.
public enum NativeViewLocationError: Error, Equatable, Sendable {
    case unknownGrammar
    case notBase64url
    case notJson
    case grammar
}
