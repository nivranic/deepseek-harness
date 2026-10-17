package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.NoiseCipherState
import ai.deepseek.dsh.link.NoiseHandshake
import ai.deepseek.dsh.link.NoiseNonceExhaustedException
import ai.deepseek.dsh.link.decodeNoiseFrames
import ai.deepseek.dsh.link.encodeNoiseFrame
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

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
 * interop check alongside the Node service's real HTTP corpus in the
 * repository test gate.
 */
class NoiseVectorTest {
    @Test
    fun reproducesHighNonceFramesAndRetriesAfterAuthenticationFailure() {
        val boundary = vectorObject("nonceBoundaries")
        val key = unhex(boundary["key"]!!.jsonPrimitive.content)
        val ad = unhex(boundary["ad"]!!.jsonPrimitive.content)
        val payload = unhex(boundary["payload"]!!.jsonPrimitive.content)
        for (entry in boundary["vectors"]!!.jsonArray) {
            val vector = entry.jsonObject
            val counter = vector["counter"]!!.jsonPrimitive.content.toULong()
            val sender = NoiseCipherState(key).apply { this.counter = counter }
            val receiver = NoiseCipherState(key).apply { this.counter = counter }
            val frame = sender.encryptWithAd(ad, payload)
            assertContentEquals(unhex(vector["frame"]!!.jsonPrimitive.content), frame)
            assertEquals(counter + 1uL, sender.counter)
            val tampered = frame.copyOf()
            tampered[0] = (tampered[0].toInt() xor 1).toByte()
            assertFailsWith<Exception> { receiver.decryptWithAd(ad, tampered) }
            assertEquals(counter, receiver.counter)
            assertContentEquals(payload, receiver.decryptWithAd(ad, frame))
            assertEquals(counter + 1uL, receiver.counter)
        }
    }

    @Test
    fun neverWrapsAfterTheLastUsableNonce() {
        val key = unhex(vectorObject("nonceBoundaries")["key"]!!.jsonPrimitive.content)
        val sender = NoiseCipherState(key).apply { counter = ULong.MAX_VALUE - 1uL }
        val receiver = NoiseCipherState(key).apply { counter = ULong.MAX_VALUE - 1uL }
        val frame = sender.encryptWithAd(EMPTY, EMPTY)
        assertContentEquals(EMPTY, receiver.decryptWithAd(EMPTY, frame))
        repeat(2) {
            assertFailsWith<NoiseNonceExhaustedException> { sender.encryptWithAd(EMPTY, EMPTY) }
            assertFailsWith<NoiseNonceExhaustedException> { receiver.decryptWithAd(EMPTY, frame) }
            assertEquals(ULong.MAX_VALUE, sender.counter)
            assertEquals(ULong.MAX_VALUE, receiver.counter)
        }
    }

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
