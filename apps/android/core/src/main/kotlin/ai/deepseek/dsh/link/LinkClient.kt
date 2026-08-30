package ai.deepseek.dsh.link

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.KeyPairGenerator
import java.util.Base64

/** Every way a link call can fail, mirroring the Swift `LinkClientError`. */
sealed class LinkClientException(message: String) : RuntimeException(message) {
    class Carrier(val status: Int, message: String) : LinkClientException("carrier $status: $message")

    class Unpaired : LinkClientException("no paired identity")

    class Refused(val code: String, message: String) : LinkClientException("refused $code: $message")

    class BadWire(message: String) : LinkClientException("bad wire: $message")
}

/**
 * The link-client state machine over the JDK's HttpClient — the Kotlin
 * mirror of the Swift `LinkClient`: pair once, then describe, call unary
 * endpoints through the shared `/api` chain, and open NDJSON Remote
 * streams. Handshake-level SPKI pinning rides the app module's TLS stack;
 * [LinkPinning] holds the verification it applies.
 */
class LinkClient(
    baseUrl: String,
    pinnedFingerprint: String,
    private val store: LinkCredentialsStoring,
) {
    private val base: String = baseUrl.trimEnd('/')
    private val pinned: String = pinnedFingerprint
    private val http: HttpClient = HttpClient.newHttpClient()

    /** The persisted identity, or null before the first successful pairing. */
    val credentials: LinkCredentials? get() = store.load()

    /** The fingerprint this client was constructed to pin. */
    val pinnedFingerprint: String get() = pinned

    /**
     * Pair with a host by exchanging the one-time QR code for a durable
     * identity: a fresh Ed25519 key whose SPKI DER the host stores, the
     * returned identity persisted through the store.
     */
    fun pair(payload: LinkPairingPayload, deviceName: String): LinkCredentials {
        val key = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val publicRaw = key.public.encoded.copyOfRange(key.public.encoded.size - 32, key.public.encoded.size)
        val body = Json.encodeToString(
            JsonElement.serializer(),
            kotlinx.serialization.json.buildJsonObject {
                put("code", payload.code)
                put("deviceName", deviceName)
                put("devicePublicKey", Base64.getEncoder().encodeToString(LinkSigning.ed25519SpkiDer(publicRaw)))
            },
        )
        val data = post("/link/pair", body.toByteArray(Charsets.UTF_8), signed = false)
        val value = Json.parseToJsonElement(data.decodeToString()).jsonObject
        val credentials = LinkCredentials(
            deviceId = value.string("deviceId"),
            hostId = value.string("hostId"),
            hostName = value.string("hostName"),
            role = value.string("role"),
            endpoint = payload.endpoint,
            pinnedFingerprint = payload.spkiFingerprint,
            signingKeyBase64 = Base64.getEncoder().encodeToString(
                key.private.encoded.copyOfRange(key.private.encoded.size - 32, key.private.encoded.size),
            ),
        )
        store.save(credentials)
        return credentials
    }

    /** Ask the authenticated host for its description and capabilities. */
    fun describe(): LinkHostDescription {
        val data = post("/link/describe", ByteArray(0), signed = true)
        return mapHostDescription(Json.parseToJsonElement(data.decodeToString()).jsonObject)
    }

    /**
     * Call one unary Remote endpoint through the shared `/api` chain;
     * throws [LinkClientException.Refused] when the business call fails.
     */
    fun call(method: String, args: Map<String, WireValue> = emptyMap()): WireValue {
        val envelope = LinkRequestEnvelope(rpcId = "rpc-$method", method = method, args = args)
        val body = Json.encodeToString(envelope.toJsonElement())
            .toByteArray(Charsets.UTF_8)
        val data = post("/api/$method", body, signed = true)
        val response = LinkResponseEnvelope.fromJsonElement(Json.parseToJsonElement(data.decodeToString()))
        if (response.type != "server-response") {
            throw LinkClientException.BadWire("unexpected response type ${response.type}")
        }
        if (response.result.ok && response.result.value != null) return response.result.value!!
        if (response.result.errorCode != null) {
            throw LinkClientException.Refused(response.result.errorCode!!, response.result.errorMessage ?: "")
        }
        throw LinkClientException.BadWire("ok result without a value")
    }

    /**
     * Open one NDJSON Remote stream: value frames flow as they arrive; a
     * failure frame completes the flow with [LinkClientException.Refused].
     */
    fun stream(endpoint: String, payload: Map<String, WireValue> = emptyMap()): Flow<WireValue> = flow {
        val body = Json.encodeToString(
            JsonElement.serializer(),
            kotlinx.serialization.json.buildJsonObject { payload.forEach { (key, value) -> put(key, value.toJsonElement()) } },
        ).toByteArray(Charsets.UTF_8)
        val request = buildRequest("/link/stream/$endpoint", body)
        val response = http.send(request, HttpResponse.BodyHandlers.ofInputStream())
        // The stream body stays unread: the frames flow below consume it,
        // and an error status never carries a frame body worth decoding.
        checkStatus(response.statusCode(), null)
        response.body().bufferedReader(Charsets.UTF_8).useLines { lines ->
            for (line in lines) {
                if (line.isBlank()) continue
                val frame = LinkStreamFrame.fromJsonElement(Json.parseToJsonElement(line))
                if (frame.isFailure) {
                    throw LinkClientException.Refused(frame.code ?: "internal", frame.message ?: "stream failed")
                }
                frame.value?.let { emit(it) }
            }
        }
    }

    /** Forget the paired identity; the host refuses the next request. */
    fun unpair() = store.clear()

    companion object {
        /** Rebuild the paired client from persisted credentials — the
         * relaunch path that skips pairing and pins the stored fingerprint
         * again. Null before the first successful pairing. */
        fun restore(store: LinkCredentialsStoring): LinkClient? {
            val credentials = store.load() ?: return null
            return LinkClient(
                baseUrl = credentials.endpoint,
                pinnedFingerprint = credentials.pinnedFingerprint,
                store = store,
            )
        }
    }

    private fun post(path: String, body: ByteArray, signed: Boolean): ByteArray {
        val response = http.send(buildRequest(path, body, signed), HttpResponse.BodyHandlers.ofByteArray())
        checkStatus(response.statusCode(), response.body())
        return response.body()
    }

    private fun buildRequest(path: String, body: ByteArray, signed: Boolean = true): HttpRequest {
        val builder = HttpRequest.newBuilder(URI(base + path))
            .header("content-type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofByteArray(body))
        if (signed) applyCredentials(builder, path, body)
        return builder.build()
    }

    private fun applyCredentials(builder: HttpRequest.Builder, path: String, body: ByteArray) {
        val credentials = store.load() ?: throw LinkClientException.Unpaired()
        val privateKeyRaw = credentials.signingKeyRaw
            ?: throw LinkClientException.BadWire("stored signing key is not base64")
        val timestamp = System.currentTimeMillis().toString()
        val input = LinkSigning.signingInput(
            timestamp = timestamp,
            method = "POST",
            path = path,
            bodySha256Hex = LinkSigning.sha256Hex(body),
        )
        builder.header(LinkSigning.deviceIdHeader, credentials.deviceId)
        builder.header(LinkSigning.timestampHeader, timestamp)
        builder.header(LinkSigning.signatureHeader, LinkSigning.sign(input, privateKeyRaw))
    }

    private fun checkStatus(status: Int, body: ByteArray?) {
        if (status in 200..299) return
        val message = body?.let { bytes ->
            runCatching {
                (Json.parseToJsonElement(bytes.decodeToString()) as? JsonObject)?.get("message")?.jsonPrimitive?.content
            }.getOrNull()
        } ?: "HTTP $status"
        throw LinkClientException.Carrier(status, message)
    }
}

private fun JsonObject.string(field: String): String =
    this[field]?.jsonPrimitive?.takeIf { it.isString }?.content ?: ""

private fun JsonObject.boolean(field: String): Boolean =
    this[field]?.jsonPrimitive?.booleanOrNull ?: false

private fun JsonObject.number(field: String): Double =
    this[field]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0

/** Map the host-description JSON onto the generated contract model. */
internal fun mapHostDescription(obj: JsonObject): LinkHostDescription {
    val capabilities = obj["capabilities"]?.jsonObject ?: JsonObject(emptyMap())
    val session = capabilities["session"]?.jsonObject ?: JsonObject(emptyMap())
    val workspace = capabilities["workspace"]?.jsonObject ?: JsonObject(emptyMap())
    val interaction = capabilities["interaction"]?.jsonObject ?: JsonObject(emptyMap())
    return LinkHostDescription(
        linkProtocolVersion = obj.number("linkProtocolVersion"),
        hostVersion = obj.string("hostVersion"),
        hostId = obj.string("hostId"),
        hostName = obj.string("hostName"),
        runtimeClass = obj.string("runtimeClass"),
        sessionFormatVersion = obj.number("sessionFormatVersion"),
        allowRemoteApproval = obj.boolean("allowRemoteApproval"),
        capabilities = LinkCapabilities(
            session = LinkSessionCapabilities(
                list = session.boolean("list"),
                history = session.boolean("history"),
                follow = session.boolean("follow"),
                prompt = session.boolean("prompt"),
                cancel = session.boolean("cancel"),
            ),
            workspace = LinkWorkspaceCapabilities(follow = workspace.boolean("follow")),
            interaction = LinkInteractionCapabilities(
                approval = interaction.boolean("approval"),
                question = interaction.boolean("question"),
            ),
        ),
    )
}
