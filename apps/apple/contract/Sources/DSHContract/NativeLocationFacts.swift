/// The §29 session-location facts contract as the Android core derives it:
/// which facts a Session exposes (Host, workspace, permission preset, online
/// state) and how each derives from wire data. Mirrors NativeLocationFacts in
/// apps/android/core — the Kotlin implementation is the authority; this mirror
/// adopts the same JSON vocabulary and the same leniency (typed mismatches drop
/// or keep earlier values, never silently coerce), so an Apple client derives
/// the same facts. Locale words stay client-owned; this mirror speaks
/// identifiers.
import Foundation

/// The §29 facts derivation: presence rules and fallbacks only; callers join with their own locale words.
public enum NativeLocationFacts {
    /// Presented Host name: the roster entry's name when non-blank, else its hostId; no entry adds no fact.
    public static func presentedHostName(name: String?, hostId: String?) -> String? {
        guard let hostId = hostId else { return nil }
        if let name = name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return name }
        return hostId
    }

    /// Last non-empty segment of a Host-side workspace directory; both separators are legal.
    public static func workspaceBasename(_ cwd: String) -> String {
        let segments = cwd.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "\\" })
        return segments.last(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }).map(String.init) ?? cwd
    }

    /// Newest `permission/preset` in a record batch; a matching event without a string preset keeps the earlier value.
    public static func latestPreset(_ records: [[String: Any]]) -> String? {
        var preset: String? = nil
        for record in records {
            guard let event = record["event"] as? [String: Any] else { continue }
            guard event["type"] as? String == "permission/preset" else { continue }
            guard let data = event["data"] as? [String: Any] else { continue }
            if let value = data["preset"] as? String { preset = value }
        }
        return preset
    }

    /// The follow-stream online-state word: the open state adds none, the six §18-family words name themselves, unknown words drop.
    public static func stateWord(_ state: String?) -> String? {
        switch state {
        case "idle", "opening", "reconnecting", "ended", "stopping", "stopped": return state
        default: return nil
        }
    }

    /// The one-line facts, present identifiers only: Host, workspace basename, preset, non-open state word.
    public static func factsLine(hostName: String?, cwd: String?, preset: String?, connectionState: String?) -> [String] {
        var facts: [String] = []
        if let hostName = hostName { facts.append(hostName) }
        if let cwd = cwd { facts.append(workspaceBasename(cwd)) }
        if let preset = preset { facts.append(preset) }
        if let word = stateWord(connectionState) { facts.append(word) }
        return facts
    }

    /// The detail line exists only with a workspace: the protocol-fixed full runtime word plus the whole path.
    public static func detailLine(_ cwd: String?) -> String? {
        guard let cwd = cwd else { return nil }
        return "full · " + cwd
    }

    /// One shared-fixture document: the wire inputs one Session's facts derive from.
    public struct Input: Equatable, Sendable {
        public let hostName: String?
        public let hostId: String?
        public let cwd: String?
        public let preset: String?
        public let connectionState: String?

        public init(hostName: String?, hostId: String?, cwd: String?, preset: String?, connectionState: String?) {
            self.hostName = hostName
            self.hostId = hostId
            self.cwd = cwd
            self.preset = preset
            self.connectionState = connectionState
        }
    }

    /// The derived presentation: the facts identifiers and the detail line.
    public struct Derived: Equatable, Sendable {
        public let facts: [String]
        public let detail: String?

        public init(facts: [String], detail: String?) {
            self.facts = facts
            self.detail = detail
        }
    }

    /// Lenient fixture decode: a non-object host reads as no Host, a non-string
    /// cwd or state reads as absent, a non-array journal reads as empty;
    /// malformed JSON still fails; a non-object document reads as all-absent.
    public static func decode(_ data: Data) throws -> Derived {
        let root = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let host = root["host"] as? [String: Any]
        let journal = (root["journal"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
        let input = Input(
            hostName: host.flatMap { $0["name"] as? String },
            hostId: host.flatMap { $0["hostId"] as? String },
            cwd: root["cwd"] as? String,
            preset: latestPreset(journal),
            connectionState: root["connectionState"] as? String)
        return derive(input)
    }

    /// The full derivation over one input document.
    public static func derive(_ input: Input) -> Derived {
        Derived(
            facts: factsLine(hostName: presentedHostName(name: input.hostName, hostId: input.hostId),
                cwd: input.cwd,
                preset: input.preset,
                connectionState: input.connectionState),
            detail: detailLine(input.cwd))
    }
}
