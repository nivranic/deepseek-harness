package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.NoiseCipherState
import ai.deepseek.dsh.link.NoiseHandshake
import ai.deepseek.dsh.link.decodeNoiseFrames
import ai.deepseek.dsh.link.encodeNoiseFrame
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.InputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.SecureRandom

/** One device's roster entry with its stream-derived online state. */
data class RelayPresence(val deviceId: String, val platform: String, val online: Boolean)

/** One push-stream frame: a reference envelope, or a same-account device's
 * presence change. */
sealed class RelayStreamEvent {
    data class Envelope(val envelope: RelayEnvelope) : RelayStreamEvent()
    data class Presence(val deviceId: String, val online: Boolean) : RelayStreamEvent()
}

/**
 * The relay's Noise-encrypted HTTP consumer (chapters 68/69): the client
 * completes one Noise_XX handshake lazily on the first call
 * (hello → verify the server-assigned session id equals our own transcript
 * hash → complete → consume the encrypted ack), then registers a device,
 * publishes reference envelopes, drains pending ones by poll, holds the
 * push stream open, and answers the account roster's online state — every
 * body a framed AEAD message under the split session keys. The stream
 * rides a one-time key the encrypted request carries, so live pushes never
 * share a counter with HTTP responses. The LAN-direct link stays the
 * primary transport; the relay is the rendezvous path, and APNs/FCM
 * delivery will extend it with a push-token step.
 */
class RelayClient(private val baseUrl: String) {
    private val http: HttpClient = HttpClient.newHttpClient()

    /** One established transport: the session id and the split cipher states. */
    private class Session(val id: String, val send: NoiseCipherState, val recv: NoiseCipherState)

    private var session: Session? = null

