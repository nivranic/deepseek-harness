package ai.deepseek.dsh.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

/** One folded timeline row: the record tag plus its rendered summary. */
data class FoldItem(val seq: Long, val kind: String, val text: String)

/** One folded todo row; the wire status rides verbatim. */
data class FoldTodo(val text: String, val status: String)

/** One folded goal row; the wire phase rides verbatim. */
data class FoldGoal(val id: String, val title: String, val state: String)

/** One folded tool invocation, paired across the wire by `callId`. */
data class FoldToolCall(
    val id: String,
    val seq: Long,
    val name: String,
    val arguments: String,
    val phase: String,
    val resultText: String,
)

/** One durable image reference collected from message content, deduplicated
 * by attachment id and ordered by first appearance. */
data class FoldImageRef(
    val attachmentId: String,
    val mediaType: String,
    val width: Double,
    val height: Double,
    val name: String?,
)

/**
 * The complete companion-visible state of one session-log cut — the Kotlin
 * half of the chapter-62 trilingual conformance: the same conformance
 * fixtures must fold to this exact shape in TypeScript, Swift, and Kotlin.
 */
data class DomainState(
    val cursor: Long = 0,
    val items: List<FoldItem> = emptyList(),
    val planActive: Boolean = false,
    val todos: List<FoldTodo> = emptyList(),
    val goals: List<FoldGoal> = emptyList(),
    val toolCalls: List<FoldToolCall> = emptyList(),
    val images: List<FoldImageRef> = emptyList(),
)

/** JavaScript number-to-string semantics: integral values drop the `.0`. */
internal fun numberText(value: Double): String =
    if (value == kotlin.math.floor(value) && !value.isInfinite()) value.toLong().toString() else value.toString()

/** One image reference rendered as the summary line all languages share. */
internal fun imageSummary(mediaType: String, width: Double, height: Double, name: String?): String {
    val shown = if (!name.isNullOrEmpty()) " $name" else ""
    return "图片$shown（$mediaType，${numberText(width)}×${numberText(height)}）"
}

/** Visible text of a content-block list: text blocks carry it directly,
 * image blocks render their reference metadata, tool-result blocks nest. */
internal fun blockText(blocks: JsonArray): String =
    blocks.mapNotNull { block ->
        val obj = block as? JsonObject ?: return@mapNotNull null
        val text = (obj["text"] as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotEmpty() }
        if (text != null) return@mapNotNull text.content
        if (obj["type"]?.jsonPrimitive?.contentOrNullSafe == "image") {
            val ref = obj["attachment"] as? JsonObject
            if (ref != null) return@mapNotNull imageSummary(
                (ref["mediaType"] as? JsonPrimitive)?.contentOrNullSafe ?: "",
                ref["width"]?.jsonPrimitive?.double ?: 0.0,
                ref["height"]?.jsonPrimitive?.double ?: 0.0,
                (ref["name"] as? JsonPrimitive)?.contentOrNullSafe,
            )
        }
        val nested = obj["content"] as? JsonArray
        if (nested != null) return@mapNotNull blockText(nested)
        null
    }.joinToString("\n")

/** Collect image references from a content-block list, nesting like
 * [blockText] and skipping ids already collected. */
internal fun collectImages(blocks: JsonArray, into: MutableList<FoldImageRef>) {
    for (element in blocks) {
        val obj = element as? JsonObject ?: continue
        val ref = obj["attachment"] as? JsonObject
        if (obj["type"]?.jsonPrimitive?.contentOrNullSafe == "image" && ref != null) {
            val id = (ref["attachmentId"] as? JsonPrimitive)?.contentOrNullSafe
            if (id != null && into.none { it.attachmentId == id }) {
                val name = (ref["name"] as? JsonPrimitive)?.contentOrNullSafe
                into.add(
                    FoldImageRef(
                        attachmentId = id,
                        mediaType = (ref["mediaType"] as? JsonPrimitive)?.contentOrNullSafe ?: "",
                        width = ref["width"]?.jsonPrimitive?.double ?: 0.0,
                        height = ref["height"]?.jsonPrimitive?.double ?: 0.0,
                        name = if (name.isNullOrEmpty()) null else name,
                    ),
                )
            }
        } else {
            val nested = obj["content"] as? JsonArray ?: continue
            collectImages(nested, into)
        }
    }
}

/** The turn-end summary line every language renders identically. */
internal fun turnEndSummary(turn: Double, reasonKind: String): String = when (reasonKind) {
    "completed" -> "第 ${numberText(turn)} 轮完成"
    "aborted" -> "第 ${numberText(turn)} 轮已中止"
    "blocked" -> "第 ${numberText(turn)} 轮被阻断"
    "error" -> "第 ${numberText(turn)} 轮出错"
    "max-tokens" -> "第 ${numberText(turn)} 轮达到输出上限"
    "interrupted" -> "第 ${numberText(turn)} 轮因中断收尾"
    else -> ""
}

