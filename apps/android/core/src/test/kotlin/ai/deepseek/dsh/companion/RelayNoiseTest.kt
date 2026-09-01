package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.NoiseCipherState
import ai.deepseek.dsh.link.NoiseHandshake
import ai.deepseek.dsh.link.decodeNoiseFrames
import ai.deepseek.dsh.link.encodeNoiseFrame
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private val EMPTY = ByteArray(0)

private fun hex(bytes: ByteArray): String =
    bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }

private fun unhex(value: String): ByteArray =
    ByteArray(value.length / 2) { index -> ((Character.digit(value[index * 2], 16) shl 4) + Character.digit(value[index * 2 + 1], 16)).toByte() }

private fun vectorObject(name: String): kotlinx.serialization.json.JsonObject {
    val resource = NoiseVectorTest::class.java.classLoader.getResource("fixtures/relay-noise-vectors.json")
        ?: error("relay noise vectors fixture missing")
    return Json.parseToJsonElement(resource.readText()).jsonObject[name]!!.jsonObject
}

/**
 * The Noise_XX stack against the fixed-key vectors the node reference
 * implementation (apps/relay/noise.mjs) generated: every port must
 * reproduce the handshake bytes, session id, channel binding, split keys,
 * and transport frames exactly — that byte-level agreement is the
 * cross-implementation interop proof, since no CI lane runs the node
 * service itself.
 */
class NoiseVectorTest {
    private fun pinned(role: NoiseHandshake.Role): NoiseHandshake {
        val keys = vectorObject("keys")
        val prefix = if (role == NoiseHandshake.Role.INITIATOR) "initiator" else "responder"
        return NoiseHandshake(
            role,
            unhex(keys["${prefix}Static"]!!.jsonPrimitive.content),
            unhex(keys["${prefix}Ephemeral"]!!.jsonPrimitive.content),
        )
    }

    @Test
    fun reproducesTheHandshakeBytesSessionIdAndChannelBinding() {
        val handshake = vectorObject("handshake")
        val alice = pinned(NoiseHandshake.Role.INITIATOR)
        val bob = pinned(NoiseHandshake.Role.RESPONDER)
        val msg1 = alice.writeMessage1()
        assertContentEquals(unhex(handshake["msg1"]!!.jsonPrimitive.content), msg1, "msg1 bytes")
        bob.readMessage1(msg1)
        val msg2 = bob.writeMessage2()
        assertContentEquals(unhex(handshake["msg2"]!!.jsonPrimitive.content), msg2, "msg2 bytes")
        alice.readMessage2(msg2)
        assertEquals(handshake["sessionIdAfterMsg2"]!!.jsonPrimitive.content, hex(alice.transcriptHash), "session id after msg2")
        val msg3 = alice.writeMessage3()
        assertContentEquals(unhex(handshake["msg3"]!!.jsonPrimitive.content), msg3, "msg3 bytes")
        bob.readMessage3(msg3)
        assertEquals(handshake["channelBindingAfterMsg3"]!!.jsonPrimitive.content, hex(alice.transcriptHash), "channel binding")
        assertEquals(hex(bob.transcriptHash), hex(alice.transcriptHash), "both roles agree")
    }

    @Test
    fun splitsTheReferenceTrafficKeysAndRoundTripsEveryFrame() {
        val transport = vectorObject("transport")
        val alice = pinned(NoiseHandshake.Role.INITIATOR)
        val bob = pinned(NoiseHandshake.Role.RESPONDER)
        bob.readMessage1(alice.writeMessage1())
        alice.readMessage2(bob.writeMessage2())
        bob.readMessage3(alice.writeMessage3())
        val aliceSend = alice.split().first
        val aliceRecv = alice.split().second
        val bobSend = bob.split().first
        val bobRecv = bob.split().second
        assertEquals(transport["c1Key"]!!.jsonPrimitive.content, hex(aliceSend.keyBytes), "c1 key")
        assertEquals(transport["c2Key"]!!.jsonPrimitive.content, hex(aliceRecv.keyBytes), "c2 key")
        for (entry in transport["c1Frames"]!!.jsonArray) {
            val frame = entry.jsonObject
            val payload = unhex(frame["payload"]!!.jsonPrimitive.content)
            val sealed = unhex(frame["frame"]!!.jsonPrimitive.content)
            assertContentEquals(sealed, aliceSend.encryptWithAd(EMPTY, payload), "c1 frame seals identically")
            assertContentEquals(payload, bobRecv.decryptWithAd(EMPTY, sealed), "c1 frame opens")
        }
        for (entry in transport["c2Frames"]!!.jsonArray) {
            val frame = entry.jsonObject
            val payload = unhex(frame["payload"]!!.jsonPrimitive.content)
            val sealed = unhex(frame["frame"]!!.jsonPrimitive.content)
            assertContentEquals(sealed, bobSend.encryptWithAd(EMPTY, payload), "c2 frame seals identically")
            assertContentEquals(payload, aliceRecv.decryptWithAd(EMPTY, sealed), "c2 frame opens")
        }
    }

