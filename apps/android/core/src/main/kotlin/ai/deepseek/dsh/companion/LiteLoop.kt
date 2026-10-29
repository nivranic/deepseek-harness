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
     * @return the ordered chunks of one model response.
     */
    suspend fun stream(prompt: String): Flow<LiteStreamChunk>
}

/** A scripted provider: one prompt-matched chunk script, for tests and previews. */
class ScriptedLiteProvider(private val scripts: Map<String, List<LiteStreamChunk>>) : LiteProviding {
    /** The prompts streamed so far, in order. */
    val submitted = mutableListOf<String>()

    override suspend fun stream(prompt: String): Flow<LiteStreamChunk> {
        submitted.add(prompt)
        return (scripts[prompt] ?: emptyList()).asFlow()
    }
}

/** One bundled-tool execution outcome. */
data class LiteToolOutcome(val ok: Boolean, val text: String)

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
 * the streamed chunks into the Behavior-Spec state, dispatches bundled
 * tools through the registry, and emits the handoff marker when a tool
 * demands the full runtime instead of executing on-device.
 */
class LiteLoopDriver(
    private val scope: CoroutineScope,
    private val provider: LiteProviding,
    private val onEventApplied: ((LiteDomainState) -> Unit)? = null,
    private val execute: LiteToolExecuting,
) {
    /** The live fold the driver applies each lifecycle event to. */
    val fold = LiteFold()

    /** Whether a turn is currently driving. */
    var running = false
        private set

    private var job: Job? = null

    /**
     * Submit one prompt and drive its response to the terminal event; a new
     * submission replaces any in-flight turn.
     * @param prompt the accepted user prompt text.
     * @return the turn's Job — joining it waits for the terminal event.
     */
    fun submit(prompt: String): Job {
        job?.cancel()
        val turn = scope.launch { drive(prompt) }
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

    private suspend fun drive(prompt: String) {
        running = true
        try {
            apply(event("prompt/accepted", "requestId" to text("lite-${java.util.UUID.randomUUID()}"), "content" to text(prompt)))
            try {
                var assembled = ""
                var handedOff: String? = null
                provider.stream(prompt).collect { chunk ->
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
                            // A tool the registry cannot serve on-device hands
                            // off instead of executing; the loop stops at the
                            // marker.
                            val capability = LiteToolRegistry.handoffCapability(chunk.name)
                            if (capability != null) {
                                apply(event("handoff/requested", "capability" to text(capability)))
                                handedOff = capability
                                return@collect
                            }
                            if (LiteToolRegistry.tool(chunk.name) == null) return@collect
                            val outcome = execute(chunk.id, chunk.name, chunk.arguments)
                            apply(
                                event(
                                    "tool/result",
                                    "id" to text(chunk.id),
                                    "ok" to JsonPrimitive(outcome.ok),
                                    "text" to text(outcome.text),
                                ),
                            )
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
