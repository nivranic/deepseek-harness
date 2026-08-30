package ai.deepseek.dsh.companion

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Why a Lite turn ended. */
typealias LiteTurnEnd = String

/** One completed conversation row. */
data class LiteMessage(val role: String, val text: String, val interrupted: Boolean = false)

/** One todo row; the wire status rides verbatim. */
data class LiteTodo(val content: String, val status: String)

/** One tool invocation, paired by id. */
data class LiteToolCall(
    val id: String,
    val name: String,
    val arguments: String,
    val phase: String,
    val resultText: String,
)

/** One artifact reference — metadata only; content never rides the spec (chapter 56). */
data class LiteArtifact(val id: String, val kind: String, val title: String, val status: String)

/** One recorded failure. */
data class LiteFailure(val kind: String, val code: String, val message: String)

/** The live-stream pane: whether a turn is streaming and its delivered partials. */
data class LiteStreaming(val active: Boolean = false, val partialText: String = "", val partialReasoning: String = "")

/**
 * The complete Lite-visible runtime state at one event cut — the Kotlin half
 * of the Lite Behavior-Spec conformance: the same lite-conformance fixtures
 * the TypeScript reference fold and the Swift Lite fold replay must fold to
 * this exact state here.
 */
data class LiteDomainState(
    val conversation: List<LiteMessage> = emptyList(),
    val streaming: LiteStreaming = LiteStreaming(),
    val interrupted: Boolean = false,
    val toolCalls: List<LiteToolCall> = emptyList(),
    val planActive: Boolean = false,
    val todos: List<LiteTodo> = emptyList(),
    val artifacts: List<LiteArtifact> = emptyList(),
    val lastTurnEnd: LiteTurnEnd? = null,
    val errors: List<LiteFailure> = emptyList(),
    val pendingHandoff: String? = null,
)

/** The state before any event arrives. */
fun emptyLiteDomain(): LiteDomainState = LiteDomainState()

/**
 * Fold a complete Lite event sequence into the runtime state — the exact
 * mirror of the TypeScript reference fold and the Swift Lite fold: a cancel
 * finalizes the delivered stream prefix as an interrupted assistant row, a
 * dropped transport keeps the prefix for resume, and whole-value panes are
 * last-write-wins.
 * @param events ordered Lite lifecycle events as raw JSON objects.
 * @returns the derived domain state.
 */
fun foldLiteDomain(events: JsonArray): LiteDomainState {
    val state = LiteFoldAccumulator()
    for (element in events) {
        val event = element as? JsonObject ?: continue
        foldLiteEventInto(state, event)
    }
    return state.toLiteDomainState()
}

/** Mutable accumulator the fold loop mutates in place. */
private class LiteFoldAccumulator {
    val conversation = mutableListOf<LiteMessage>()
    var streaming = LiteStreaming()
    var interrupted = false
    val toolCalls = mutableListOf<LiteToolCall>()
    var planActive = false
    var todos: List<LiteTodo> = emptyList()
    val artifacts = mutableListOf<LiteArtifact>()
    var lastTurnEnd: LiteTurnEnd? = null
    val errors = mutableListOf<LiteFailure>()
    var pendingHandoff: String? = null
}

private fun LiteFoldAccumulator.toLiteDomainState() = LiteDomainState(
    conversation = conversation.toList(),
    streaming = streaming,
    interrupted = interrupted,
    toolCalls = toolCalls.toList(),
    planActive = planActive,
    todos = todos,
    artifacts = artifacts.toList(),
    lastTurnEnd = lastTurnEnd,
    errors = errors.toList(),
    pendingHandoff = pendingHandoff,
)

