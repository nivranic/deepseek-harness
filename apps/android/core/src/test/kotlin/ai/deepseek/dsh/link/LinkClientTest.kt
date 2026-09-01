package ai.deepseek.dsh.link

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The client against a real local HTTP server: pairing exchanges the QR
 * code for an identity, every signed call carries the three credential
 * headers, refused calls surface their business error, and NDJSON streams
 * flow value frames until a failure frame ends them.
 */
class LinkClientTest {
    private lateinit var server: HttpServer
    private val capturedHeaders = ConcurrentLinkedQueue<Pair<String, String>>()
    private val capturedBodies = ConcurrentLinkedQueue<String>()

    @BeforeTest
    fun startServer() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/link/pair") { exchange ->
            capturedBodies.add(exchange.requestBody.readBytes().decodeToString())
            respond(
                exchange,
                200,
                """{"deviceId":"d-1","hostId":"h-1","hostName":"Studio Desk","role":"controller","linkProtocolVersion":1}""",
            )
        }
        server.createContext("/link/describe") { exchange ->
            capture(exchange)
            respond(
                exchange,
                200,
                """{"linkProtocolVersion":1,"contractVersion":1,"hostVersion":"0.1.2","hostId":"h-1","hostName":"Studio Desk",""" +
                    """"runtimeClass":"node","sessionFormatVersion":0,"allowRemoteApproval":false,""" +
                    """"capabilities":{"session":{"list":true,"history":true,"follow":true,"prompt":true,"cancel":true},""" +
                    """"workspace":{"follow":true},"interaction":{"approval":true,"question":true}}}""",
            )
        }
        server.createContext("/api/session/list") { exchange ->
            val body = capture(exchange)
            respond(exchange, 200, """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":true,"value":{"items":[]}}}""")
        }
        server.createContext("/api/session/prompt") { exchange ->
            val body = capture(exchange)
            respond(
                exchange,
                200,
                """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":false,"error":{"code":"session-gone","message":"no such session","details":{}}}}""",
            )
        }
        server.createContext("/link/stream/\$events") { exchange ->
            capture(exchange)
            respond(
                exchange,
                200,
                """{"k":"v","v":{"event":"approval/requested","eventId":"e1"}}""" + "\n" +
                    """{"k":"v","v":{"event":"question/requested","eventId":"e2"}}""" + "\n" +
                    """{"k":"e","c":"role","m":"observer may not answer","d":{}}""" + "\n",
                contentType = "application/x-ndjson",
            )
        }
        server.start()
    }

    @AfterTest
    fun stopServer() {
        server.stop(0)
    }

    private fun capture(exchange: HttpExchange): String {
        val body = exchange.requestBody.readBytes().decodeToString()
        capturedBodies.add(body)
        for (name in listOf(LinkSigning.deviceIdHeader, LinkSigning.timestampHeader, LinkSigning.signatureHeader)) {
            capturedHeaders.add(name to (exchange.requestHeaders.getFirst(name) ?: ""))
        }
        return body
    }

    private fun rpcId(body: String): String =
        Json.parseToJsonElement(body).jsonObject["rpcId"]!!.jsonPrimitive.content

    private fun respond(exchange: HttpExchange, status: Int, body: String, contentType: String = "application/json") {
        val bytes = body.toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.set("content-type", contentType)
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
        exchange.close()
    }

    private fun client(store: LinkCredentialsStoring): LinkClient =
        LinkClient(
            baseUrl = "http://127.0.0.1:${server.address.port}",
            pinnedFingerprint = "ab".repeat(32),
            store = store,
        )

    private fun pairingPayload() = LinkPairingPayload(
        v = 1.0,
        kind = "dsh-link-pairing",
        hostId = "h-1",
        hostName = "Studio Desk",
        endpoint = "http://127.0.0.1:${server.address.port}",
        spkiFingerprint = "ab".repeat(32),
        code = "7Kd9m2Xq4Lp8Rt3Vw6Yy1Zc5Bn8Qf2Hj",
        expiresAt = 1_807_315_200_000.0,
    )

    @Test
    fun unpairedCallsFailLoud() {
        val failure = assertFailsWith<LinkClientException.Unpaired> { client(MemoryLinkCredentialsStore()).call("session/list") }
        assertEquals("no paired identity", failure.message)
    }

    @Test
    fun pairExchangesTheCodeAndSignsSubsequentCalls() {
        val store = MemoryLinkCredentialsStore()
        val client = client(store)
        val credentials = client.pair(pairingPayload(), deviceName = "Pixel 9")

        assertEquals("d-1", credentials.deviceId)
        assertEquals("controller", credentials.role)
        assertEquals("http://127.0.0.1:" + server.address.port, credentials.endpoint)
        assertEquals("ab".repeat(32), credentials.pinnedFingerprint)
        assertEquals(credentials.deviceId, store.load()?.deviceId)
        val pairBody = capturedBodies.poll()
        assertTrue(pairBody.contains("\"code\":\"7Kd9m2Xq4Lp8Rt3Vw6Yy1Zc5Bn8Qf2Hj\""), pairBody)
        assertTrue(pairBody.contains("\"deviceName\":\"Pixel 9\""), pairBody)
        assertTrue(pairBody.contains("\"devicePublicKey\":\""), pairBody)

        val value = client.call("session/list")
        assertEquals(WireValue.ObjectValue(mapOf("items" to WireValue.ArrayValue(emptyList()))), value)
        val callBody = Json.parseToJsonElement(capturedBodies.poll()).jsonObject
        val callPayload = callBody["payload"]!!.jsonObject
        assertEquals(setOf("args"), callPayload.keys)
        assertEquals("{}", callPayload["args"].toString())
        val headerMap = capturedHeaders.associate { it }
        assertEquals("d-1", headerMap[LinkSigning.deviceIdHeader])
        assertTrue(headerMap[LinkSigning.timestampHeader]!!.all { it.isDigit() }, "timestamp is epoch millis")
        assertTrue(headerMap[LinkSigning.signatureHeader]!!.isNotEmpty(), "signature header present")
    }

    @Test
    fun pairRejectsAPayloadThatDoesNotOwnTheClientTransport() {
        val store = MemoryLinkCredentialsStore()
        val client = client(store)
        val failure = assertFailsWith<LinkClientException.BadWire> {
            client.pair(pairingPayload().copy(spkiFingerprint = "cd".repeat(32)), deviceName = "Pixel 9")
        }
        assertTrue(failure.message!!.contains("does not own this client transport"))
        assertEquals(null, store.load())
        assertTrue(capturedBodies.isEmpty())
    }

    @Test
    fun describeDecodesTheHostCapabilities() {
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val description = client.describe()
        assertEquals("Studio Desk", description.hostName)
        assertEquals(1.0, description.contractVersion)
        assertEquals("node", description.runtimeClass)
        assertEquals(true, description.capabilities.session.follow)
        assertEquals(true, description.capabilities.interaction.approval)
    }

    @Test
    fun refusedCallsSurfaceTheBusinessError() {
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val failure = assertFailsWith<LinkClientException.Refused> { client.call("session/prompt") }
        assertEquals("session-gone", failure.code)
        assertTrue(failure.message!!.contains("no such session"))
    }

    @Test
    fun successfulVoidCallReturnsNullValue() {
        server.createContext("/api/session/cancel") { exchange ->
            val body = capture(exchange)
            respond(exchange, 200, """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":true}}""")
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        assertEquals(WireValue.NullValue, client.call("session/cancel"))
    }

    @Test
    fun unaryCallRejectsCrossBranchResultFields() {
        server.createContext("/api/session/invalid") { exchange ->
            val body = capture(exchange)
            respond(
                exchange,
                200,
                """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":false,"value":null,"error":{"code":"invalid","message":"must not coexist","details":{}}}}""",
            )
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val failure = assertFailsWith<LinkClientException.BadWire> { client.call("session/invalid") }
        assertTrue(failure.message!!.contains("failed result carried a value"))
    }

    @Test
    fun restoreRebuildsTheClientFromPersistedCredentials() {
        val store = MemoryLinkCredentialsStore()
        assertEquals(null, LinkClient.restore(store))
        val client = client(store)
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val restored = LinkClient.restore(store)!!
        assertEquals("d-1", restored.credentials?.deviceId)
        assertEquals("ab".repeat(32), restored.pinnedFingerprint)
        // The restored client signs a working describe against the same server.
        val description = restored.describe()
        assertEquals("Studio Desk", description.hostName)
    }

    @Test
    fun fileStoreRoundTripsTheIdentity() {
        val directory = kotlin.io.path.createTempDirectory("link-credentials")
        val file = directory.resolve("credentials.json").toFile()
        val store = FileLinkCredentialsStore(file)
        assertEquals(null, store.load())
        store.save(
            LinkCredentials(
                deviceId = "d-1", hostId = "h-1", hostName = "Studio Desk", role = "controller",
                endpoint = "https://192.168.1.4:4931", pinnedFingerprint = "ab".repeat(32),
                signingKeyBase64 = "AAAA",
            ),
        )
        val loaded = store.load()
        assertEquals("d-1", loaded?.deviceId)
        assertEquals("https://192.168.1.4:4931", loaded?.endpoint)
        assertEquals("ab".repeat(32), loaded?.pinnedFingerprint)
        store.clear()
        assertEquals(null, store.load())
    }

    @Test
    fun fileStoreNeverPersistsTheSigningKeyAsStored() {
        // The boundary test: a cipher the test can see through proves the
        // on-disk bytes carry ciphertext where the key was, and that loading
        // opens it back to the working identity.
        class XorCipher : CredentialsCipher {
            override fun seal(plain: ByteArray): ByteArray = plain.map { (it.toInt() xor 0x5A).toByte() }.toByteArray()

            override fun open(sealed: ByteArray): ByteArray = seal(sealed)
        }

        val directory = kotlin.io.path.createTempDirectory("link-sealed")
        val file = directory.resolve("credentials.json").toFile()
        val plainKey = java.util.Base64.getEncoder().encodeToString(ByteArray(32) { (it + 1).toByte() })
        val store = FileLinkCredentialsStore(file, XorCipher())
        store.save(
            LinkCredentials(
                deviceId = "d-1", hostId = "h-1", hostName = "Studio Desk", role = "controller",
                endpoint = "https://192.168.1.4:4931", pinnedFingerprint = "ab".repeat(32),
                signingKeyBase64 = plainKey,
            ),
        )
        val onDisk = file.readText(Charsets.UTF_8)
        assertTrue(!onDisk.contains(plainKey), "the plaintext key never rides the disk bytes")
        val loaded = store.load()
        assertEquals(plainKey, loaded?.signingKeyBase64)
    }

    @Test
    fun streamsFlowValuesUntilTheFailureFrame() = runTest {
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        capturedBodies.poll()
        val collected = mutableListOf<WireValue>()
        val failure = assertFailsWith<LinkClientException.Refused> {
            client.stream("\$events").collect { collected.add(it) }
        }
        assertEquals(2, collected.size)
        assertEquals("approval/requested", (collected[0] as WireValue.ObjectValue).entries["event"]?.let { (it as WireValue.StringValue).value })
        assertEquals("observer may not answer", failure.message!!.substringAfter("role: "))
        val streamBody = Json.parseToJsonElement(capturedBodies.poll()).jsonObject
        assertEquals(setOf("args"), streamBody.keys)
        assertEquals("{}", streamBody["args"].toString())
    }
}
