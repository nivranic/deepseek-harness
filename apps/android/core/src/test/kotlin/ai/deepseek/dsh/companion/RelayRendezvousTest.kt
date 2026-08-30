package ai.deepseek.dsh.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The rendezvous skeleton's forwarding semantics (chapters 68/69). */
class RelayRendezvousTest {
    @Test
    fun registersDevicesAndForwardsReferencesToEveryDevice() {
        val relay = RelayRendezvous()
        val phone = relay.register(RelayDevice("acct", "phone", "android"))
        val pad = relay.register(RelayDevice("acct", "pad", "ios", pushToken = "apns-token"))
        assertEquals(2, relay.devices("acct").size)

        val delivered = relay.publish("acct", RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1"))
        assertEquals(2, delivered)

        assertEquals(
            listOf(RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1")),
            relay.poll(phone),
        )
        // Draining retires the queue.
        assertTrue(relay.poll(phone).isEmpty())
        assertEquals(listOf(RelayEnvelope("approval-waiting", "s1", "e1")), relay.poll(pad))
    }

    @Test
    fun accountsAreIsolatedAndUnknownTokensDrainNothing() {
        val relay = RelayRendezvous()
        val mine = relay.register(RelayDevice("mine", "phone", "android"))
        relay.register(RelayDevice("other", "phone", "android"))
        // The envelope reaches only the other account's device.
        assertEquals(1, relay.publish("other", RelayEnvelope(kind = "task-completed", sessionId = "s9", turn = 1)))
        assertTrue(relay.poll(mine).isEmpty())
        assertTrue(relay.poll("rt-unknown").isEmpty())
    }

    @Test
    fun forwardedEnvelopesBridgeOntoThePushVocabulary() {
        val relay = RelayRendezvous()
        val token = relay.register(RelayDevice("acct", "phone", "android"))
        relay.publish("acct", RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1"))
        relay.publish("acct", RelayEnvelope(kind = "question-waiting", sessionId = "s1", eventId = "e2"))
        relay.publish("acct", RelayEnvelope(kind = "task-completed", sessionId = "s1", turn = 3))
        relay.publish("acct", RelayEnvelope(kind = "unknown", sessionId = "s1"))

        assertEquals(
            listOf(
                CompanionPush.ApprovalWaiting(sessionId = "s1", eventId = "e1"),
                CompanionPush.QuestionWaiting(sessionId = "s1", eventId = "e2"),
                CompanionPush.TaskCompleted(sessionId = "s1", turn = 3),
                null,
            ),
            relay.poll(token).map { it.asPush() },
        )
    }
}

/** The HTTP consumer against a real local server backed by the rendezvous. */
class RelayClientTest {
    @Test
    fun registersPublishesAndDrainsOverHttp() {
        val relay = RelayRendezvous()
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/register") { exchange ->
            val request = Json.parseToJsonElement(exchange.requestBody.readBytes().decodeToString()).jsonObjectSafe()
            val token = relay.register(
                RelayDevice(
                    accountId = (request["accountId"] as kotlinx.serialization.json.JsonPrimitive).content,
                    deviceId = (request["deviceId"] as kotlinx.serialization.json.JsonPrimitive).content,
                    platform = (request["platform"] as kotlinx.serialization.json.JsonPrimitive).content,
                ),
            )
            respond(exchange, """{"token":"$token"}""")
        }
        server.createContext("/relay/publish") { exchange ->
            val request = Json.parseToJsonElement(exchange.requestBody.readBytes().decodeToString()).jsonObjectSafe()
            val accountId = (request["accountId"] as kotlinx.serialization.json.JsonPrimitive).content
            val kind = (request["kind"] as kotlinx.serialization.json.JsonPrimitive).content
            val sessionId = (request["sessionId"] as kotlinx.serialization.json.JsonPrimitive).content
            val eventId = (request["eventId"] as? kotlinx.serialization.json.JsonPrimitive)?.content
            val turn = (request["turn"] as? kotlinx.serialization.json.JsonPrimitive)?.let { it.content.toInt() }
            relay.publish(accountId, RelayEnvelope(kind = kind, sessionId = sessionId, eventId = eventId, turn = turn))
            respond(exchange, """{"delivered":1}""")
        }
        server.createContext("/relay/poll") { exchange ->
            val token = exchange.requestURI.query?.removePrefix("token=") ?: ""
            val array = kotlinx.serialization.json.buildJsonArray {
                for (envelope in relay.poll(token)) {
                    add(kotlinx.serialization.json.buildJsonObject {
                        put("kind", envelope.kind)
                        put("sessionId", envelope.sessionId)
                        envelope.eventId?.let { eventId -> put("eventId", eventId) }
                        envelope.turn?.let { turn -> put("turn", turn) }
                    })
                }
            }.toString()
            respond(exchange, array)
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            val token = client.register(RelayDevice("acct", "phone", "android"))
            client.publish("acct", RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1"))
            assertEquals(
                listOf(CompanionPush.ApprovalWaiting(sessionId = "s1", eventId = "e1")),
                client.poll(token).map { it.asPush() },
            )
            assertTrue(client.poll(token).isEmpty(), "polling drains")
        } finally {
            server.stop(0)
        }
    }

    private fun respond(exchange: com.sun.net.httpserver.HttpExchange, body: String) {
        val bytes = body.encodeToByteArray()
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.write(bytes)
        exchange.close()
    }

    private fun String.jsonObjectSafe() = Json.parseToJsonElement(this) as kotlinx.serialization.json.JsonObject
}