    @Test
    fun rejectsTamperedFramesAndTruncatedFraming() {
        val transport = vectorObject("transport")
        val alice = pinned(NoiseHandshake.Role.INITIATOR)
        val bob = pinned(NoiseHandshake.Role.RESPONDER)
        bob.readMessage1(alice.writeMessage1())
        alice.readMessage2(bob.writeMessage2())
        bob.readMessage3(alice.writeMessage3())
        val tampered = unhex(transport["c1Frames"]!!.jsonArray.first().jsonObject["frame"]!!.jsonPrimitive.content)
        tampered[0] = (tampered[0].toInt() xor 1).toByte()
        assertFailsWith<Exception> { bob.split().second.decryptWithAd(EMPTY, tampered) }
        assertFailsWith<IllegalArgumentException> { decodeNoiseFrames(byteArrayOf(0, 4, 9)) }
        val framing = vectorObject("framing")
        assertContentEquals(
            unhex(framing["single"]!!.jsonPrimitive.content),
            encodeNoiseFrame(ByteArray(16) { it.toByte() }),
        )
    }
}

/**
 * The Noise-encrypted relay consumer against a real local HTTP server
 * whose handler runs the responder side of the same stack: handshake,
 * register, publish, poll, presence, and the push stream all ride framed
 * AEAD bodies over real sockets.
 */
class RelayClientNoiseTest {
    /** A minimal responder mirroring apps/relay/server.mjs semantics. */
    private class Harness {
        private val pendingHandshakes = mutableMapOf<String, NoiseHandshake>()
        private val sessions = mutableMapOf<String, Pair<NoiseCipherState, NoiseCipherState>>()
        private val devices = mutableMapOf<String, kotlinx.serialization.json.JsonObject>()
        private val queues = mutableMapOf<String, MutableList<kotlinx.serialization.json.JsonObject>>()
        private var streamWriter: ((ByteArray) -> Unit)? = null
        private var streamState: NoiseCipherState? = null
        private var streamHold: CountDownLatch? = null

        /** Let the open stream's handler return (its close ends the flow). */
        fun releaseStream() {
            streamHold?.countDown()
        }

