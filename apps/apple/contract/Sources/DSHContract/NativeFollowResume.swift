/// The §25 follow-resume request envelope as the Android core builds it: one
/// follow address (a session id, or a parent/child/mode subagent address), a
/// positive `maxMessages` page size, and an optional non-negative `fromSeq`
/// resume cursor riding only when present. Mirrors NativeFollowResume in
/// apps/android/core — the Kotlin implementation is the authority; this mirror
/// adopts the same builder rules (positive page size, non-negative cursor, a
/// fresh follow envelope carries no `fromSeq` key), so an Apple client sends a
/// wire structurally equal to the Companion's session/follow request. Key
/// order stays builder-owned; structural equality, not byte equality, is the
/// request-envelope contract.
import Foundation

/// Builder-rule failures, catchable so client self-checks can assert them.
public enum NativeFollowResumeError: Error {
    /// `maxMessages` must be a positive page size.
    case maxMessages
    /// `fromSeq` must be a non-negative cursor.
    case fromSeq
}

public enum NativeFollowResume {
    /// Address one session's follow stream by its durable session id.
    public static func sessionAddress(sessionId: String) -> [String: Any] {
        ["kind": "session", "sessionId": sessionId]
    }

    /// Address one subagent child's timeline read-only by durable ids and mode.
    public static func subagentAddress(parentSessionId: String, childSessionId: String, mode: String) -> [String: Any] {
        ["kind": "subagent", "parentSessionId": parentSessionId,
            "childSessionId": childSessionId, "mode": mode]
    }

    /// Request entries opening one durable Session: the address under its wire key.
    public static func sessionRequest(sessionId: String) -> [String: Any] {
        ["address": sessionAddress(sessionId: sessionId)]
    }

    /// Request entries opening one subagent child's timeline: the address under its wire key.
    public static func subagentRequest(parentSessionId: String, childSessionId: String, mode: String) -> [String: Any] {
        ["address": subagentAddress(parentSessionId: parentSessionId, childSessionId: childSessionId, mode: mode)]
    }

    /// Add the page size; a non-positive size never reaches the wire.
    public static func withMaxMessages(_ entries: [String: Any], maxMessages: Int) throws -> [String: Any] {
        guard maxMessages > 0 else { throw NativeFollowResumeError.maxMessages }
        var out = entries
        out["maxMessages"] = maxMessages
        return out
    }

    /// Add the resume cursor; a nil cursor keeps a fresh follow envelope with no `fromSeq` key.
    public static func withResumeCursor(_ entries: [String: Any], cursor: Int64?) throws -> [String: Any] {
        guard let cursor else { return entries }
        guard cursor >= 0 else { throw NativeFollowResumeError.fromSeq }
        var out = entries
        out["fromSeq"] = Int(cursor)
        return out
    }

    /// Build the full follow request envelope: `{"request": {"address": {…}, maxMessages, fromSeq?}}`.
    public static func request(address: [String: Any], maxMessages: Int, cursor: Int64?) throws -> [String: Any] {
        ["request": try withResumeCursor(try withMaxMessages(["address": address], maxMessages: maxMessages), cursor: cursor)]
    }
}
