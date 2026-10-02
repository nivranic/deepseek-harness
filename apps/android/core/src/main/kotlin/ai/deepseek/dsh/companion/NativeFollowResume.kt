package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue

/** §25 session/follow opening envelope as shared construction rules: the address
 * vocabulary (session and subagent kinds) nested under one `address` entry, the
 * page bound every opening request carries, and the resume rule — the last
 * applied entry's inclusive seq rides only when one exists, so a fresh open
 * carries no `fromSeq` key. The Apple contract mirrors these rules
 * (apps/apple/contract/Sources/DSHContract/NativeFollowResume.swift) over shared
 * fixtures; the Kotlin implementation is the authority. The Host's wire-boundary
 * validation (safe-integer checks for untrusted JSON) stays Host-owned. */
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

    /** The §25 resume rule: a null cursor adds no key; a present cursor must be non-negative. */
    fun withResumeCursor(entries: Map<String, WireValue>, cursor: Long?): Map<String, WireValue> {
        if (cursor == null) return entries
        require(cursor >= 0) { "fromSeq must be a non-negative safe integer" }
        return entries + ("fromSeq" to WireValue.NumberValue(cursor.toDouble()))
    }

    /** One complete session/follow request body from the shared rules. */
    fun request(address: Map<String, WireValue>, maxMessages: Int, cursor: Long?): Map<String, WireValue> = mapOf(
        "request" to WireValue.ObjectValue(
            withResumeCursor(withMaxMessages(mapOf("address" to WireValue.ObjectValue(address)), maxMessages), cursor),
        ),
    )
}