    /**
     * Register one device at the rendezvous service.
     * @param device the device identity and its push-token slot.
     * @return the rendezvous token polling requires.
     */
    fun register(device: RelayDevice): String {
        val body = buildJsonObject {
            put("accountId", device.accountId)
            put("deviceId", device.deviceId)
            put("platform", device.platform)
            if (device.pushToken != null) put("pushToken", device.pushToken)
        }
        return (call("/relay/register", body)["token"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: error("relay register returned no token")
    }

    /**
     * Publish one reference envelope to an account's devices.
     * @param accountId the account whose devices receive the envelope.
     * @param envelope the minimized, reference-only payload.
     */
    fun publish(accountId: String, envelope: RelayEnvelope) {
        val body = buildJsonObject {
            put("accountId", accountId)
            put("kind", envelope.kind)
            put("sessionId", envelope.sessionId)
            if (envelope.eventId != null) put("eventId", envelope.eventId)
            if (envelope.turn != null) put("turn", envelope.turn)
        }
        call("/relay/publish", body)
    }

    /**
     * Drain the device's pending envelopes in arrival order.
     * @param token the rendezvous token from registration.
     * @return the forwarded envelopes, oldest first.
     */
    fun poll(token: String): List<RelayEnvelope> {
        val response = exchange("/relay/poll", buildJsonObject { put("token", token) })
        return response.map { parseEnvelope(Json.parseToJsonElement(String(current.recv.decryptWithAd(EMPTY, it))).jsonObject) }
    }

    /**
     * Hold the push stream open: connect flushes the pending queue as its
     * first frames, then every live publish to this device and every
     * same-account device's presence change arrives as one encrypted frame;
     * the flow completes when the service closes the stream.
     * @param token the rendezvous token from registration.
     * @return the stream events, oldest first, unbounded in time.
     */
    fun stream(token: String): Flow<RelayStreamEvent> = flow {
        val streamKey = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val decrypt = NoiseCipherState(streamKey)
        val request = buildJsonObject {
            put("token", token)
            put("streamKey", hex(streamKey))
        }
        val sealed = encodeNoiseFrame(current.send.encryptWithAd(EMPTY, jsonBytes(request)))
        val httpRequest = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/relay/stream"))
            // The timeout bounds waiting for the response head only; the
            // body is a long-lived stream and stays unbounded.
            .timeout(java.time.Duration.ofSeconds(60))
            .header("x-relay-session", current.id)
            .POST(HttpRequest.BodyPublishers.ofByteArray(sealed))
            .build()
        val response = http.send(httpRequest, HttpResponse.BodyHandlers.ofInputStream())
        if (response.statusCode() !in 200..299) error("relay stream failed: HTTP ${response.statusCode()}")
        response.body().use { body ->
            while (true) {
                val frame = readFrame(body) ?: break
                val event = Json.parseToJsonElement(String(decrypt.decryptWithAd(EMPTY, frame))).jsonObject
                emit(parseStreamEvent(event))
            }
        }
    }

    /**
     * The account roster with each stream-derived online state.
     * @param accountId the account whose devices are listed.
     * @return the registered devices, in registration order; an unknown
     * account lists nothing.
     */
    fun presence(accountId: String): List<RelayPresence> {
        val response = exchange("/relay/presence", buildJsonObject { put("accountId", accountId) })
        val roster = Json.parseToJsonElement(String(current.recv.decryptWithAd(EMPTY, response.single())))
        return roster.jsonArray.map { element ->
            val obj = element.jsonObject
            RelayPresence(
                deviceId = obj.string("deviceId") ?: error("presence entry missing deviceId"),
                platform = obj.string("platform") ?: "",
                online = (obj["online"] as? JsonPrimitive)?.booleanOrNull ?: false,
            )
        }
    }

    /** Complete the XX handshake and consume the encrypted ack, once. */
    @Synchronized
    private fun ensureSession() {
        if (session != null) return
        val handshake = NoiseHandshake(NoiseHandshake.Role.INITIATOR)
        val hello = post("/relay/noise/hello", handshake.writeMessage1(), sessionHeader = null)
        val id = hello.headers().firstValue("x-relay-session").orElse("")
        handshake.readMessage2(hello.body())
        if (id != hex(handshake.transcriptHash)) {
            error("relay session id does not match the handshake transcript")
        }
        val complete = post("/relay/noise/complete", handshake.writeMessage3(), sessionHeader = id)
        val (send, recv) = handshake.split()
        val ack = decodeNoiseFrames(complete.body())
        if (ack.size != 1) error("relay key confirmation failed")
        val confirmed = Json.parseToJsonElement(String(recv.decryptWithAd(EMPTY, ack.single()))).jsonObject
        if ((confirmed["ok"] as? JsonPrimitive)?.booleanOrNull != true) error("relay key confirmation failed")
        session = Session(id, send, recv)
    }

    /** The established session every protected call requires. */
    private val current: Session
        get() {
            ensureSession()
            return session ?: error("relay session unavailable")
        }

    /** One framed encrypted POST; the response body is the raw frames. */
    private fun exchange(path: String, request: JsonObject): List<ByteArray> {
        val sealed = encodeNoiseFrame(current.send.encryptWithAd(EMPTY, jsonBytes(request)))
        val response = post(path, sealed, current.id)
        return decodeNoiseFrames(response.body())
    }

    /** One framed encrypted POST answered by exactly one JSON object. */
    private fun call(path: String, request: JsonObject): JsonObject {
        val frames = exchange(path, request)
        if (frames.size != 1) error("relay $path answered ${frames.size} frames")
        return Json.parseToJsonElement(String(current.recv.decryptWithAd(EMPTY, frames.single()))).jsonObject
    }

    private fun post(path: String, body: ByteArray, sessionHeader: String?): HttpResponse<ByteArray> {
        val builder = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl$path"))
            .timeout(java.time.Duration.ofSeconds(30))
            .header("content-type", "application/octet-stream")
            .POST(HttpRequest.BodyPublishers.ofByteArray(body))
        if (sessionHeader != null) builder.header("x-relay-session", sessionHeader)
        val response = http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray())
        if (response.statusCode() !in 200..299) error("relay $path failed: HTTP ${response.statusCode()}")
        return response
    }

    /** Read one u16-framed ciphertext, or null at a clean end of stream. */
    private fun readFrame(body: InputStream): ByteArray? {
        val high = body.read()
        if (high < 0) return null
        val low = body.read()
        if (low < 0) error("relay noise frame header truncated")
        val length = (high shl 8) or low
        val frame = ByteArray(length)
        var filled = 0
        while (filled < length) {
            val read = body.read(frame, filled, length - filled)
            if (read < 0) error("relay noise frame truncated")
            filled += read
        }
        return frame
    }

    private fun parseStreamEvent(element: kotlinx.serialization.json.JsonElement): RelayStreamEvent {
        val obj = element.jsonObject
        if (obj.string("type") == "presence") {
            return RelayStreamEvent.Presence(
                deviceId = obj.string("deviceId") ?: error("presence event missing deviceId"),
                online = (obj["online"] as? JsonPrimitive)?.booleanOrNull ?: false,
            )
        }
        return RelayStreamEvent.Envelope(parseEnvelope(obj))
    }

    private fun parseEnvelope(element: kotlinx.serialization.json.JsonElement): RelayEnvelope {
        val obj = element.jsonObject
        return RelayEnvelope(
            kind = obj.string("kind") ?: "",
            sessionId = obj.string("sessionId") ?: "",
            eventId = obj.string("eventId"),
            turn = (obj["turn"] as? JsonPrimitive)?.intOrNull,
        )
    }

    private fun JsonObject.string(name: String): String? =
        (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun jsonBytes(value: JsonObject): ByteArray = value.toString().toByteArray(Charsets.UTF_8)

    private fun hex(bytes: ByteArray): String {
        val digits = "0123456789abcdef"
        val out = StringBuilder(bytes.size * 2)
        for (byte in bytes) {
            out.append(digits[(byte.toInt() shr 4) and 0xf]).append(digits[byte.toInt() and 0xf])
        }
        return out.toString()
    }

    private companion object {
        val EMPTY = ByteArray(0)
    }
}