        fun start(): com.sun.net.httpserver.HttpServer {
            val server = com.sun.net.httpserver.HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
            server.createContext("/relay/noise/hello") { exchange ->
                val handshake = NoiseHandshake(NoiseHandshake.Role.RESPONDER)
                handshake.readMessage1(exchange.requestBody.readBytes())
                val message = handshake.writeMessage2()
                val id = hex(handshake.transcriptHash)
                pendingHandshakes[id] = handshake
                exchange.responseHeaders.add("x-relay-session", id)
                respond(exchange, message)
            }
            server.createContext("/relay/noise/complete") { exchange ->
                val id = exchange.requestHeaders.getFirst("x-relay-session") ?: ""
                val handshake = pendingHandshakes.remove(id)
                if (handshake == null) {
                    respond(exchange, "{\"error\":\"unknown relay session\"}".toByteArray(), status = 410)
                    return@createContext
                }
                handshake.readMessage3(exchange.requestBody.readBytes())
                val split = handshake.split()
                sessions[id] = split
                respond(exchange, encodeNoiseFrame(split.first.encryptWithAd(EMPTY, "{\"ok\":true}".toByteArray())))
            }
            server.createContext("/relay/register") { exchange ->
                val opened = openSession(exchange) ?: return@createContext
                val request = opened.second
                val token = "rt-${request["accountId"]!!.jsonPrimitive.content}-${request["deviceId"]!!.jsonPrimitive.content}"
                devices[token] = request
                queues[token] = mutableListOf()
                respondEncrypted(exchange, opened.first, "{\"token\":\"$token\"}".toByteArray())
            }
            server.createContext("/relay/publish") { exchange ->
                val opened = openSession(exchange) ?: return@createContext
                val request = opened.second
                val accountId = request["accountId"]!!.jsonPrimitive.content
                var delivered = 0
                for ((_, device) in devices) {
                    if (device["accountId"]!!.jsonPrimitive.content != accountId) continue
                    val envelope = kotlinx.serialization.json.buildJsonObject {
                        for ((key, value) in request) if (key != "accountId") put(key, value)
                    }
                    val state = streamState
                    val writer = streamWriter
                    if (state != null && writer != null) {
                        writer(encodeNoiseFrame(state.encryptWithAd(EMPTY, envelope.toString().toByteArray())))
                    } else {
                        queues.entries.first { it.key.startsWith("rt-$accountId-") }.value.add(envelope)
                    }
                    delivered += 1
                }
                respondEncrypted(exchange, opened.first, "{\"delivered\":$delivered}".toByteArray())
            }
            server.createContext("/relay/poll") { exchange ->
                val opened = openSession(exchange) ?: return@createContext
                val token = opened.second["token"]!!.jsonPrimitive.content
                val queue = queues.remove(token) ?: mutableListOf()
                val body = queue.fold(ByteArray(0)) { acc, envelope ->
                    acc + encodeNoiseFrame(opened.first.first.encryptWithAd(EMPTY, envelope.toString().toByteArray()))
                }
                respond(exchange, body)
            }
            server.createContext("/relay/presence") { exchange ->
                val opened = openSession(exchange) ?: return@createContext
                val accountId = opened.second["accountId"]!!.jsonPrimitive.content
                val roster = devices.values
                    .filter { it["accountId"]!!.jsonPrimitive.content == accountId }
                    .joinToString(",", "[", "]") {
                        "{\"deviceId\":\"${it["deviceId"]!!.jsonPrimitive.content}\",\"platform\":\"${it["platform"]!!.jsonPrimitive.content}\",\"online\":false}"
                    }
                respondEncrypted(exchange, opened.first, roster.toByteArray())
            }
            server.createContext("/relay/stream") { exchange ->
                val opened = openSession(exchange) ?: return@createContext
                val request = opened.second
                val token = request["token"]!!.jsonPrimitive.content
                val stream = NoiseCipherState(unhex(request["streamKey"]!!.jsonPrimitive.content))
                val hold = CountDownLatch(1)
                streamHold = hold
                streamState = stream
                // Response length 0 = chunked; frames flush as written.
                exchange.sendResponseHeaders(200, 0)
                val out = exchange.responseBody
                for (envelope in queues.remove(token) ?: mutableListOf()) {
                    out.write(encodeNoiseFrame(stream.encryptWithAd(EMPTY, envelope.toString().toByteArray())))
                }
                out.flush()
                streamWriter = { frame -> out.write(frame); out.flush() }
                // Hold the handler thread so the chunked stream stays open;
                // the terminating chunk rides close() after release.
                hold.await(10, TimeUnit.SECONDS)
                exchange.close()
            }
            server.start()
            return server
        }

        /** The session + decrypted request JSON, or null after a 410 reply. */
        private fun openSession(exchange: com.sun.net.httpserver.HttpExchange): Pair<Pair<NoiseCipherState, NoiseCipherState>, kotlinx.serialization.json.JsonObject>? {
            val id = exchange.requestHeaders.getFirst("x-relay-session") ?: ""
            val session = sessions[id]
            if (session == null) {
                respond(exchange, "{\"error\":\"unknown relay session\"}".toByteArray(), status = 410)
                return null
            }
            val frames = decodeNoiseFrames(exchange.requestBody.readBytes())
            val request = Json.parseToJsonElement(String(session.second.decryptWithAd(EMPTY, frames.single()))).jsonObject
            return session to request
        }

        private fun respondEncrypted(exchange: com.sun.net.httpserver.HttpExchange, session: Pair<NoiseCipherState, NoiseCipherState>, value: ByteArray) {
            respond(exchange, encodeNoiseFrame(session.first.encryptWithAd(EMPTY, value)))
        }

