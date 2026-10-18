package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LiteToolSchema
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/** One parsed streaming line: either server-sent events (`data: {…}` lines
 * with a `[DONE]` terminator) or bare NDJSON, in the OpenAI-compatible
 * chat-completions delta shape DeepSeek serves. Tool-call deltas stay raw
 * entries — argument fragments need cross-line assembly first. */
sealed interface LiteStreamPiece {
    data class Text(val text: String) : LiteStreamPiece

    data class Reasoning(val text: String) : LiteStreamPiece

    data class ToolCallEntries(val entries: List<JsonObject>) : LiteStreamPiece
}

/** Parse one raw line into its piece kind. */
object LiteStreamLineParser {
    /**
     * Decode one raw line into a piece, if it carries one.
     * @param line one trimmed-or-raw stream line.
     * @return the piece, or null for blanks, `data: [DONE]`, and
     * non-payload lines (comments, event names, non-delta objects).
     */
    fun parsePiece(line: String): LiteStreamPiece? {
        val trimmed = line.trim()
        if (trimmed.isEmpty() || trimmed.startsWith(":")) return null
        val payload = if (trimmed.startsWith("data:")) trimmed.removePrefix("data:").trim() else trimmed
        if (payload == "[DONE]") return null
        val root = runCatching { Json.parseToJsonElement(payload) }.getOrNull() as? JsonObject ?: return null
        val choices = root["choices"] as? JsonArray ?: return null
        val delta = (choices.firstOrNull() as? JsonObject)?.get("delta") as? JsonObject ?: return null
        val reasoning = delta.stringField("reasoning_content")?.takeIf { it.isNotEmpty() }
        if (reasoning != null) return LiteStreamPiece.Reasoning(reasoning)
        val text = delta.stringField("content")?.takeIf { it.isNotEmpty() }
        if (text != null) return LiteStreamPiece.Text(text)
        val calls = (delta["tool_calls"] as? JsonArray)?.filterIsInstance<JsonObject>()
        if (!calls.isNullOrEmpty()) return LiteStreamPiece.ToolCallEntries(calls)
        return null
    }
}