/** Non-string primitives read as absent; JSON null reads as absent here. */
private val JsonPrimitive?.contentOrNullSafe: String?
    get() = if (this != null && isString) content else null

/** The per-tag summary every language renders identically; unknown tags stay empty. */
internal fun renderEvent(tag: String, data: JsonObject?): String {
    if (data == null) return ""
    return when (tag) {
        "turn/start" -> "第 ${numberText(data["turn"]?.jsonPrimitive?.double ?: 0.0)} 轮开始"
        "turn/end" -> turnEndSummary(
            data["turn"]?.jsonPrimitive?.double ?: 0.0,
            data.getReasonKind(),
        )
        "step/start", "step/end", "session/end-seed" -> ""
        "user/message" -> blockText(data["content"]?.jsonArray ?: JsonArray(emptyList()))
        "assistant/chunk" -> {
            val chunk = data["chunk"] as? JsonObject
            val text = (chunk?.get("text") as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (!text.isNullOrEmpty()) text else ""
        }
        "assistant/message" -> {
            val message = data["message"] as? JsonObject
            val base = blockText(message?.get("content")?.jsonArray ?: JsonArray(emptyList()))
            val interrupted = (data["interrupted"] as? JsonPrimitive)?.booleanOrNullSafe == true
            if (interrupted && base.isNotEmpty()) "$base（已中断）" else base
        }
        "tool/call" -> "调用工具 ${data["name"]?.jsonPrimitive?.contentOrNullSafe ?: ""}"
        "tool/result" -> {
            val error = data["error"] as? JsonObject
            if (error != null) {
                "工具失败：${error["name"]?.jsonPrimitive?.contentOrNullSafe ?: ""}"
            } else {
                val message = data["message"] as? JsonObject
                blockText(message?.get("content")?.jsonArray ?: JsonArray(emptyList()))
            }
        }
        "plan/mode" -> if (data["active"]?.jsonPrimitive?.booleanOrNullSafe == true) "进入计划模式" else "退出计划模式"
        "todo/write" -> {
            val todos = data["todos"]?.jsonArray ?: JsonArray(emptyList())
            "更新待办（${todos.size} 项）"
        }
        "goal/change" -> {
            val goal = data["goal"] as? JsonObject
            if (goal != null) "目标：${goal["objective"]?.jsonPrimitive?.contentOrNullSafe ?: ""}" else "目标已清除"
        }
        "chunkrow/text-chunks", "chunkrow/reasoning-chunks" -> {
            val texts = data["texts"]?.jsonArray ?: JsonArray(emptyList())
            texts.joinToString("") { (it as? JsonPrimitive)?.contentOrNullSafe ?: "" }
        }
        "chunkrow/tool-call-chunks" -> ""
        else -> ""
    }
}

private fun JsonObject.getReasonKind(): String {
    val reason = this["reason"] as? JsonObject ?: return ""
    return (reason["kind"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
}

private val JsonPrimitive?.booleanOrNullSafe: Boolean?
    get() = if (this != null && content == "true") true else if (this != null && content == "false") false else null

/** Mutable accumulator the fold loop mutates in place. */
private class FoldAccumulator {
    var cursor: Long = 0
    val items = mutableListOf<FoldItem>()
    var planActive = false
    var todos: List<FoldTodo> = emptyList()
    var goals: List<FoldGoal> = emptyList()
    val toolCalls = mutableListOf<FoldToolCall>()
    val images = mutableListOf<FoldImageRef>()
}

/**
 * Fold more records into an existing state — the incremental form live
 * follow consumption needs: each arriving event folds onto what the
 * snapshot already produced.
 */
fun foldInto(previous: DomainState, records: JsonArray): DomainState {
    val state = FoldAccumulator()
    state.cursor = previous.cursor
    state.items.addAll(previous.items)
    state.planActive = previous.planActive
    state.todos = previous.todos
    state.goals = previous.goals
    state.toolCalls.addAll(previous.toolCalls)
    state.images.addAll(previous.images)
    foldRecords(state, records)
    return state.toDomainState()
}

/**
 * Fold the conformance record sequence into the domain state — the exact
 * mirror of the TypeScript reference fold and the Swift fold: whole-value
 * pane states are last-write-wins, the trajectory pairs calls with results
 * by `callId` and tolerates orphan results as no-ops, and image references
 * collect in first-appearance order.
 */
fun foldDomain(records: JsonArray): DomainState {
    val state = FoldAccumulator()
    foldRecords(state, records)
    return state.toDomainState()
}

private fun FoldAccumulator.toDomainState() = DomainState(
    cursor = cursor,
    items = items.toList(),
    planActive = planActive,
    todos = todos,
    goals = goals,
    toolCalls = toolCalls.toList(),
    images = images.toList(),
)

private fun foldRecords(state: FoldAccumulator, records: JsonArray) {
    for (element in records) {
        val record = element as? JsonObject ?: continue
        val event = record["event"] as? JsonObject ?: continue
        val tag = (event["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
        val seq = event["seq"]?.jsonPrimitive?.long ?: 0L
        val data = event["data"] as? JsonObject
        if (seq > state.cursor) state.cursor = seq
        state.items.add(FoldItem(seq, tag, renderEvent(tag, data)))
        when (tag) {
            "plan/mode" -> state.planActive = data?.get("active")?.jsonPrimitive?.booleanOrNullSafe == true
            "todo/write" -> state.todos = (data?.get("todos")?.jsonArray ?: JsonArray(emptyList())).mapNotNull { entry ->
                val obj = entry as? JsonObject ?: return@mapNotNull null
                FoldTodo(
                    text = obj["content"]?.jsonPrimitive?.contentOrNullSafe ?: "",
                    status = obj["status"]?.jsonPrimitive?.contentOrNullSafe ?: "",
                )
            }
            "goal/change" -> {
                val goal = data?.get("goal") as? JsonObject
                state.goals = if (goal != null) {
                    listOf(
                        FoldGoal(
                            id = goal["id"]?.jsonPrimitive?.contentOrNullSafe ?: "",
                            title = goal["objective"]?.jsonPrimitive?.contentOrNullSafe ?: "",
                            state = goal["phase"]?.jsonPrimitive?.contentOrNullSafe ?: "",
                        ),
                    )
                } else {
                    emptyList()
                }
            }
            "tool/call" -> state.toolCalls.add(
                FoldToolCall(
                    id = data?.get("callId")?.jsonPrimitive?.contentOrNullSafe ?: "",
                    seq = seq,
                    name = data?.get("name")?.jsonPrimitive?.contentOrNullSafe ?: "",
                    arguments = data?.get("arguments")?.jsonPrimitive?.contentOrNullSafe ?: "",
                    phase = "running",
                    resultText = "",
                ),
            )
            "tool/result" -> {
                val message = data?.get("message") as? JsonObject ?: continue
                collectImages(message["content"]?.jsonArray ?: JsonArray(emptyList()), state.images)
                val first = message["content"]?.jsonArray?.firstOrNull() as? JsonObject
                val callId = (first?.get("toolCallId") as? JsonPrimitive)?.takeIf { it.isString }?.content
                val index = if (callId == null) -1 else state.toolCalls.indexOfFirst { it.id == callId }
                if (index == -1) continue
                val target = state.toolCalls[index]
                state.toolCalls[index] = target.copy(
                    phase = if (data?.get("error") is JsonObject) "failed" else "completed",
                    resultText = blockText(message["content"]?.jsonArray ?: JsonArray(emptyList())),
                )
            }
            "user/message" -> collectImages(
                (data?.get("content") as? JsonArray) ?: JsonArray(emptyList()),
                state.images,
            )
            "assistant/message" -> collectImages(
                ((data?.get("message") as? JsonObject)?.get("content") as? JsonArray) ?: JsonArray(emptyList()),
                state.images,
            )
        }
    }
}

/** Canonical JSON form of the state — integral numbers as bare integers, an
 * absent image name omitted — so conformance compares against the expected
 * fixture bytes structurally. */
fun DomainState.toJson(): JsonElement = buildJsonObject {
    put("cursor", cursor)
    put("items", JsonArray(items.map { item ->
        buildJsonObject {
            put("seq", item.seq)
            put("kind", item.kind)
            put("text", item.text)
        }
    }))
    put("planActive", planActive)
    put("todos", JsonArray(todos.map { todo ->
        buildJsonObject {
            put("text", todo.text)
            put("status", todo.status)
        }
    }))
    put("goals", JsonArray(goals.map { goal ->
        buildJsonObject {
            put("id", goal.id)
            put("title", goal.title)
            put("state", goal.state)
        }
    }))
    put("toolCalls", JsonArray(toolCalls.map { call ->
        buildJsonObject {
            put("id", call.id)
            put("seq", call.seq)
            put("name", call.name)
            put("arguments", call.arguments)
            put("phase", call.phase)
            put("resultText", call.resultText)
        }
    }))
    put("images", JsonArray(images.map { ref ->
        buildJsonObject {
            put("attachmentId", ref.attachmentId)
            put("mediaType", ref.mediaType)
            put("width", numberElement(ref.width))
            put("height", numberElement(ref.height))
            if (ref.name != null) put("name", ref.name)
        }
    }))
}

private fun numberElement(value: Double): JsonElement =
    if (value == kotlin.math.floor(value) && !value.isInfinite()) JsonPrimitive(value.toLong()) else JsonPrimitive(value)

/** Parse one conformance scenario document. */
fun parseScenario(text: String): Pair<JsonArray, JsonObject> {
    val document = Json.parseToJsonElement(text).jsonObject
    val records = document["records"]?.jsonArray ?: JsonArray(emptyList())
    val expected = document["expected"]?.jsonObject ?: JsonObject(emptyMap())
    return Pair(records, expected)
}
