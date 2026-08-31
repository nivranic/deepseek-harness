package ai.deepseek.dsh.companion

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
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/** One device's roster entry with its stream-derived online state. */
data class RelayPresence(val deviceId: String, val platform: String, val online: Boolean)

/** One push-stream line: a reference envelope, or a same-account device's
 * presence change. */
sealed class RelayStreamEvent {
    data class Envelope(val envelope: RelayEnvelope) : RelayStreamEvent()
    data class Presence(val deviceId: String, val online: Boolean) : RelayStreamEvent()
}

/**
 * The relay's HTTP consumer (chapters 68/69): registers a device, publishes
 * reference envelopes, drains pending ones by poll, holds the push stream
 * open (connect flushes the pending queue, then reference envelopes and
 * same-account presence changes arrive as NDJSON lines, replacing poll for
 * a connected device), and answers the account roster's online state. The
 * LAN-direct link stays the primary transport; the relay is the rendezvous
 * path, and APNs/FCM delivery will extend it with a push-token step.
 */
class RelayClient(private val baseUrl: String) {
    private val client: HttpClient = HttpClient.newHttpClient()

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
        }.toString()
        val value = call("/relay/register", body)
        return (value["token"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: error("relay register returned no token")
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
        }.toString()
        call("/relay/publish", body)
    }

    /**
     * Drain the device's pending envelopes in arrival order.
     * @param token the rendezvous token from registration.
     * @return the forwarded envelopes, oldest first.
     */
    fun poll(token: String): List<RelayEnvelope> {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/relay/poll?token=$token"))
            .GET()
            .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) error("relay poll failed: HTTP ${response.statusCode()}")
        val array = Json.parseToJsonElement(response.body()).jsonArray
        return array.map { parseEnvelope(it) }
    }

    /**
     * Hold the push stream open: connect flushes the pending queue as its
     * first lines, then every live publish to this device and every
     * same-account device's presence change arrives as one NDJSON line;
     * the flow completes when the service closes the stream.
     * @param token the rendezvous token from registration.
     * @return the stream events, oldest first, unbounded in time.
     */
    fun stream(token: String): Flow<RelayStreamEvent> = flow {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/relay/stream?token=$token"))
            // The timeout bounds waiting for the response head only; the
            // body is a long-lived stream and stays unbounded.
            .timeout(java.time.Duration.ofSeconds(60))
            .GET()
            .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofInputStream())
        if (response.statusCode() !in 200..299) error("relay stream failed: HTTP ${response.statusCode()}")
        response.body().bufferedReader(Charsets.UTF_8).useLines { lines ->
            for (line in lines) {
                if (line.isBlank()) continue
                emit(parseStreamEvent(Json.parseToJsonElement(line)))
            }
        }
    }

    /**
     * The account roster with each device's stream-derived online state.
     * @param accountId the account whose devices are listed.
     * @return the registered devices, in registration order; an unknown
     * account lists nothing.
     */
    fun presence(accountId: String): List<RelayPresence> {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/relay/presence?accountId=$accountId"))
            .GET()
            .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) error("relay presence failed: HTTP ${response.statusCode()}")
        return Json.parseToJsonElement(response.body()).jsonArray.map { element ->
            val obj = element.jsonObject
            RelayPresence(
                deviceId = obj.string("deviceId") ?: error("presence entry missing deviceId"),
                platform = obj.string("platform") ?: "",
                online = (obj["online"] as? JsonPrimitive)?.booleanOrNull ?: false,
            )
        }
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

    private fun call(path: String, body: String): JsonObject {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl$path"))
            .timeout(java.time.Duration.ofSeconds(30))
            .header("content-type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) error("relay $path failed: HTTP ${response.statusCode()}")
        return Json.parseToJsonElement(response.body()).let { it as? JsonObject ?: JsonObject(emptyMap()) }
    }

    private fun JsonObject.string(name: String): String? =
        (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