private fun JsonObject.stringField(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

/**
 * Assembles fragmented tool-call deltas into whole calls the loop can
 * dispatch: the wire identifies each call slot by `index`, the first delta
 * of a slot carries `id` and the function `name`, later deltas append
 * argument fragments, and the completed calls flush in index order once the
 * stream ends — the moment an OpenAI-compatible stream is complete.
 */
class LiteToolCallAssembler {
    private class Slot(val id: String, var name: String, val arguments: StringBuilder)

    private val slots = sortedMapOf<Int, Slot>()

    /** Fold one raw `tool_calls` entry into its slot. */
    fun ingest(entry: JsonObject) {
        val index = (entry["index"] as? JsonPrimitive)?.intOrNull ?: 0
        val function = entry["function"] as? JsonObject ?: JsonObject(emptyMap())
        val slot = slots.getOrPut(index) {
            Slot(id = entry.stringField("id") ?: "tool-$index", name = function.stringField("name") ?: "", arguments = StringBuilder())
        }
        val name = function.stringField("name")
        if (!name.isNullOrEmpty() && slot.name.isEmpty()) slot.name = name
        function.stringField("arguments")?.let { fragment -> slot.arguments.append(fragment) }
    }

    /**
     * Flush every assembled call in index order; a slot that never received
     * a name is dropped, not dispatched half-formed.
     * @return whole-call chunks for the loop.
     */
    fun finish(): List<LiteStreamChunk.ToolCall> {
        val chunks = slots.values
            .filter { it.name.isNotEmpty() }
            .map { LiteStreamChunk.ToolCall(id = it.id, name = it.name, arguments = it.arguments.toString()) }
        slots.clear()
        return chunks
    }
}

/**
 * Map a transport failure to its network-error kind — URLError's semantics
 * on the OkHttp stack: every timeout flavor raises SocketTimeoutException
 * and reads as `timeout`, name-resolution and connection refusals are
 * `unreachable`, and everything else reads as a dropped transport.
 * @param failure the transport failure.
 * @return the spec vocabulary for it.
 */
fun classifyTransportFailure(failure: IOException): LiteTransportError.Network = when (failure) {
    is SocketTimeoutException -> LiteTransportError.Network("timeout")
    is UnknownHostException, is ConnectException -> LiteTransportError.Network("unreachable")
    else -> LiteTransportError.Network("dropped")
}

/**
 * The real-provider seam: an OpenAI-compatible streaming chat completion
 * per prompt, decoded line by line into Lite chunks; fragmented tool-call
 * deltas are assembled before the loop sees them. The projected tool
 * schemas ride the request's `tools` array — an empty list omits the key
 * entirely, the host provider's line form.
 */
class LiteHTTPProvider(
    private val endpoint: String,
    private val apiKey: String,
    private val model: String,
    /** The Host-projected model-face tool schemas sent as the request's `tools` array; construction input, never per-call state. */
    private val toolSchemas: List<LiteToolSchema> = emptyList(),
) : LiteProviding {
    // The Link stream-transport shape: connect and write timeouts fence a
    // dead endpoint, while the read and call timeouts stay disabled because
    // an idle long-lived stream must outlive any fixed bound.
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.SECONDS)
        .build()

    /**
     * Stream one response's chunks for a submitted prompt.
     * @param prompt the accepted user prompt text.
     * @param system the session's assembled system prompt; a null or empty value leaves the request messages byte-identical to a bare turn.
     * @param history the completed prior turns, expanded ahead of the new user row in the host provider's wire order so the model sees its own tool calls and their result texts.
     * @return the ordered chunks of one model response.
     */
    override suspend fun stream(prompt: String, system: String?, history: List<LiteTurnRecord>): Flow<LiteStreamChunk> = flow {
        val body = buildJsonObject {
            put("model", model)
            put("stream", true)
            put("messages", JsonArray(buildList {
                if (!system.isNullOrEmpty()) {
                    add(buildJsonObject {
                        put("role", "system")
                        put("content", system)
                    })
                }
                history.forEach { turn -> addAll(turn.wireMessages()) }
                add(buildJsonObject {
                    put("role", "user")
                    put("content", prompt)
                })
            }))
            // The system prompt and the tool schemas are both request-face
            // construction context: they ride the provider request and never
            // the event journal. An empty schema list omits the tools key.
            if (toolSchemas.isNotEmpty()) {
                put("tools", JsonArray(toolSchemas.map { schema -> buildJsonObject {
                    put("type", "function")
                    put("function", buildJsonObject {
                        put("name", schema.name)
                        put("description", schema.description)
                        put("parameters", schema.parameters)
                    })
                } }))
            }
        }.toString()
        // The host provider's request face: Bearer auth, JSON content type,
        // and the SSE accept header.
        val request = Request.Builder()
            .url(endpoint)
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .header("authorization", "Bearer $apiKey")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        val assembler = LiteToolCallAssembler()
        var sawDone = false
        val response = try {
            client.newCall(request).execute()
        } catch (failure: IOException) {
            throw classifyTransportFailure(failure)
        }
        response.use {
            if (!it.isSuccessful) {
                throw LiteTransportError.Provider(code = "HTTP_${it.code}", message = "provider refused the request")
            }
            it.body.source().use { source ->
                while (true) {
                    val line = try {
                        source.readUtf8Line()
                    } catch (failure: IOException) {
                        // A failure mid-stream is still a transport failure;
                        // nothing else can reach this catch from a body read.
                        throw classifyTransportFailure(failure)
                    } ?: break
                    if (terminatesTheStream(line)) {
                        sawDone = true
                        continue
                    }
                    when (val piece = LiteStreamLineParser.parsePiece(line)) {
                        is LiteStreamPiece.Text -> emit(LiteStreamChunk.Text(piece.text))
                        is LiteStreamPiece.Reasoning -> emit(LiteStreamChunk.Reasoning(piece.text))
                        is LiteStreamPiece.ToolCallEntries -> piece.entries.forEach(assembler::ingest)
                        null -> {}
                    }
                }
            }
        }
        // The host's STREAM_CLOSED rule: EOF before the [DONE] terminator is
        // a truncated response the loop cannot trust, so the assembled tool
        // calls never flush.
        if (!sawDone) {
            throw LiteTransportError.Provider(code = "STREAM_CLOSED", message = "SSE stream ended without [DONE]")
        }
        assembler.finish().forEach { emit(it) }
    }.flowOn(Dispatchers.IO)
}

/** Whether one raw line is the `data: [DONE]` terminator — the parser folds
 * that line to null, so this check applies the same payload extraction to
 * tell truncation apart from comment and blank lines. */
private fun terminatesTheStream(line: String): Boolean {
    val trimmed = line.trim()
    val payload = if (trimmed.startsWith("data:")) trimmed.removePrefix("data:").trim() else trimmed
    return payload == "[DONE]"
}

/**
 * Expand one history turn into its OpenAI-compatible wire rows, the host
 * provider's line form (llm-deepseek serialize.ts): the user row verbatim,
 * then — when the turn carries tool calls — the assistant row holding the
 * calls with `""` content for a text-less reply, followed by one tool row
 * per call id in call order carrying the fold's result text, `'(no output)'`
 * when it is empty; a turn with neither reply text nor calls keeps its user
 * row only, the host's empty-assistant projection rule (a content-less
 * assistant row never reaches the wire).
 */
private fun LiteTurnRecord.wireMessages(): List<JsonObject> = buildList {
    add(buildJsonObject {
        put("role", "user")
        put("content", userText)
    })
    if (toolCalls.isNotEmpty()) {
        add(buildJsonObject {
            put("role", "assistant")
            put("content", assistantText ?: "")
            put("tool_calls", JsonArray(toolCalls.map { call -> buildJsonObject {
                put("id", call.id)
                put("type", "function")
                put("function", buildJsonObject {
                    put("name", call.name)
                    put("arguments", call.arguments)
                })
            } }))
        })
        toolCalls.forEach { call ->
            add(buildJsonObject {
                put("role", "tool")
                put("tool_call_id", call.id)
                put("content", (toolResults[call.id] ?: "").ifEmpty { "(no output)" })
            })
        }
    } else if (!assistantText.isNullOrEmpty()) {
        add(buildJsonObject {
            put("role", "assistant")
            put("content", assistantText)
        })
    }
}
