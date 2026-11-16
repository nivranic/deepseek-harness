package ai.deepseek.dsh.companion

import java.util.Base64
import kotlinx.serialization.json.*

/** A durable viewing position on one trusted Host; it carries neither authorization nor runtime state. */
data class NativeViewLocation(val hostId: String, val sessionId: String, val anchorSeq: Long)

/** Each completed navigation has its own generation, including repeated jumps to the same sequence. */
data class NativeViewAnchor(val generation: Long, val seq: Long)

/** The Web v1 viewing-position payload and its bounded Companion deep-link wrapper. */
object NativeViewLocations {
    private const val prefix = "dsh-session-view.v1."
    private const val deepLinkPrefix = "dsh-companion://session-view/"
    private const val maxDeepLinkPayloadCharacters = 4096
    private const val maxSafeInteger = 9_007_199_254_740_991L

    /** Encode the same ordered ASCII JSON fields as the Web Client. */
    fun encode(location: NativeViewLocation): String {
        require(location.hostId.isNotEmpty() && location.sessionId.isNotEmpty() && location.anchorSeq in 0..maxSafeInteger)
        val json = buildJsonObject {
            put("hostId", location.hostId)
            put("sessionId", location.sessionId)
            put("anchorSeq", location.anchorSeq)
        }.toString()
        require(json.all { it.code in 0x20..0x7e }) { "session view location must be ASCII-encoded" }
        return prefix + Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.US_ASCII))
    }

    /** Decode a v1 location; caller-supplied size limits bound untrusted clipboard data. */
    fun decode(encoded: String, maxCharacters: Int): NativeViewLocation {
        require(maxCharacters > 0 && encoded.length <= maxCharacters) { "session view location exceeds its limit" }
        require(encoded.startsWith(prefix)) { "session view location has an unknown grammar" }
        val body = encoded.removePrefix(prefix)
        require(body.matches(Regex("[A-Za-z0-9_-]*"))) { "session view location is not base64url" }
        // Browser atob exposes bytes as Latin-1 code points before JSON.parse.
        val json = Base64.getUrlDecoder().decode(body).toString(Charsets.ISO_8859_1)
        val value = Json.parseToJsonElement(json) as? JsonObject ?: error("session view location object required")
        require(value.keys == setOf("hostId", "sessionId", "anchorSeq")) { "session view location fields differ" }
        fun id(field: String): String {
            val part = value.getValue(field) as? JsonPrimitive ?: error("session view identity required")
            require(part.isString && part.content.isNotEmpty()) { "session view identity must be nonempty" }
            return part.content
        }
        val anchor = value.getValue("anchorSeq") as? JsonPrimitive ?: error("session view anchor required")
        val number = anchor.doubleOrNull
        require(!anchor.isString && number != null && number.isFinite() && number >= 0 && number <= maxSafeInteger.toDouble() &&
            number == kotlin.math.floor(number) && number.toRawBits() != (-0.0).toRawBits()) { "invalid session view anchor" }
        return NativeViewLocation(id("hostId"), id("sessionId"), number.toLong())
    }

    /**
     * Wrap the Web v1 payload in the exact Companion URI without percent encoding.
     * @param location Durable position to encode; its complete payload must fit 4096 characters.
     * @return A deep link of at most 4125 characters, carrying no Host authorization.
     */
    fun encodeDeepLink(location: NativeViewLocation): String {
        val encoded = encode(location)
        require(encoded.length <= maxDeepLinkPayloadCharacters) { "session view location exceeds its limit" }
        return deepLinkPrefix + encoded
    }

    /**
     * Parse an exact Companion URI without trimming, URL decoding or navigation.
     * @param raw Untrusted URI text, limited to 4125 characters including its 4096-character payload.
     * @return Validated position; callers must still match the current trusted Host before opening it.
     */
    fun decodeDeepLink(raw: String): NativeViewLocation {
        require(raw.length <= deepLinkPrefix.length + maxDeepLinkPayloadCharacters) { "session view deep link exceeds its limit" }
        require(raw.startsWith(deepLinkPrefix)) { "session view deep link has an unknown grammar" }
        return decode(raw.substring(deepLinkPrefix.length), maxDeepLinkPayloadCharacters)
    }

    /** Check the currently selected trusted Host before any Session request is made. */
    fun requireHost(location: NativeViewLocation, selectedHostId: String?) {
        require(selectedHostId != null && selectedHostId == location.hostId) { "session view location targets another Host" }
    }
}
