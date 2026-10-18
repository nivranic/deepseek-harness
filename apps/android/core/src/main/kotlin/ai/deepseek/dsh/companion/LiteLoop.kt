package ai.deepseek.dsh.companion

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** One streaming chunk a Lite model provider emits. */
sealed interface LiteStreamChunk {
    data class Reasoning(val text: String) : LiteStreamChunk

    data class Text(val text: String) : LiteStreamChunk

    data class ToolCall(val id: String, val name: String, val arguments: String) : LiteStreamChunk
}

/** One tool call of a completed history turn, as the model issued it. */
data class LiteTurnToolCall(val id: String, val name: String, val arguments: String)

/**
 * One completed conversation turn as provider-facing history: the accepted
 * prompt, the assistant's reply text (null when the turn ended without
 * one), and the turn's tool calls with each call id's result text — a
 * success's output and a failure's reason alike.
 */
data class LiteTurnRecord(
    val userText: String,
    val assistantText: String?,
    val toolCalls: List<LiteTurnToolCall>,
    val toolResults: Map<String, String>,
)

/**
 * Why a provider stream failed, in the Behavior Spec's vocabulary: transport
 * problems are `network/error` kinds, API problems are `provider/error`
 * codes — the loop driver folds the thrown value into the matching event.
 */
sealed class LiteTransportError : RuntimeException("lite transport failure") {
    data class Network(val kind: String) : LiteTransportError()

    // Overrides Throwable's open `message` so the spec vocabulary keeps its
    // name; a non-null String is a valid covariant narrowing.
    data class Provider(val code: String, override val message: String) : LiteTransportError()
}

/** The model seam a Lite loop drives: one streamed response per prompt. */
interface LiteProviding {
    /**
     * Stream one response's chunks for a submitted prompt.
     * @param prompt the accepted user prompt text.
     * @param system the session's assembled system prompt, or null when the session runs bare; it is request-face context and never a session event.
     * @param history the completed prior turns of this process's live fold — each turn's prompt, reply, tool calls, and result texts — so the model sees its own on-device tool output; it is request-face context and never session events.
     * @return the ordered chunks of one model response.
     */
    suspend fun stream(prompt: String, system: String? = null, history: List<LiteTurnRecord> = emptyList()): Flow<LiteStreamChunk>
}

/** A scripted provider: one prompt-matched chunk script, for tests and previews. */
class ScriptedLiteProvider(private val scripts: Map<String, List<LiteStreamChunk>>) : LiteProviding {
    /** The prompts streamed so far, in order. */
    val submitted = mutableListOf<String>()

    /** The system prompt each streamed submission carried, in order; null marks a bare prompt. */
    val submittedSystems = mutableListOf<String?>()

    /** The completed-turn history each streamed submission carried, in order. */
    val submittedHistories = mutableListOf<List<LiteTurnRecord>>()

    override suspend fun stream(prompt: String, system: String?, history: List<LiteTurnRecord>): Flow<LiteStreamChunk> {
        submitted.add(prompt)
        submittedSystems.add(system)
        submittedHistories.add(history)
        return (scripts[prompt] ?: emptyList()).asFlow()
    }
}

/** The reference facts of one artifact a successful execution created — the write face's contribution to the artifact event pair. */
data class LiteArtifactFact(val id: String, val kind: String)

/** One bundled-tool execution outcome; [artifact] names the artifact a successful execution created, null otherwise. */
data class LiteToolOutcome(val ok: Boolean, val text: String, val artifact: LiteArtifactFact? = null)

/** Executes one bundled tool invocation. */
typealias LiteToolExecuting = suspend (id: String, name: String, arguments: String) -> LiteToolOutcome

/** Build one lifecycle event object from its tag and fields. */
private fun event(type: String, vararg fields: Pair<String, JsonElement>): JsonObject = buildJsonObject {
    put("type", type)
    for ((name, value) in fields) put(name, value)
}

private fun text(value: String): JsonPrimitive = JsonPrimitive(value)

