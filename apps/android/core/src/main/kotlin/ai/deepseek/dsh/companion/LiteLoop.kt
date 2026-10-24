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

    /** One response's terminal reason as the wire stated it (`finish_reason`), null when the wire never stated one; it closes a round and never carries content. */
    data class Finish(val reason: String?) : LiteStreamChunk
}

/** One tool call of a completed history round, as the model issued it. */
data class LiteTurnToolCall(val id: String, val name: String, val arguments: String)

/**
 * One completed round of a history turn: the round's assistant reply text
 * (null when the round ended without one), and the round's tool calls with
 * each call id's result text — a success's output and a failure's reason
 * alike.
 */
data class LiteTurnRound(
    val assistantText: String?,
    val toolCalls: List<LiteTurnToolCall>,
    val toolResults: Map<String, String>,
)

/**
 * One conversation turn as provider-facing history: the accepted prompt and
 * its ordered rounds — each round one model response carrying its reply
 * text, tool calls, and result texts — so a turn that continued over its
 * own tool output replays round by round.
 */
data class LiteTurnRecord(
    val userText: String,
    val rounds: List<LiteTurnRound>,
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

/** The model seam a Lite loop drives: one streamed response per request. */
interface LiteProviding {
    /**
     * Stream one response's chunks for a submitted prompt.
     * @param prompt the accepted user prompt text.
     * @param system the session's assembled system prompt, or null when the session runs bare; it is request-face context and never a session event.
     * @param history the completed rounds this request replays — every completed prior turn and the live turn's already-finished tool rounds, each round's reply text, tool calls, and result texts — so the model sees its own on-device tool output; it is request-face context and never session events.
     * @return the ordered chunks of one model response.
     */
    suspend fun stream(prompt: String, system: String? = null, history: List<LiteTurnRecord> = emptyList()): Flow<LiteStreamChunk>
}

/**
 * A scripted provider: one prompt-matched chunk script, for tests and
 * previews; later requests of the same prompt replay the script unless a
 * follow-up script is queued for that request.
 */
class ScriptedLiteProvider(
    private val scripts: Map<String, List<LiteStreamChunk>>,
    /** Later-request scripts per prompt, in request order beyond the first; a request without a queued follow-up replays the prompt's base script. */
    private val followUps: Map<String, List<List<LiteStreamChunk>>> = emptyMap(),
) : LiteProviding {
    /** The prompts streamed so far, in order. */
    val submitted = mutableListOf<String>()

    /** The system prompt each streamed submission carried, in order; null marks a bare prompt. */
    val submittedSystems = mutableListOf<String?>()

    /** The completed-round history each streamed submission carried, in order. */
    val submittedHistories = mutableListOf<List<LiteTurnRecord>>()

    private val requestsPerPrompt = mutableMapOf<String, Int>()

    override suspend fun stream(prompt: String, system: String?, history: List<LiteTurnRecord>): Flow<LiteStreamChunk> {
        submitted.add(prompt)
        submittedSystems.add(system)
        submittedHistories.add(history)
        val request = requestsPerPrompt.merge(prompt, 1, Int::plus)!!
        val script =
            if (request == 1) scripts[prompt]
            else followUps[prompt]?.getOrNull(request - 2) ?: scripts[prompt]
        return (script ?: emptyList()).asFlow()
    }
}

/**
 * The most model requests one turn may spend: a `tool_calls` finish on the
 * last allowed request closes the turn fail-soft — that round's assistant
 * row and the turn's terminal event still land, and the event stream is
 * never truncated — so a runaway tool loop cannot spend unbounded device
 * cost. Typical tool chains resolve within three requests; eight doubles
 * that headroom as a fixed loop-safety invariant, not a deployment tunable.
 */
const val MAX_LITE_ROUNDS_PER_TURN = 8

/** The reference facts of one artifact a successful execution created — the write face's contribution to the artifact event pair. */
data class LiteArtifactFact(val id: String, val kind: String)

/** One bundled-tool execution outcome; [artifact] names the artifact a successful execution created, null otherwise. */
data class LiteToolOutcome(val ok: Boolean, val text: String, val artifact: LiteArtifactFact? = null)

/** Executes one bundled tool invocation. */
typealias LiteToolExecuting = suspend (id: String, name: String, arguments: String) -> LiteToolOutcome

/**
 * Confirms one approval-gated tool call with the user (§38's approval face):
 * returns true to execute the call on-device, false to fold the established
 * failed-result vocabulary. The seam receives the call's name, arguments, and
 * the declaration's risk wire word — the facts the approval dialog shows.
 */
typealias LiteToolAsking = suspend (name: String, arguments: String, risk: String) -> Boolean

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
 * hangs or dispatches unjudged. A round that finishes with `tool_calls`
 * continues the same turn: its assistant row lands, and the next request
 * carries the fold's completed rounds — the prior turns whole and this
 * turn's finished rounds — as history, until a round finishes another way,
 * a call hands off, or [MAX_LITE_ROUNDS_PER_TURN] closes the turn
 * fail-soft.
 */
class LiteLoopDriver(
    private val scope: CoroutineScope,
    private val provider: LiteProviding,
    private val onEventApplied: ((LiteDomainState) -> Unit)? = null,
    private val toolCatalog: LiteToolCatalog = LiteToolCatalog.FALLBACK,
    private val permissionPolicy: LiteToolPermissionPolicy = LiteToolPermissionPolicies.defaultPolicy(toolCatalog),
    /** The approval seam [LiteToolDecision.Ask] calls suspend on; null folds an explicit denial — an Ask never executes unconfirmed. */
    private val ask: LiteToolAsking? = null,
    private val execute: LiteToolExecuting,
) {
    /** The live fold the driver applies each lifecycle event to. */
    val fold = LiteFold()

    /**
     * The fold's tool-row count at each round start, in order across turns —
     * the cursor that splits the fold's chronological tool rows at round
     * edges when history is exported.
     */
    private val roundToolBoundaries = mutableListOf<Int>()

    /**
     * The [roundToolBoundaries] index each turn's first round starts at, one
     * entry per accepted prompt, in turn order.
     */
    private val turnRoundStarts = mutableListOf<Int>()

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
    /**
     * Execute one approved tool call through the bundled executor and fold
     * its result — the shared body of the locally-permitted and
     * user-granted approval paths.
     */
    private suspend fun runApprovedTool(chunk: LiteStreamChunk.ToolCall) {
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
            // The fold pairs artifact/status with the artifact/created row
            // by id, so creation precedes status; the pair follows the
            // completed tool/result because the bytes exist only after the
            // executor's write, and the store's atomic put makes the
            // artifact ready the moment it lands.
            apply(
                event(
                    "artifact/created",
                    "id" to text(artifact.id),
                    "kind" to text(artifact.kind),
                    "title" to text(artifact.id),
                ),
            )
            apply(
                event(
                    "artifact/status",
                    "id" to text(artifact.id),
                    "status" to text("ready"),
                ),
            )
        }
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
            // The boundary snapshot rides between the accepted prompt and
            // the first stream: the fold's last conversation row is this
            // turn's user row and no tool row of this turn exists yet, so
            // the boundaries split the completed turns and this turn's
            // completed rounds exactly.
            turnRoundStarts.add(roundToolBoundaries.size)
            roundToolBoundaries.add(fold.state.toolCalls.size)
            try {
                var requests = 0
                while (true) {
                    val history = exportRequestHistory(fold.state, turnRoundStarts, roundToolBoundaries)
                    var assembled = ""
                    var handedOff: String? = null
                    var finish: String? = null
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
                                // on-device, an approval-gated call suspends
                                // on the seam first, a gated one hands off,
                                // and an unknown name fails explicitly.
                                when (val decision = permissionPolicy.decide(chunk.name)) {
                                    LiteToolDecision.AllowLocal -> runApprovedTool(chunk)
                                    is LiteToolDecision.Ask -> {
                                        // §38's approval face: the call waits
                                        // for the user; a denial (or no seam
                                        // at all) folds the established
                                        // failed-result vocabulary — zero new
                                        // event tags, and an Ask never
                                        // executes unconfirmed.
                                        val granted = ask?.invoke(chunk.name, chunk.arguments, decision.risk) ?: false
                                        if (granted) {
                                            runApprovedTool(chunk)
                                        } else {
                                            val reason = if (ask == null) "approval unavailable" else "user denied"
                                            apply(
                                                event(
                                                    "tool/result",
                                                    "id" to text(chunk.id),
                                                    "ok" to JsonPrimitive(false),
                                                    "text" to text("$reason on this device: " + chunk.name),
                                                ),
                                            )
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
                            is LiteStreamChunk.Finish -> finish = chunk.reason
                        }
                    }
                    if (handedOff != null) return
                    // A round that did not hand off always lands its assistant
                    // row — a text-less tool round keeps its empty row, the
                    // host's never-drop projection of an assistant message.
                    apply(event("message/completed", "text" to text(assembled)))
                    requests += 1
                    if (finish != "tool_calls" || requests >= MAX_LITE_ROUNDS_PER_TURN) {
                        apply(event("turn/completed"))
                        return
                    }
                    // A tool_calls finish continues the same turn: the
                    // completed round's boundary is recorded so the next
                    // request's history splits it as its own round.
                    roundToolBoundaries.add(fold.state.toolCalls.size)
                }
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
 * Export the request-facing history at a round start: each user row opens a
 * turn, the assistant rows after it are that turn's completed rounds in
 * order, and each round's tool rows are the fold's chronological tool list
 * between that round's boundary and the next — the same id pairing the fold
 * itself applies. The live turn rides with its already-completed rounds so
 * a continuation request replays them; before its first completion it rides
 * nothing — it is the request's own prompt row — and its in-flight round
 * has neither an assistant row nor tool rows either way. A turn whose last
 * round died mid-flight keeps its landed calls as one trailing text-less
 * round, so the next request still answers them.
 * @param state the live fold's state at the snapshot cut, with the live turn's user row already landed.
 * @param turnRoundStarts the [roundToolBoundaries] index each turn's first round starts at, one entry per accepted prompt including the live one.
 * @param roundToolBoundaries the fold's tool-row count at each round start, in order across turns.
 * @return one record per turn in turn order, minus a live turn that has completed no round.
 */
private fun exportRequestHistory(
    state: LiteDomainState,
    turnRoundStarts: List<Int>,
    roundToolBoundaries: List<Int>,
): List<LiteTurnRecord> {
    val userRowIndexes = state.conversation.indices.filter { index -> state.conversation[index].role == "user" }
    val records = userRowIndexes.mapIndexed { turn, userIndex ->
        val turnEnd = userRowIndexes.getOrNull(turn + 1) ?: state.conversation.size
        val firstRound = turnRoundStarts[turn]
        val turnEndCalls =
            if (turn + 1 < turnRoundStarts.size) roundToolBoundaries[turnRoundStarts[turn + 1]] else state.toolCalls.size
        val roundRows = (userIndex + 1..<turnEnd).filter { index -> state.conversation[index].role == "assistant" }
        val rounds = roundRows.mapIndexed { round, rowIndex ->
            historyRound(
                assistantText = state.conversation[rowIndex].text,
                calls = state.toolCalls.subList(roundToolBoundaries[firstRound + round], roundToolBoundaries[firstRound + round + 1]),
            )
        }.toMutableList()
        val trailingCalls = state.toolCalls.subList(
            roundToolBoundaries.getOrElse(firstRound + roundRows.size) { turnEndCalls },
            turnEndCalls,
        )
        if (trailingCalls.isNotEmpty()) rounds.add(historyRound(assistantText = null, calls = trailingCalls))
        LiteTurnRecord(userText = state.conversation[userIndex].text, rounds = rounds)
    }
    // The last record is the live turn: without a completed round it is the
    // request's own prompt and would duplicate its user row on the wire.
    return if (records.isNotEmpty() && records.last().rounds.isEmpty()) records.dropLast(1) else records
}

/** Fold one boundary-delimited slice of tool rows into one history round. */
private fun historyRound(assistantText: String?, calls: List<LiteToolCall>): LiteTurnRound = LiteTurnRound(
    assistantText = assistantText,
    toolCalls = calls.map { call -> LiteTurnToolCall(id = call.id, name = call.name, arguments = call.arguments) },
    toolResults = calls.associate { call -> call.id to call.resultText },
)
