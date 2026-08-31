package ai.deepseek.dsh.companion

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.put
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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
            val request = exchange.requestBody.readBytes().decodeToString().jsonObjectSafe()
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
            val request = exchange.requestBody.readBytes().decodeToString().jsonObjectSafe()
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

/** The push-stream consumer against a real local server: connect flushes,
 * then live lines arrive; a clean close completes the flow. */
class RelayStreamTest {
    @Test
    fun streamFlushesThenPushesLiveLinesUntilTheClose() = runBlocking {
        val releaseSecondLine = CountDownLatch(1)
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/stream") { exchange ->
            // Response length 0 = chunked; lines flush as written.
            exchange.sendResponseHeaders(200, 0)
            val out = exchange.responseBody
            out.write("{\"kind\":\"approval-waiting\",\"sessionId\":\"s1\",\"eventId\":\"e1\"}\n\n".toByteArray())
            out.flush()
            releaseSecondLine.await(5, TimeUnit.SECONDS)
            out.write("  {\"kind\":\"task-completed\",\"sessionId\":\"s1\",\"turn\":3}\n".toByteArray())
            out.flush()
            // The terminating chunk rides close(); returning without it
            // leaves the client at EOF mid-chunk-header.
            exchange.close()
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            // The collector blocks in a socket read between the scripted
            // lines, so it must not own runBlocking's single thread: the
            // latch release that frees the read can only fire from here.
            val collected = java.util.concurrent.CopyOnWriteArrayList<RelayStreamEvent>()
            val job = launch(kotlinx.coroutines.Dispatchers.IO) { client.stream("rt-acct-phone").toList(collected) }
            withTimeout(5_000) { while (collected.isEmpty()) delay(20) }
            assertEquals(RelayStreamEvent.Envelope(RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1")), collected.single())
            releaseSecondLine.countDown()
            withTimeout(5_000) { job.join() }
            assertEquals(
                listOf(
                    RelayStreamEvent.Envelope(RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1")),
                    RelayStreamEvent.Envelope(RelayEnvelope(kind = "task-completed", sessionId = "s1", turn = 3)),
                ),
                collected,
            )
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun presenceLinesDecodeAsSameAccountPresenceEvents() = runBlocking {
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/stream") { exchange ->
            exchange.sendResponseHeaders(200, 0)
            val out = exchange.responseBody
            out.write("{\"kind\":\"approval-waiting\",\"sessionId\":\"s1\",\"eventId\":\"e1\"}\n".toByteArray())
            out.write("{\"type\":\"presence\",\"deviceId\":\"pad\",\"online\":true}\n".toByteArray())
            out.write("{\"type\":\"presence\",\"deviceId\":\"pad\",\"online\":false}\n".toByteArray())
            out.flush()
            exchange.close()
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            val collected = withTimeoutOrNull(5_000) { client.stream("rt-acct-phone").toList() }
            assertEquals(
                listOf(
                    RelayStreamEvent.Envelope(RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1")),
                    RelayStreamEvent.Presence(deviceId = "pad", online = true),
                    RelayStreamEvent.Presence(deviceId = "pad", online = false),
                ),
                collected,
            )
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun malformedPresenceLinesFailLoud() = runBlocking {
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/stream") { exchange ->
            exchange.sendResponseHeaders(200, 0)
            val out = exchange.responseBody
            out.write("{\"type\":\"presence\",\"online\":true}\n".toByteArray())
            out.flush()
            exchange.close()
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            val failure = assertFailsWith<IllegalStateException> { client.stream("rt-acct-phone").first() }
            assertEquals("presence event missing deviceId", failure.message)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun presenceAnswersTheAccountRosterWithOnlineState() {
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/presence") { exchange ->
            val body = "[{\"deviceId\":\"phone\",\"platform\":\"android\",\"online\":true},{\"deviceId\":\"pad\",\"platform\":\"ios\",\"online\":false}]"
            val bytes = body.toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
            exchange.close()
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            assertEquals(
                listOf(RelayPresence(deviceId = "phone", platform = "android", online = true), RelayPresence(deviceId = "pad", platform = "ios", online = false)),
                client.presence("acct"),
            )
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun unknownTokenStreamsACleanEmptyClose() = runBlocking {
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/stream") { exchange ->
            exchange.sendResponseHeaders(200, 0)
            exchange.close()
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            val collected = withTimeoutOrNull(5_000) { client.stream("rt-none").toList() }
            assertEquals(emptyList(), collected)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun refusedStreamsFailLoud() = runBlocking {
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/stream") { exchange ->
            exchange.sendResponseHeaders(500, -1)
            exchange.close()
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            val failure = assertFailsWith<IllegalStateException> { client.stream("rt-acct-phone").first() }
            assertEquals("relay stream failed: HTTP 500", failure.message)
        } finally {
            server.stop(0)
        }
    }
}
