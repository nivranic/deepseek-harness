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
 * Seed one session's journal at construction (§67's relaunch recovery): a
 * readable stored journal replays in as the session's history, an absent one
 * cold-opens empty, and an unreadable one — the store's fail-loud load throws
 * — is quarantined through the store, bytes preserved beside the file, before
 * the same cold open. The seed matches on the session id alone: endpoint and
 * preset changes do not retire a journal, they only change how the next turn
 * is requested.
 */
private fun seedJournal(store: LiteSessionStoring?, sessionId: String): LiteSession {
    if (store == null) return LiteSession(sessionId)
    return try {
        store.load(sessionId) ?: LiteSession(sessionId)
    } catch (unreadable: Exception) {
        // A corrupt line throws IllegalStateException and an unreadable file
        // IOException; both are unrecoverable at assembly, so the journal is
        // quarantined — a same-directory rename of a file load just read —
        // and its failure stays loud as a broken filesystem, not a recovery
        // decision this path hides.
        store.quarantine(sessionId)
        LiteSession(sessionId)
    }
}

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
    /** The §38 approval seam approval-gated tool calls suspend on; null folds an explicit denial — an Ask never executes unconfirmed. */
    ask: LiteToolAsking? = null,
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
    /** The durable journal the turn outcomes land in: construction replays a
     * stored journal for this id in as the session's history (§67's relaunch
     * recovery), and an unreadable one is quarantined beside its file while
     * the session cold-opens empty. */
    val session: LiteSession = seedJournal(store, sessionId)

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
        onEventApplied = { cut -> _liveState.tryEmit(cut) }, execute = execute, ask = ask, toolCatalog = toolCatalog)

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
        val folded = driver.fold.state
        when {
            // A handoff turn stops at the marker with no assistant row and no
            // terminal event; the tail block below journals handoff/requested,
            // so a message/completed here would echo the prompt back as the
            // assistant's answer.
            folded.pendingHandoff != null -> {}
            // A turn the transport killed journals its folded failure under
            // the failure's own tag — never a message row that echoes the
            // prompt back as the assistant's answer.
            folded.lastTurnEnd == "provider-error" -> {
                val failure = folded.errors.lastOrNull { it.kind == "provider" }
                session.record(
                    event("provider/error", "code" to text(failure?.code ?: ""), "message" to text(failure?.message ?: "")),
                )
            }
            folded.lastTurnEnd == "network-error" -> {
                val failure = folded.errors.lastOrNull { it.kind == "network" }
                session.record(event("network/error", "kind" to text(failure?.code ?: "")))
            }
            else -> session.record(
                event("message/completed", "text" to text(folded.conversation.lastOrNull()?.text ?: "")),
            )
        }
        val handoff = folded.pendingHandoff
        if (handoff != null) {
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
