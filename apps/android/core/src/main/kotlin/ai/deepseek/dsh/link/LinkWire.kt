package ai.deepseek.dsh.link

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * A JSON value carried straight through either envelope direction — the
 * Kotlin mirror of the Swift `LinkWire.WireValue` and the TypeScript
 * reference client's pass-through JSON: encoded into request payloads,
 * decoded out of response results and stream frames.
 */
sealed class WireValue {
    data class StringValue(val value: String) : WireValue()

    data class NumberValue(val value: Double) : WireValue()

    data class BoolValue(val value: Boolean) : WireValue()

    data object NullValue : WireValue()

    data class ArrayValue(val items: List<WireValue>) : WireValue()

    data class ObjectValue(val entries: Map<String, WireValue>) : WireValue()

    /** Canonical JSON tree form for encoding. */
    fun toJsonElement(): JsonElement = when (this) {
        is StringValue -> JsonPrimitive(value)
        is NumberValue -> if (value == kotlin.math.floor(value) && !value.isInfinite()) JsonPrimitive(value.toLong()) else JsonPrimitive(value)
        is BoolValue -> JsonPrimitive(value)
        is NullValue -> JsonNull
        is ArrayValue -> JsonArray(items.map { it.toJsonElement() })
        is ObjectValue -> buildJsonObject {
            for ((key, inner) in entries) put(key, inner.toJsonElement())
        }
    }

    companion object {
        /** Parse one JSON tree into the pass-through value. */
        fun fromJsonElement(element: JsonElement): WireValue = when (element) {
            is JsonPrimitive -> when {
                element.isString -> StringValue(element.content)
                element.booleanOrNull != null -> BoolValue(element.booleanOrNull!!)
                element.contentOrNullSafe == "null" -> NullValue
                else -> NumberValue(element.content.toDouble())
            }
            is JsonArray -> ArrayValue(element.map { fromJsonElement(it) })
            is JsonObject -> ObjectValue(element.entries.associate { (key, inner) -> key to fromJsonElement(inner) })
            JsonNull -> NullValue
        }
    }
}

private val JsonPrimitive.contentOrNullSafe: String?
    get() = content

/** The unary request envelope: `{ type, rpcId, method, payload: { args } }`. */
data class LinkRequestEnvelope(val rpcId: String, val method: String, val args: Map<String, WireValue>) {
    fun toJsonElement(): JsonElement = buildJsonObject {
        put("type", "client-request")
        put("rpcId", rpcId)
        put("method", method)
        put("payload", buildJsonObject { args.forEach { (key, value) -> put(key, value.toJsonElement()) } })
    }
}

/** `{ ok: true, value }` or `{ ok: false, error }` — one unary result. */
data class LinkResult(
    val ok: Boolean,
    val value: WireValue?,
    val errorCode: String?,
    val errorMessage: String?,
) {
    companion object {
        fun fromJsonElement(element: JsonElement): LinkResult {
            val obj = element.jsonObject
            val ok = obj["ok"]?.jsonPrimitive?.content == "true"
            return LinkResult(
                ok = ok,
                value = obj["value"]?.let { WireValue.fromJsonElement(it) },
                errorCode = (obj["error"] as? JsonObject)?.get("code")?.jsonPrimitive?.takeIf { it.isString }?.content,
                errorMessage = (obj["error"] as? JsonObject)?.get("message")?.jsonPrimitive?.takeIf { it.isString }?.content,
            )
        }
    }
}

/** One whole server response: `{ type, result }`. */
data class LinkResponseEnvelope(val type: String, val result: LinkResult) {
    companion object {
        fun fromJsonElement(element: JsonElement): LinkResponseEnvelope {
            val obj = element.jsonObject
            return LinkResponseEnvelope(
                type = obj["type"]?.jsonPrimitive?.takeIf { it.isString }?.content ?: "",
                result = LinkResult.fromJsonElement(obj["result"] ?: JsonObject(emptyMap())),
            )
        }
    }
}

/** One NDJSON Remote-stream frame: `{"k":"v","v":…}` or `{"k":"e",…}`. */
data class LinkStreamFrame(val kind: String, val value: WireValue?, val code: String?, val message: String?) {
    val isFailure: Boolean get() = kind == "e"

    companion object {
        fun fromJsonElement(element: JsonElement): LinkStreamFrame {
            val obj = element.jsonObject
            return LinkStreamFrame(
                kind = obj["k"]?.jsonPrimitive?.takeIf { it.isString }?.content ?: "",
                value = obj["v"]?.let { WireValue.fromJsonElement(it) },
                code = obj["c"]?.jsonPrimitive?.takeIf { it.isString }?.content,
                message = obj["m"]?.jsonPrimitive?.takeIf { it.isString }?.content,
            )
        }
    }
}
