package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.link.LinkClientException
import kotlinx.serialization.json.*
import java.net.URI

/** Operator-issued, short-lived pairing data. It is never a persisted credential. */
class NativePairing private constructor(
    val endpoint: String,
    val hostId: String,
    val displayName: String,
    val spkiFingerprint: String,
    val code: String,
    val expiresAt: Long,
    val role: String,
) {
    companion object {
        internal val roles = setOf("viewer", "collaborator", "controller", "owner")

        /** Parse the current QR/JSON format; legacy Link payloads require a new pairing. */
        fun parse(text: String, now: Long = System.currentTimeMillis()): NativePairing {
            val obj = try { Json.parseToJsonElement(text) as? JsonObject }
            catch (_: IllegalArgumentException) { null }
                ?: badNativeWire("invalid native pairing JSON")
            if (obj.text("kind") != "dsh-native-pairing" || obj.integer("version") != 1L) {
                badNativeWire("unsupported pairing format; issue a new native pairing")
            }
            val expiry = obj.integer("expiresAt")
            if (expiry <= now) badNativeWire("pairing has expired")
            val role = obj.text("role")
            if (role !in roles) badNativeWire("unsupported device role")
            val pin = obj.text("spkiFingerprint")
            if (!Regex("[a-f0-9]{64}").matches(pin)) badNativeWire("invalid Host SPKI fingerprint")
            return NativePairing(nativeOrigin(obj.text("endpoint")), obj.text("hostId"),
                obj.text("displayName"), pin, obj.text("code"), expiry, role)
        }
    }
}

/** Only a pinned HTTPS origin can receive a pairing secret or signed request. */
internal fun nativeOrigin(value: String): String {
    val uri = try { URI(value) } catch (_: IllegalArgumentException) { null }
        catch (_: java.net.URISyntaxException) { null }
    if (uri == null || uri.scheme != "https" || uri.host.isNullOrEmpty() || uri.rawUserInfo != null ||
        uri.rawQuery != null || uri.rawFragment != null || uri.rawPath !in listOf("", "/") ||
        uri.port != -1 && uri.port !in 1..65535 || uri.host in setOf("0.0.0.0", "[::]")) {
        badNativeWire("native endpoint must be a reachable HTTPS origin")
    }
    return value.removeSuffix("/")
}

internal fun JsonObject.text(field: String): String =
    (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
        ?: badNativeWire("missing or invalid $field")

internal fun JsonObject.integer(field: String): Long =
    (this[field] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull
        ?.takeIf { it in 0..9_007_199_254_740_991L } ?: badNativeWire("missing or invalid $field")

internal fun badNativeWire(message: String): Nothing = throw LinkClientException.BadWire(message)
