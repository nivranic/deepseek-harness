package ai.deepseek.dsh.link

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
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
            respond(exchange, 200, """{"deviceId":"d-1","hostId":"h-1","hostName":"Studio Desk","role":"controller"}""")
        }
        server.createContext("/link/describe") { exchange ->
            capture(exchange)
            respond(
                exchange,
                200,
                """{"linkProtocolVersion":1,"hostVersion":"0.1.2","hostId":"h-1","hostName":"Studio Desk",""" +
                    """"runtimeClass":"node","sessionFormatVersion":0,"allowRemoteApproval":false,""" +
                    """"capabilities":{"session":{"list":true,"history":true,"follow":true,"prompt":true,"cancel":true},""" +
                    """"workspace":{"follow":true},"interaction":{"approval":true,"question":true}}}""",
            )
        }
        server.createContext("/api/session/list") { exchange ->
            capture(exchange)
            respond(exchange, 200, """{"type":"server-response","result":{"ok":true,"value":{"items":[]}}}""")
        }
        server.createContext("/api/session/prompt") { exchange ->
            capture(exchange)
            respond(exchange, 200, """{"type":"server-response","result":{"ok":false,"error":{"code":"session-gone","message":"no such session"}}}""")
        }
        server.createContext("/link/stream/\$events") { exchange ->
            capture(exchange)
            respond(
                exchange,
                200,
                """{"k":"v","v":{"event":"approval/requested","eventId":"e1"}}""" + "\n" +
                    """{"k":"v","v":{"event":"question/requested","eventId":"e2"}}""" + "\n" +
                    """{"k":"e","c":"role","m":"observer may not answer"}""" + "\n",
                contentType = "application/x-ndjson",
            )
        }
        server.start()
    }

    @AfterTest
    fun stopServer() {
        server.stop(0)
    }

    private fun capture(exchange: HttpExchange) {
        capturedBodies.add(exchange.requestBody.readBytes().decodeToString())
        for (name in listOf(LinkSigning.deviceIdHeader, LinkSigning.timestampHeader, LinkSigning.signatureHeader)) {
            capturedHeaders.add(name to (exchange.requestHeaders.getFirst(name) ?: ""))
        }
    }

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
        assertEquals(credentials.deviceId, store.load()?.deviceId)
        val pairBody = capturedBodies.poll()
        assertTrue(pairBody.contains("\"code\":\"7Kd9m2Xq4Lp8Rt3Vw6Yy1Zc5Bn8Qf2Hj\""), pairBody)
        assertTrue(pairBody.contains("\"deviceName\":\"Pixel 9\""), pairBody)
        assertTrue(pairBody.contains("\"devicePublicKey\":\""), pairBody)

        val value = client.call("session/list")
        assertEquals(WireValue.ObjectValue(mapOf("items" to WireValue.ArrayValue(emptyList()))), value)
        val headerMap = capturedHeaders.associate { it }
        assertEquals("d-1", headerMap[LinkSigning.deviceIdHeader])
        assertTrue(headerMap[LinkSigning.timestampHeader]!!.all { it.isDigit() }, "timestamp is epoch millis")
        assertTrue(headerMap[LinkSigning.signatureHeader]!!.isNotEmpty(), "signature header present")
    }

    @Test
    fun describeDecodesTheHostCapabilities() {
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val description = client.describe()
        assertEquals("Studio Desk", description.hostName)
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
    fun streamsFlowValuesUntilTheFailureFrame() = runTest {
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val collected = mutableListOf<WireValue>()
        val failure = assertFailsWith<LinkClientException.Refused> {
            client.stream("\$events").collect { collected.add(it) }
        }
        assertEquals(2, collected.size)
        assertEquals("approval/requested", (collected[0] as WireValue.ObjectValue).entries["event"]?.let { (it as WireValue.StringValue).value })
        assertEquals("observer may not answer", failure.message!!.substringAfter("role: "))
    }
}