        private fun respond(exchange: com.sun.net.httpserver.HttpExchange, body: ByteArray, status: Int = 200) {
            exchange.sendResponseHeaders(status, body.size.toLong())
            exchange.responseBody.write(body)
            exchange.close()
        }
    }

    @Test
    fun handshakesRegistersPublishesPollsAndAnswersPresence() {
        val harness = Harness()
        val server = harness.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            val token = client.register(RelayDevice("acct", "phone", "android"))
            assertEquals("rt-acct-phone", token)
            client.publish("acct", RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1"))
            assertEquals(
                listOf(RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1")),
                client.poll(token),
            )
            assertTrue(client.poll(token).isEmpty(), "polling drains")
            assertEquals(listOf(RelayPresence("phone", "android", false)), client.presence("acct"))
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun streamFlushesTheQueueThenDeliversLivePublishes() = runBlocking {
        val harness = Harness()
        val server = harness.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            val token = client.register(RelayDevice("acct", "phone", "android"))
            client.publish("acct", RelayEnvelope(kind = "task-completed", sessionId = "s1", turn = 3))
            val collected = CopyOnWriteArrayList<RelayStreamEvent>()
            val job = launch(kotlinx.coroutines.Dispatchers.IO) { client.stream(token).toList(collected) }
            withTimeout(5_000) { while (collected.isEmpty()) delay(20) }
            assertEquals(RelayStreamEvent.Envelope(RelayEnvelope(kind = "task-completed", sessionId = "s1", turn = 3)), collected.single())
            client.publish("acct", RelayEnvelope(kind = "question-waiting", sessionId = "s9", eventId = "e2"))
            withTimeout(5_000) { while (collected.size < 2) delay(20) }
            assertEquals(
                listOf(
                    RelayStreamEvent.Envelope(RelayEnvelope(kind = "task-completed", sessionId = "s1", turn = 3)),
                    RelayStreamEvent.Envelope(RelayEnvelope(kind = "question-waiting", sessionId = "s9", eventId = "e2")),
                ),
                collected.toList(),
            )
            harness.releaseStream()
            job.cancel()
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun aSessionIdMismatchFailsLoud() {
        val server = com.sun.net.httpserver.HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/noise/hello") { exchange ->
            val handshake = NoiseHandshake(NoiseHandshake.Role.RESPONDER)
            handshake.readMessage1(exchange.requestBody.readBytes())
            exchange.responseHeaders.add("x-relay-session", "deadbeef")
            respondRaw(exchange, handshake.writeMessage2())
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            val failure = assertFailsWith<IllegalStateException> { client.register(RelayDevice("acct", "phone", "android")) }
            assertEquals("relay session id does not match the handshake transcript", failure.message)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun aBrokenAckFailsKeyConfirmation() {
        val server = com.sun.net.httpserver.HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/relay/noise/hello") { exchange ->
            val handshake = NoiseHandshake(NoiseHandshake.Role.RESPONDER)
            handshake.readMessage1(exchange.requestBody.readBytes())
            exchange.responseHeaders.add("x-relay-session", hex(handshake.transcriptHash))
            respondRaw(exchange, handshake.writeMessage2())
        }
        server.createContext("/relay/noise/complete") { exchange ->
            // The ack seals under an unrelated handshake's keys, so the
            // client's key confirmation must fail loud.
            val stranger = NoiseHandshake(NoiseHandshake.Role.RESPONDER)
            stranger.readMessage1(ByteArray(32))
            respondRaw(exchange, encodeNoiseFrame(stranger.split().first.encryptWithAd(EMPTY, "{\"ok\":true}".toByteArray())))
        }
        server.start()
        try {
            val client = RelayClient("http://127.0.0.1:${server.address.port}")
            assertFailsWith<Exception> { client.register(RelayDevice("acct", "phone", "android")) }
        } finally {
            server.stop(0)
        }
    }

    private fun respondRaw(exchange: com.sun.net.httpserver.HttpExchange, body: ByteArray) {
        exchange.sendResponseHeaders(200, body.size.toLong())
        exchange.responseBody.write(body)
        exchange.close()
    }
}