private fun JsonObject.stringField(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.booleanField(name: String): Boolean? =
    this[name]?.jsonPrimitive?.booleanOrNull

/**
 * Fold one Lite lifecycle event into the runtime state. Unknown tags are
 * no-ops; the events arrive from the pinned Lite fixtures and journals, so
 * the vocabulary is closed.
 */
private fun foldLiteEventInto(state: LiteFoldAccumulator, event: JsonObject) {
    when (event.stringField("type")) {
        "prompt/accepted" -> state.conversation.add(LiteMessage(role = "user", text = event.stringField("content") ?: ""))
        "prompt/rejected" -> state.errors.add(
            LiteFailure(kind = "provider", code = "PROMPT_REJECTED", message = event.stringField("reason") ?: ""),
        )
        "stream/delta" -> state.streaming = state.streaming.copy(
            active = true,
            partialText = state.streaming.partialText + (event.stringField("text") ?: ""),
        )
        "stream/reasoning" -> state.streaming = state.streaming.copy(
            active = true,
            partialReasoning = state.streaming.partialReasoning + (event.stringField("text") ?: ""),
        )
        "message/completed" -> {
            state.conversation.add(LiteMessage(role = "assistant", text = event.stringField("text") ?: ""))
            state.streaming = LiteStreaming()
        }
        "turn/completed" -> state.lastTurnEnd = "completed"
        "turn/cancelled" -> {
            if (state.streaming.active && state.streaming.partialText.isNotEmpty()) {
                state.conversation.add(LiteMessage(role = "assistant", text = state.streaming.partialText, interrupted = true))
                state.interrupted = true
            }
            state.streaming = LiteStreaming()
            state.lastTurnEnd = "cancelled"
        }
        "tool/call" -> state.toolCalls.add(
            LiteToolCall(
                id = event.stringField("id") ?: "",
                name = event.stringField("name") ?: "",
                arguments = event.stringField("arguments") ?: "",
                phase = "running",
                resultText = "",
            ),
        )
        "tool/result" -> {
            val id = event.stringField("id")
            val index = if (id == null) -1 else state.toolCalls.indexOfFirst { it.id == id }
            if (index != -1) {
                val target = state.toolCalls[index]
                state.toolCalls[index] = target.copy(
                    phase = if (event.booleanField("ok") == true) "completed" else "failed",
                    resultText = event.stringField("text") ?: "",
                )
            }
        }
        "plan/changed" -> state.planActive = event.booleanField("active") == true
        "todo/changed" -> state.todos = (event["todos"] as? JsonArray ?: JsonArray(emptyList())).mapNotNull { entry ->
            val obj = entry as? JsonObject ?: return@mapNotNull null
            LiteTodo(
                content = obj.stringField("content") ?: "",
                status = obj.stringField("status") ?: "",
            )
        }
        "artifact/created" -> state.artifacts.add(
            LiteArtifact(
                id = event.stringField("id") ?: "",
                kind = event.stringField("kind") ?: "",
                title = event.stringField("title") ?: "",
                status = "pending",
            ),
        )
        "artifact/status" -> {
            val id = event.stringField("id")
            val index = if (id == null) -1 else state.artifacts.indexOfFirst { it.id == id }
            if (index != -1) {
                state.artifacts[index] = state.artifacts[index].copy(status = event.stringField("status") ?: "")
            }
        }
        "provider/error" -> {
            state.errors.add(LiteFailure(kind = "provider", code = event.stringField("code") ?: "", message = event.stringField("message") ?: ""))
            state.streaming = LiteStreaming()
            state.lastTurnEnd = "provider-error"
        }
        "network/error" -> {
            // A dropped transport keeps the delivered prefix for resume; the
            // stream is no longer live.
            state.streaming = state.streaming.copy(active = false)
            val kind = event.stringField("kind") ?: ""
            state.errors.add(LiteFailure(kind = "network", code = kind, message = kind))
            state.lastTurnEnd = "network-error"
        }
        "handoff/requested" -> state.pendingHandoff = event.stringField("capability")
    }
}

/**
 * Canonical JSON form of the state — an interrupted marker only on rows it
 * is true for, booleans and nullable ends verbatim — so conformance compares
 * against the expected fixture bytes structurally.
 */
fun LiteDomainState.toJson(): JsonElement = buildJsonObject {
    put("conversation", JsonArray(conversation.map { message ->
        buildJsonObject {
            put("role", message.role)
            put("text", message.text)
            if (message.interrupted) put("interrupted", true)
        }
    }))
    put("streaming", buildJsonObject {
        put("active", streaming.active)
        put("partialText", streaming.partialText)
        put("partialReasoning", streaming.partialReasoning)
    })
    put("interrupted", interrupted)
    put("toolCalls", JsonArray(toolCalls.map { call ->
        buildJsonObject {
            put("id", call.id)
            put("name", call.name)
            put("arguments", call.arguments)
            put("phase", call.phase)
            put("resultText", call.resultText)
        }
    }))
    put("planActive", planActive)
    put("todos", JsonArray(todos.map { todo ->
        buildJsonObject {
            put("content", todo.content)
            put("status", todo.status)
        }
    }))
    put("artifacts", JsonArray(artifacts.map { artifact ->
        buildJsonObject {
            put("id", artifact.id)
            put("kind", artifact.kind)
            put("title", artifact.title)
            put("status", artifact.status)
        }
    }))
    put("lastTurnEnd", JsonPrimitive(lastTurnEnd))
    put("errors", JsonArray(errors.map { failure ->
        buildJsonObject {
            put("kind", failure.kind)
            put("code", failure.code)
            put("message", failure.message)
        }
    }))
    put("pendingHandoff", JsonPrimitive(pendingHandoff))
}

/** Parse one lite-conformance scenario document. */
fun parseLiteScenario(text: String): Pair<JsonArray, JsonObject> {
    val document = kotlinx.serialization.json.Json.parseToJsonElement(text).jsonObject
    val events = document["events"]?.jsonArray ?: JsonArray(emptyList())
    val expected = document["expected"]?.jsonObject ?: JsonObject(emptyMap())
    return Pair(events, expected)
}
