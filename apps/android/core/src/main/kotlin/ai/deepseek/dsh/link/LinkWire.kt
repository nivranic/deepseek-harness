package ai.deepseek.dsh.link

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
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
                else -> {
                    val number = element.content.toDoubleOrNull() ?: invalidResponse()
                    if (!number.isFinite() || number == 0.0 && number.toRawBits() < 0) invalidResponse()
                    NumberValue(number)
                }
            }
            is JsonArray -> ArrayValue(element.map { fromJsonElement(it) })
            is JsonObject -> ObjectValue(element.entries.associate { (key, inner) -> key to fromJsonElement(inner) })
            JsonNull -> NullValue
        }
    }
}

private val JsonPrimitive.contentOrNullSafe: String?
    get() = content

/** The unary request envelope: `{ type, rpcId, method, payload: { args, device? } }`.
 * The optional `device` admission rides beside `args`, mirroring the gateway's
 * versioned request envelope; a paired client sends it on every business call. */
data class LinkRequestEnvelope(
    val rpcId: String,
    val method: String,
    val args: Map<String, WireValue>,
    val device: Map<String, WireValue>? = null,
) {
    fun toJsonElement(): JsonElement = buildJsonObject {
        put("type", "client-request")
        put("rpcId", rpcId)
        put("method", method)
        put("payload", buildJsonObject {
            put("args", buildJsonObject { args.forEach { (key, value) -> put(key, value.toJsonElement()) } })
            device?.let { admission ->
                put("device", buildJsonObject { admission.forEach { (key, value) -> put(key, value.toJsonElement()) } })
            }
        })
    }
}

/** `{ ok: true, value }` or `{ ok: false, error }` — one unary result. */
data class LinkResult(
    val ok: Boolean,
    val value: WireValue?,
    val errorCode: String?,
    val errorMessage: String?,
    val errorDetails: WireValue?,
) {
    companion object {
        fun fromJsonElement(element: JsonElement): LinkResult {
            val obj = element.responseObject()
            val ok = (obj["ok"] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull ?: invalidResponse()
            if (ok) {
                obj.requireAbsent("error")
                return LinkResult(true, obj["value"]?.let { WireValue.fromJsonElement(it) }, null, null, null)
            }
            obj.requireAbsent("value")
            val error = obj["error"].responseObject()
            return LinkResult(
                false,
                null,
                error.responseString("code"),
                error.responseString("message"),
                WireValue.fromJsonElement(error["details"].responseObject()),
            )
        }
    }
}

/** One whole server response: `{ type, rpcId, result }`. */
data class LinkResponseEnvelope(val type: String, val rpcId: String, val result: LinkResult) {
    companion object {
        fun fromJsonElement(element: JsonElement): LinkResponseEnvelope {
            val obj = element.responseObject()
            val type = obj.responseString("type")
            val rpcId = obj.responseString("rpcId")
            if (type != "server-response" || rpcId.isEmpty()) invalidResponse()
            return LinkResponseEnvelope(
                type = type,
                rpcId = rpcId,
                result = LinkResult.fromJsonElement(obj["result"].responseObject()),
            )
        }
    }
}

/** One NDJSON Remote-stream frame: `{"k":"v","v":…}` or `{"k":"e",…}`. */
data class DecodedLinkStreamFrame(
    val kind: String,
    val value: WireValue?,
    val code: String?,
    val message: String?,
    val details: WireValue?,
) {
    val isFailure: Boolean get() = kind == "e"

    companion object {
        fun fromJsonElement(element: JsonElement): DecodedLinkStreamFrame {
            val obj = element.responseObject()
            return when (obj.responseString("k")) {
                "v" -> {
                    obj.requireAbsent("c", "m", "d")
                    DecodedLinkStreamFrame("v", obj["v"]?.let { WireValue.fromJsonElement(it) }, null, null, null)
                }
                "e" -> {
                    obj.requireAbsent("v")
                    DecodedLinkStreamFrame(
                        "e",
                        null,
                        obj.responseString("c"),
                        obj.responseString("m"),
                        WireValue.fromJsonElement(obj["d"].responseObject()),
                    )
                }
                else -> invalidResponse()
            }
        }
    }
}

/** Decode response bytes without exposing a JSON parser exception as a transport failure. */
internal fun responseJson(text: String): JsonElement = try {
    kotlinx.serialization.json.Json.parseToJsonElement(text)
} catch (_: IllegalArgumentException) {
    invalidResponse()
}

private fun JsonElement?.responseObject(): JsonObject = this as? JsonObject ?: invalidResponse()

private fun JsonObject.responseString(field: String): String =
    (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: invalidResponse()

private fun JsonObject.requireAbsent(vararg fields: String) {
    if (fields.any { containsKey(it) }) invalidResponse()
}

private fun invalidResponse(): Nothing = throw LinkClientException.BadWire("invalid response fields")
