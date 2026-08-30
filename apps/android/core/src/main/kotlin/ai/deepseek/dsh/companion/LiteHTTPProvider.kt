package ai.deepseek.dsh.companion

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException

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
 * on the JDK stack: timeouts are `timeout`, name-resolution and connection
 * refusals are `unreachable`, and everything else reads as a dropped
 * transport.
 * @param failure the transport failure.
 * @return the spec vocabulary for it.
 */
fun classifyTransportFailure(failure: IOException): LiteTransportError.Network = when (failure) {
    is HttpTimeoutException, is SocketTimeoutException -> LiteTransportError.Network("timeout")
    is UnknownHostException, is ConnectException -> LiteTransportError.Network("unreachable")
    else -> LiteTransportError.Network("dropped")
}

/**
 * The real-provider seam: an OpenAI-compatible streaming chat completion
 * per prompt, decoded line by line into Lite chunks; fragmented tool-call
 * deltas are assembled before the loop sees them.
 */
class LiteHTTPProvider(
    private val endpoint: String,
    private val apiKey: String,
    private val model: String,
) : LiteProviding {
    private val client: HttpClient = HttpClient.newHttpClient()

    /**
     * Stream one response's chunks for a submitted prompt.
     * @param prompt the accepted user prompt text.
     * @return the ordered chunks of one model response.
     */
    override suspend fun stream(prompt: String): Flow<LiteStreamChunk> = flow {
        val body = buildJsonObject {
            put("model", model)
            put("stream", true)
            put("messages", JsonArray(listOf(buildJsonObject {
                put("role", "user")
                put("content", prompt)
            })))
        }.toString()
        val request = HttpRequest.newBuilder()
            .uri(URI.create(endpoint))
            // The JDK client has no default timeout; a bounded request
            // mirrors URLSession's default and keeps a dead endpoint from
            // blocking the loop forever.
            .timeout(java.time.Duration.ofSeconds(60))
            .header("content-type", "application/json")
            .header("authorization", "Bearer $apiKey")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        val response = try {
            client.send(request, HttpResponse.BodyHandlers.ofInputStream())
        } catch (failure: IOException) {
            throw classifyTransportFailure(failure)
        }
        if (response.statusCode() !in 200..299) {
            throw LiteTransportError.Provider(code = "HTTP_${response.statusCode()}", message = "provider refused the request")
        }
        val assembler = LiteToolCallAssembler()
        try {
            response.body().bufferedReader().useLines { lines ->
                for (line in lines) {
                    when (val piece = LiteStreamLineParser.parsePiece(line)) {
                        is LiteStreamPiece.Text -> emit(LiteStreamChunk.Text(piece.text))
                        is LiteStreamPiece.Reasoning -> emit(LiteStreamChunk.Reasoning(piece.text))
                        is LiteStreamPiece.ToolCallEntries -> piece.entries.forEach(assembler::ingest)
                        null -> {}
                    }
                }
            }
        } catch (failure: IOException) {
            // A failure mid-stream is still a transport failure; nothing
            // else can reach this catch from a body read.
            throw classifyTransportFailure(failure)
        }
        assembler.finish().forEach { emit(it) }
    }
}
