package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue

/** Session follow openings carry a durable address and a positive page bound.
 * Reconnection requests the same complete opening window; retained cursors are
 * local merge state and never enter the request. The Apple contract consumes
 * the same request fixtures, which are also checked against the Host validator. */
object NativeFollowResume {
    /** Address entries for one durable Session. */
    fun sessionAddress(sessionId: String): Map<String, WireValue> = mapOf(
        "kind" to WireValue.StringValue("session"),
        "sessionId" to WireValue.StringValue(sessionId),
    )

    /** Address entries for one subagent child's timeline by durable parent address. */
    fun subagentAddress(parentSessionId: String, childSessionId: String, mode: String): Map<String, WireValue> = mapOf(
        "kind" to WireValue.StringValue("subagent"),
        "parentSessionId" to WireValue.StringValue(parentSessionId),
        "childSessionId" to WireValue.StringValue(childSessionId),
        "mode" to WireValue.StringValue(mode),
    )

    /** Request entries opening one durable Session: the address under its wire key. */
    fun sessionRequest(sessionId: String): Map<String, WireValue> =
        mapOf("address" to WireValue.ObjectValue(sessionAddress(sessionId)))

    /** Request entries opening one subagent child's timeline: the address under its wire key. */
    fun subagentRequest(parentSessionId: String, childSessionId: String, mode: String): Map<String, WireValue> =
        mapOf("address" to WireValue.ObjectValue(subagentAddress(parentSessionId, childSessionId, mode)))

    /** The page bound every opening request carries; a non-positive bound fails loud like the Host's validation. */
    fun withMaxMessages(entries: Map<String, WireValue>, maxMessages: Int): Map<String, WireValue> {
        require(maxMessages > 0) { "maxMessages must be a positive safe integer" }
        return entries + ("maxMessages" to WireValue.NumberValue(maxMessages.toDouble()))
    }

    /** One complete session/follow request body from the shared rules. */
    fun request(address: Map<String, WireValue>, maxMessages: Int): Map<String, WireValue> = mapOf(
        "request" to WireValue.ObjectValue(
            withMaxMessages(mapOf("address" to WireValue.ObjectValue(address)), maxMessages),
        ),
    )
}
