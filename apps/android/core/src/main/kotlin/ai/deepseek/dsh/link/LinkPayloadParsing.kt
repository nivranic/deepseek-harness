package ai.deepseek.dsh.link

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Hand parsers for the generated models the app shell consumes directly —
 * the generated data classes carry no serialization annotations, so the
 * JsonElement tree maps field by field. */
object LinkPayloadParsing {
    /** Parse one pairing QR payload; null when the text is not the payload
     * JSON or a field carries the wrong type. */
    fun pairingPayload(text: String): LinkPairingPayload? {
        val obj = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        fun string(field: String): String? = obj[field]?.jsonPrimitive?.takeIf { it.isString }?.content
        fun number(field: String): Double? = obj[field]?.jsonPrimitive?.doubleOrNull
        return LinkPairingPayload(
            v = number("v") ?: return null,
            kind = string("kind") ?: return null,
            hostId = string("hostId") ?: return null,
            hostName = string("hostName") ?: return null,
            endpoint = string("endpoint") ?: return null,
            spkiFingerprint = string("spkiFingerprint") ?: return null,
            code = string("code") ?: return null,
            expiresAt = number("expiresAt") ?: return null,
        )
    }
}
