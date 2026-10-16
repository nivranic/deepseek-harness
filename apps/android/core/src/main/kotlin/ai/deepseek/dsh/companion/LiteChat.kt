package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
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
 * exposed for rendering — live per event while a turn runs, replayed from
 * the journal between turns.
 */
class LiteChatViewModel(
    scope: CoroutineScope,
    sessionId: String,
    provider: LiteProviding,
    execute: LiteToolExecuting,
    private val store: LiteSessionStoring? = null,
    private val artifacts: LiteArtifactStoring? = null,
    toolCatalog: LiteToolCatalog = LiteToolCatalog.FALLBACK,
    /** The catalog the session's preset selection resolves against; the selected preset defaults to its lowest-order entry. */
    presetCatalog: LitePresetCatalog = LitePresetCatalog.BARE,
    /** The preset whose assembled system prompt rides every provider request (§33); the default follows the catalog default, null only when the catalog carries none. */
    private val selectedPreset: LitePresetDescriptor? = presetCatalog.default,
    /** The construction-time session facts the UI discloses; the default states this face's own selection, bare and without a preset id until a projection resolves one. */
    val facts: LiteSessionFacts = LiteSessionFacts(presetId = selectedPreset?.id),
) {
    /** The durable journal the turn outcomes land in. */
    val session: LiteSession = LiteSession(sessionId)

    // Replay one cut for late collectors; buffer every intermediate cut so
    // per-event streaming reaches the UI without StateFlow-style conflation.
    private val _liveState = MutableSharedFlow<LiteDomainState>(replay = 1, extraBufferCapacity = 64).also { flow ->
        flow.tryEmit(session.state)
    }

    /** The folded state the UI renders: each event's cut during a live
     * turn, the journal replay after each persisted turn. */
    val liveState: SharedFlow<LiteDomainState> = _liveState

    /** The loop driver the surface submits prompts through. */
    val driver: LiteLoopDriver = LiteLoopDriver(scope, provider,
        onEventApplied = { cut -> _liveState.tryEmit(cut) }, execute = execute, toolCatalog = toolCatalog)

    /** The capability the last turn handed off on, when it did. */
    var lastHandoff: String? = null
        private set

    /** The folded domain state of the journal plus the live turn. */
    val state: LiteDomainState
        get() = _liveState.replayCache.firstOrNull() ?: session.state

    /**
     * Submit one prompt, await the turn's terminal event, then persist the
     * turn's fold-visible outcome events to the journal — raw deltas stay
     * out of it (chapter 64 forbids premature fidelity). The selected
     * preset's assembled system prompt rides the provider request as
     * request-face context and never lands in the journal.
     * @param prompt the user prompt text.
     */
    suspend fun send(prompt: String) {
        driver.submit(prompt, selectedPreset?.assembledSystemPrompt).join()
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
        _liveState.tryEmit(session.state)
    }

    /**
     * Read one referenced artifact's content through the resource channel —
     * textual kinds render directly, others show type and size, and a
     * missing id (or no channel) reads as the pane's empty state.
     * @param artifact the folded reference whose bytes are read.
     * @return the content, or null when nothing lives under the id.
     */
    fun readArtifact(artifact: LiteArtifact): LiteArtifactContent? =
        artifacts?.let { channel -> readLiteArtifact(channel, artifact) }
}