/**
 * The Lite loop driver skeleton: submits a prompt to the provider, folds
 * the streamed chunks into the Behavior-Spec state, and routes each tool
 * call through the permission policy (§31): permitted calls execute
 * on-device and an execution that created an artifact follows its
 * tool/result with the artifact event pair, gated calls emit the handoff
 * marker for the full runtime, and unknown names fail explicitly — no call
 * hangs or dispatches unjudged. Each new submission carries the fold's
 * completed prior turns to the provider as history, so the model sees its
 * own tool calls and their result texts on every later turn.
 */
class LiteLoopDriver(
    private val scope: CoroutineScope,
    private val provider: LiteProviding,
    private val onEventApplied: ((LiteDomainState) -> Unit)? = null,
    private val toolCatalog: LiteToolCatalog = LiteToolCatalog.FALLBACK,
    private val permissionPolicy: LiteToolPermissionPolicy = LiteToolPermissionPolicies.defaultPolicy(toolCatalog),
    private val execute: LiteToolExecuting,
) {
    /** The live fold the driver applies each lifecycle event to. */
    val fold = LiteFold()

    /**
     * The fold's tool-row count at each accepted prompt, in turn order —
     * the cursor that splits the fold's chronological tool rows at turn
     * edges when history is exported.
     */
    private val turnToolBoundaries = mutableListOf<Int>()

    /** Whether a turn is currently driving. */
    var running = false
        private set

    private var job: Job? = null

    /**
     * Submit one prompt and drive its response to the terminal event; a new
     * submission replaces any in-flight turn.
     * @param prompt the accepted user prompt text.
     * @param system the session's assembled system prompt passed to the provider, or null for a bare prompt; it never enters the event journal.
     * @return the turn's Job — joining it waits for the terminal event.
     */
    fun submit(prompt: String, system: String? = null): Job {
        job?.cancel()
        val turn = scope.launch { drive(prompt, system) }
        job = turn
        return turn
    }

    /** Cancel the in-flight turn; the fold finalizes the delivered prefix. */
    fun cancel() {
        job?.cancel()
    }

    /** Apply one event and surface the cut state to the projection. */
    private fun apply(event: JsonObject) {
        fold.apply(event)
        onEventApplied?.invoke(fold.state)
    }

    private suspend fun drive(prompt: String, system: String?) {
        running = true
        try {
            apply(event("prompt/accepted", "requestId" to text("lite-${java.util.UUID.randomUUID()}"), "content" to text(prompt)))
            // The history snapshot rides between the accepted prompt and the
            // stream: the fold's last conversation row is this turn's user
            // row and no tool row of this turn exists yet, so the boundaries
            // split the completed turns exactly.
            turnToolBoundaries.add(fold.state.toolCalls.size)
            val history = exportCompletedTurns(fold.state, turnToolBoundaries)
            try {
                var assembled = ""
                var handedOff: String? = null
                provider.stream(prompt, system, history).collect { chunk ->
                    // Once a tool hands off, the loop stops at the marker;
                    // later chunks fold nothing.
                    if (handedOff != null) return@collect
                    when (chunk) {
                        is LiteStreamChunk.Reasoning -> apply(event("stream/reasoning", "text" to text(chunk.text)))
                        is LiteStreamChunk.Text -> {
                            apply(event("stream/delta", "text" to text(chunk.text)))
                            assembled += chunk.text
                        }
                        is LiteStreamChunk.ToolCall -> {
                            apply(
                                event(
                                    "tool/call",
                                    "id" to text(chunk.id),
                                    "name" to text(chunk.name),
                                    "arguments" to text(chunk.arguments),
                                ),
                            )
                            // The permission policy owns every dispatch
                            // decision (§31): a permitted call executes
                            // on-device, a gated one hands off, and an
                            // unknown name fails explicitly.
                            when (permissionPolicy.decide(chunk.name)) {
                                LiteToolDecision.AllowLocal -> {
                                    val outcome = execute(chunk.id, chunk.name, chunk.arguments)
                                    apply(
                                        event(
                                            "tool/result",
                                            "id" to text(chunk.id),
                                            "ok" to JsonPrimitive(outcome.ok),
                                            "text" to text(outcome.text),
                                        ),
                                    )
                                    val artifact = outcome.artifact
                                    if (artifact != null) {
                                        // The fold pairs artifact/status with the
                                        // artifact/created row by id, so creation
                                        // precedes status; the pair follows the
                                        // completed tool/result because the bytes
                                        // exist only after the executor's write,
                                        // and the store's atomic put makes the
                                        // artifact ready the moment it lands.
                                        apply(
                                            event(
                                                "artifact/created",
                                                "id" to text(artifact.id),
                                                "kind" to text(artifact.kind),
                                                "title" to text(artifact.id),
                                            ),
                                        )
                                        apply(event("artifact/status", "id" to text(artifact.id), "status" to text("ready")))
                                    }
                                }
                                is LiteToolDecision.Handoff -> {
                                    // A gated tool hands off to the full
                                    // runtime; the loop stops at the marker,
                                    // and the event keeps the established
                                    // capability vocabulary — the policy's
                                    // reason never enters an event field.
                                    apply(event("handoff/requested", "capability" to text(LITE_REQUIRES_FULL_RUNTIME)))
                                    handedOff = LITE_REQUIRES_FULL_RUNTIME
                                    return@collect
                                }
                                LiteToolDecision.Unknown -> apply(
                                    event(
                                        "tool/result",
                                        "id" to text(chunk.id),
                                        "ok" to JsonPrimitive(false),
                                        "text" to text("unknown tool on this device: " + chunk.name),
                                    ),
                                )
                            }
                        }
                    }
                }
                if (handedOff != null) return
                apply(event("message/completed", "text" to text(assembled)))
                apply(event("turn/completed"))
            } catch (cancelled: CancellationException) {
                // The driver owns this Job; its own cancellation is the
                // terminal event, and nothing else can reach this catch.
                apply(event("turn/cancelled", "reason" to text("user")))
            } catch (transport: LiteTransportError) {
                when (transport) {
                    is LiteTransportError.Network -> apply(event("network/error", "kind" to text(transport.kind)))
                    is LiteTransportError.Provider -> apply(
                        event("provider/error", "code" to text(transport.code), "message" to text(transport.message)),
                    )
                }
            } catch (failure: Exception) {
                apply(event("provider/error", "code" to text("PROVIDER_FAILED"), "message" to text(failure.toString())))
            }
        } finally {
            running = false
        }
    }
}

