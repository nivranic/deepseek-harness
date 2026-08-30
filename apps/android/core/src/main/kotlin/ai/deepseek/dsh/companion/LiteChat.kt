package ai.deepseek.dsh.companion

import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Build one lifecycle event object from its tag and fields. */
private fun event(type: String, vararg fields: Pair<String, JsonElement>): JsonObject = buildJsonObject {
    put("type", type)
    for ((name, value) in fields) put(name, value)
}

private fun text(value: String): JsonPrimitive = JsonPrimitive(value)

/**
 * The Lite chat surface's state: one on-device session driven through the
 * loop, its journal persisted on every turn, and the folded domain state
 * exposed for rendering.
 */
class LiteChatViewModel(
    scope: CoroutineScope,
    sessionId: String,
    provider: LiteProviding,
    execute: LiteToolExecuting,
    private val store: LiteSessionStoring? = null,
) {
    /** The durable journal the turn outcomes land in. */
    val session: LiteSession = LiteSession(sessionId)

    /** The loop driver the surface submits prompts through. */
    val driver: LiteLoopDriver = LiteLoopDriver(scope, provider, execute)

    /** The capability the last turn handed off on, when it did. */
    var lastHandoff: String? = null
        private set

    /** The folded domain state of the journal plus the live turn. */
    val state: LiteDomainState
        get() = if (driver.running) driver.fold.state else session.state

    /**
     * Submit one prompt, await the turn's terminal event, then persist the
     * turn's fold-visible outcome events to the journal — raw deltas stay
     * out of it (chapter 64 forbids premature fidelity).
     * @param prompt the user prompt text.
     */
    suspend fun send(prompt: String) {
        driver.submit(prompt).join()
        session.record(event("prompt/accepted", "requestId" to text("ui-${java.util.UUID.randomUUID()}"), "content" to text(prompt)))
        session.record(
            event("message/completed", "text" to text(driver.fold.state.conversation.lastOrNull()?.text ?: "")),
        )
        val handoff = driver.fold.state.pendingHandoff
        if (handoff != null) {
            lastHandoff = handoff
            session.record(event("handoff/requested", "capability" to text(handoff)))
        } else {
            session.record(event("turn/completed"))
        }
        store?.save(session)
    }
}
