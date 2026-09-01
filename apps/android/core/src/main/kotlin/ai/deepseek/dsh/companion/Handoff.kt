package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue

/** Who and where a handoff came from (chapter 40's provenance record). */
data class HandoffProvenance(val deviceId: String, val platform: String, val at: Long)

/**
 * The chapter-40 Handoff L1 device side: package one Lite session's folded
 * state as the snapshot the host renders, and send it through
 * `session/handoff` — the host creates the new full Session, pins its
 * title, and queues the rendered brief as its first user message. The
 * builder maps exactly the parts the Lite vocabulary holds; the recent
 * context keeps the last [contextRows] completed rows verbatim.
 */
class LiteHandoff(private val wire: WireDriving) {

    /**
     * Build the snapshot wire value from one folded Lite state.
     * @param state the session's folded domain state.
     * @param sourceSessionId the Lite journal's session identity.
     * @param capability the capability whose requirement raised the handoff.
     * @param provenance device identity and send time.
     * @param modelPreference the model the Lite provider used, if known.
     * @param contextRows how many trailing conversation rows to carry.
     */
    fun snapshotValue(
        state: LiteDomainState,
        sourceSessionId: String,
        capability: String,
        provenance: HandoffProvenance,
        modelPreference: String? = null,
        contextRows: Int = 6,
    ): WireValue.ObjectValue = WireValue.ObjectValue(buildMap {
        put("sourceSessionId", WireValue.StringValue(sourceSessionId))
        put("sourceRuntime", WireValue.StringValue("lite"))
        put("requestedCapability", WireValue.StringValue(capability))
        put("recentContext", WireValue.ArrayValue(state.conversation
            .filter { row -> row.role == "user" || row.role == "assistant" }
            .takeLast(contextRows)
            .map { row -> WireValue.ObjectValue(mapOf(
                "role" to WireValue.StringValue(row.role),
                "text" to WireValue.StringValue(row.text),
            )) }))
        put("planActive", WireValue.BoolValue(state.planActive))
        put("todo", WireValue.ArrayValue(state.todos.map { todo -> WireValue.ObjectValue(mapOf(
            "content" to WireValue.StringValue(todo.content),
            "status" to WireValue.StringValue(todo.status),
        )) }))
        put("artifactRefs", WireValue.ArrayValue(state.artifacts.map { artifact -> WireValue.ObjectValue(mapOf(
            "id" to WireValue.StringValue(artifact.id),
            "kind" to WireValue.StringValue(artifact.kind),
            "title" to WireValue.StringValue(artifact.title),
            "status" to WireValue.StringValue(artifact.status),
        )) }))
        if (modelPreference != null) put("modelPreference", WireValue.StringValue(modelPreference))
        put("provenance", WireValue.ObjectValue(mapOf(
            "deviceId" to WireValue.StringValue(provenance.deviceId),
            "platform" to WireValue.StringValue(provenance.platform),
            "at" to WireValue.NumberValue(provenance.at.toDouble()),
        )))
    })

    /**
     * Send one handoff snapshot; the host owns rendering.
     * @return the new full Session's id, or null when the host refuses or
     *   the answer carries no session id.
     */
    suspend fun send(snapshot: WireValue.ObjectValue): String? {
        val value = try {
            wire.call("session/handoff", mapOf("request" to snapshot))
        } catch (_: Exception) {
            return null
        }
        return WireShape.string(value, "sessionId")
    }
}