/**
 * Export the fold's completed turns as provider-facing history: each user
 * row opens a turn, the rows up to the next user row close it, and each
 * turn's tool rows are the fold's chronological tool list between that
 * turn's boundary and the next — the same id pairing the fold itself
 * applies. The last user row belongs to the live turn and stays out.
 * @param state the live fold's state at the snapshot cut, with the live turn's user row already landed.
 * @param turnToolBoundaries the fold's tool-row count at each accepted prompt, one entry per turn including the live one.
 * @return one record per completed turn, in turn order.
 */
private fun exportCompletedTurns(state: LiteDomainState, turnToolBoundaries: List<Int>): List<LiteTurnRecord> {
    val userRowIndexes = state.conversation.indices.filter { index -> state.conversation[index].role == "user" }
    return userRowIndexes.dropLast(1).mapIndexed { turn, userIndex ->
        val turnEnd = userRowIndexes[turn + 1]
        val calls = state.toolCalls.subList(turnToolBoundaries[turn], turnToolBoundaries[turn + 1])
        LiteTurnRecord(
            userText = state.conversation[userIndex].text,
            assistantText = (userIndex + 1..<turnEnd)
                .firstOrNull { index -> state.conversation[index].role == "assistant" }
                ?.let { index -> state.conversation[index].text },
            toolCalls = calls.map { call -> LiteTurnToolCall(id = call.id, name = call.name, arguments = call.arguments) },
            toolResults = calls.associate { call -> call.id to call.resultText },
        )
    }
}
