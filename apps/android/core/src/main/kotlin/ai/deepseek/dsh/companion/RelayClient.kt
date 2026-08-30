package ai.deepseek.dsh.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/**
 * The relay's HTTP consumer (chapters 68/69): registers a device, publishes
 * reference envelopes, and drains pending ones by poll — the client APNs/
 * FCM delivery will extend with a push-token step. The LAN-direct link
 * stays the primary transport; the relay is the rendezvous path.
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
        return array.map { element ->
            val obj = element.jsonObject
            RelayEnvelope(
                kind = obj.string("kind") ?: "",
                sessionId = obj.string("sessionId") ?: "",
                eventId = obj.string("eventId"),
                turn = (obj["turn"] as? JsonPrimitive)?.intOrNull,
            )
        }
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
