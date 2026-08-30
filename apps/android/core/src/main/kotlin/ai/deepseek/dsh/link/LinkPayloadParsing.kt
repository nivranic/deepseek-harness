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
    fun pairingPayload(text: String): LinkPairingPayload? = runCatching {
        val obj = Json.parseToJsonElement(text).jsonObject
        fun string(field: String) = obj[field]?.jsonPrimitive?.takeIf { it.isString }?.content ?: return null
        fun number(field: String) = obj[field]?.jsonPrimitive?.doubleOrNull ?: return null
        LinkPairingPayload(
            v = number("v"),
            kind = string("kind"),
            hostId = string("hostId"),
            hostName = string("hostName"),
            endpoint = string("endpoint"),
            spkiFingerprint = string("spkiFingerprint"),
            code = string("code"),
            expiresAt = number("expiresAt"),
        )
    }.getOrNull()
}
