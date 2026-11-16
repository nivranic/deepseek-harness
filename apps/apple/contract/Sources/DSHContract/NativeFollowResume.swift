/// Session follow openings carry a durable address and positive page bound.
/// Reconnection requests a complete opening window; retained cursors stay local.
/// Shared fixtures are checked against both this builder and the Host validator.
import Foundation

/// Builder-rule failures, catchable so client self-checks can assert them.
public enum NativeFollowResumeError: Error {
    /// `maxMessages` must be a positive page size.
    case maxMessages
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

    /// Build the full follow request envelope: `{"request": {"address": {…}, maxMessages}}`.
    public static func request(address: [String: Any], maxMessages: Int) throws -> [String: Any] {
        ["request": try withMaxMessages(["address": address], maxMessages: maxMessages)]
    }
}
