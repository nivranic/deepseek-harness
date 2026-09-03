package ai.deepseek.dsh.link

import ai.deepseek.dsh.companion.LinkWireDriving
import ai.deepseek.dsh.companion.SwitchableWireDriving
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.security.KeyPairGenerator
import java.util.Base64
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
    private val clients = ConcurrentLinkedQueue<LinkClient>()
    private var pairResponse =
        """{"deviceId":"d-1","hostId":"h-1","hostName":"Studio Desk","role":"controller","linkProtocolVersion":1}"""
    private val transportConfig = LinkTransportConfig(
        connectTimeoutMillis = 5_000,
        writeTimeoutMillis = 5_000,
        unaryReadTimeoutMillis = 5_000,
        unaryCallTimeoutMillis = 10_000,
        streamReadTimeoutMillis = 0,
        streamCallTimeoutMillis = 0,
    )

    @BeforeTest
    fun startServer() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/link/pair") { exchange ->
            capturedBodies.add(exchange.requestBody.readBytes().decodeToString())
            respond(exchange, 200, pairResponse)
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
    fun stopServer() = runBlocking {
        clients.forEach { client -> client.closeAndAwait() }
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
        client(
            endpoint = "http://127.0.0.1:${server.address.port}",
            pin = "ab".repeat(32),
            store = store,
        )

    private fun client(endpoint: String, pin: String, store: LinkCredentialsStoring): LinkClient =
        LinkClient(endpoint, pin, store, transportConfig).also { clients.add(it) }

    private fun pairedStore(endpoint: String, pin: String): MemoryLinkCredentialsStore {
        val key = KeyPairGenerator.getInstance("Ed25519").generateKeyPair().private.encoded
        return MemoryLinkCredentialsStore().apply {
            save(
                LinkCredentials(
                    deviceId = "d-1",
                    hostId = "h-1",
                    hostName = "Studio Desk",
                    role = "controller",
                    endpoint = endpoint,
                    pinnedFingerprint = pin,
                    signingKeyBase64 = Base64.getEncoder().encodeToString(key.copyOfRange(key.size - 32, key.size)),
                ),
            )
        }
    }

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
    fun unpairedCallsFailLoud() = runBlocking {
        val failure = assertFailsWith<LinkClientException.Unpaired> { client(MemoryLinkCredentialsStore()).call("session/list") }
        assertEquals("no paired identity", failure.message)
    }

    @Test
    fun pairExchangesTheCodeAndSignsSubsequentCalls() = runBlocking {
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
    fun pairRejectsAPayloadThatDoesNotOwnTheClientTransport() = runBlocking {
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
    fun pairRejectsInvalidRequiredResponseFieldsWithoutPersistingCredentials() = runBlocking {
        val invalidResponses = listOf(
            "not-json",
            "[]",
            """{"hostId":"h-1","hostName":"Studio Desk","role":"controller","linkProtocolVersion":1}""",
            """{"deviceId":"","hostId":"h-1","hostName":"Studio Desk","role":"controller","linkProtocolVersion":1}""",
            """{"deviceId":[],"hostId":"h-1","hostName":"Studio Desk","role":"controller","linkProtocolVersion":1}""",
            """{"deviceId":"d-1","hostId":"h-1","hostName":"Studio Desk","role":"owner","linkProtocolVersion":1}""",
            """{"deviceId":"d-1","hostId":"h-1","hostName":"Studio Desk","role":"controller","linkProtocolVersion":2}""",
        )

        for (response in invalidResponses) {
            pairResponse = response
            val store = MemoryLinkCredentialsStore()
            val client = client(store)
            assertFailsWith<LinkClientException.BadWire> {
                client.pair(pairingPayload(), deviceName = "Pixel 9")
            }
            assertEquals(null, store.load())
        }
    }

    @Test
    fun describeDecodesTheHostCapabilities() = runBlocking {
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val description = client.describe()
        assertEquals("Studio Desk", description.hostName)
        assertEquals(1.0, description.contractVersion)
        assertEquals("node", description.runtimeClass)
        assertEquals(true, description.capabilities.session.follow)
        assertEquals(true, description.capabilities.interaction.approval)
        assertEquals(true, description.capabilities.interaction.question)
    }

    @Test
    fun refusedCallsSurfaceTheBusinessError() = runBlocking {
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val failure = assertFailsWith<LinkClientException.Refused> { client.call("session/prompt") }
        assertEquals("session-gone", failure.code)
        assertTrue(failure.message!!.contains("no such session"))
    }

    @Test
    fun carrierAuthorizationRefusalUsesTheStableErrorCode() = runBlocking {
        server.createContext("/api/session/denied") { exchange ->
            capture(exchange)
            respond(exchange, 403, """{"error":"forbidden","reason":"session"}""")
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")

        val failure = assertFailsWith<LinkClientException.Refused> { client.call("session/denied") }
        assertEquals("forbidden", failure.code)
        assertTrue(failure.message!!.contains("session"))
    }

    @Test
    fun streamCarrierAuthorizationRefusalUsesTheStableErrorCode() = runBlocking {
        server.createContext("/link/stream/session/denied") { exchange ->
            capture(exchange)
            respond(exchange, 403, """{"error":"forbidden","reason":"session"}""")
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")

        val failure = assertFailsWith<LinkClientException.Refused> {
            client.stream("session/denied").collect {}
        }
        assertEquals("forbidden", failure.code)
        assertTrue(failure.message!!.contains("session"))
    }

    @Test
    fun malformedCarrierRejectionKeepsTheCarrierClassification() = runBlocking {
        server.createContext("/api/session/malformed-rejection") { exchange ->
            capture(exchange)
            respond(exchange, 403, """{"error":[],"message":{},"reason":[]}""")
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")

        val failure = assertFailsWith<LinkClientException.Carrier> {
            client.call("session/malformed-rejection")
        }
        assertEquals(403, failure.status)
        assertTrue(failure.message!!.contains("HTTP 403"))
    }

    @Test
    fun successfulVoidCallReturnsNullValue() = runBlocking {
        server.createContext("/api/session/cancel") { exchange ->
            val body = capture(exchange)
            respond(exchange, 200, """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":true}}""")
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        assertEquals(WireValue.NullValue, client.call("session/cancel"))
    }

    @Test
    fun unaryCallRejectsCrossBranchResultFields() = runBlocking {
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
    fun restoreRebuildsTheClientFromPersistedCredentials() = runBlocking {
        val store = MemoryLinkCredentialsStore()
        assertEquals(null, LinkClient.restore(store, transportConfig))
        val client = client(store)
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val restored = LinkClient.restore(store, transportConfig)!!
        clients.add(restored)
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

    @Test
    fun unaryWireCallSuspendsWithoutOccupyingTheCallerDispatcher() = runBlocking {
        val releaseServer = CountDownLatch(1)
        val requestStarted = CompletableDeferred<Unit>()
        server.createContext("/api/session/main-dispatcher") { exchange ->
            val body = capture(exchange)
            requestStarted.complete(Unit)
            try {
                releaseServer.await()
                respond(
                    exchange,
                    200,
                    """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":true}}""",
                )
            } catch (_: IOException) {
                exchange.close()
            }
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val mainThread = AtomicReference<Thread>()
        val main = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "link-test-main").apply {
                isDaemon = true
                mainThread.set(this)
            }
        }.asCoroutineDispatcher()

        try {
            val request = async(main) { LinkWireDriving(client).call("session/main-dispatcher") }
            withTimeout(5_000) { requestStarted.await() }
            val scheduled = async(main) { Thread.currentThread() }
            assertTrue(mainThread.get() === withTimeout(5_000) { scheduled.await() })
            releaseServer.countDown()
            assertEquals(WireValue.NullValue, withTimeout(5_000) { request.await() })
        } finally {
            releaseServer.countDown()
            main.close()
        }
    }

    @Test
    fun cancellingUnaryWireCallCancelsItsOkHttpCall() = runBlocking {
        val releaseServer = CountDownLatch(1)
        val requestStarted = CompletableDeferred<Unit>()
        val failedEvent = CompletableDeferred<Unit>()
        server.createContext("/api/session/cancellable") { exchange ->
            val body = capture(exchange)
            requestStarted.complete(Unit)
            try {
                releaseServer.await()
                respond(
                    exchange,
                    200,
                    """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":true}}""",
                )
            } catch (_: IOException) {
                exchange.close()
            }
        }
        val endpoint = "http://127.0.0.1:${server.address.port}"
        val pin = "ab".repeat(32)
        val observer = object : LinkCallObserver {
            override fun requestBodyStart(path: String) = Unit

            override fun requestBodyEnd(path: String, byteCount: Long) = Unit

            override fun callFailed(path: String, failure: IOException) {
                if (path == "/api/session/cancellable") failedEvent.complete(Unit)
            }
        }
        val client = LinkClient.observed(endpoint, pin, pairedStore(endpoint, pin), transportConfig, observer)
            .also { clients.add(it) }
        val calling = launch(Dispatchers.Default) { LinkWireDriving(client).call("session/cancellable") }

        try {
            withTimeout(5_000) { requestStarted.await() }
            withTimeout(5_000) { calling.cancelAndJoin() }
            withTimeout(5_000) { failedEvent.await() }
            assertTrue(calling.isCancelled, "unary cancellation did not cancel the wire caller")
        } finally {
            calling.cancel()
            releaseServer.countDown()
        }
    }

    @Test
    fun closeRacingEnqueueSettlesAfterDispatcherShutdown() = runBlocking {
        val callStarted = CompletableDeferred<Unit>()
        val releaseEnqueue = CountDownLatch(1)
        val endpoint = "http://127.0.0.1:${server.address.port}"
        val pin = "ab".repeat(32)
        val observer = object : LinkCallObserver {
            override fun callStart(path: String) {
                if (path == "/api/session/list") {
                    callStarted.complete(Unit)
                    releaseEnqueue.await()
                }
            }

            override fun requestBodyStart(path: String) = Unit

            override fun requestBodyEnd(path: String, byteCount: Long) = Unit
        }
        val client = LinkClient.observed(endpoint, pin, pairedStore(endpoint, pin), transportConfig, observer)
            .also { clients.add(it) }
        val failure = async(Dispatchers.IO) {
            runCatching { LinkWireDriving(client).call("session/list") }.exceptionOrNull()
        }

        try {
            withTimeout(5_000) { callStarted.await() }
            client.close()
            releaseEnqueue.countDown()
            assertTrue(
                withTimeout(5_000) { failure.await() } is LinkClientException.Carrier,
                "close/enqueue race did not settle as a closed carrier",
            )
        } finally {
            releaseEnqueue.countDown()
        }
    }

    @Test
    fun cancellingDuringTlsConnectSettlesTheCallOwner() = runBlocking {
        val listener = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val accepted = CompletableDeferred<Unit>()
        val releaseServer = CountDownLatch(1)
        val serverThread = thread(name = "link-stalled-tls", isDaemon = true) {
            listener.accept().use {
                accepted.complete(Unit)
                releaseServer.await()
            }
        }
        val endpoint = "https://127.0.0.1:${listener.localPort}"
        val pin = "ab".repeat(32)
        val client = client(endpoint, pin, pairedStore(endpoint, pin))
        val collecting = launch(Dispatchers.IO) { client.stream("connect").collect { } }

        try {
            withTimeout(5_000) { accepted.await() }
            delay(50)
            assertTrue(!collecting.isCompleted, "TLS connect did not remain blocked")
            withTimeout(5_000) { collecting.cancelAndJoin() }
            assertTrue(collecting.isCompleted, "TLS-connect cancellation did not settle its OkHttp call")
        } finally {
            collecting.cancel()
            releaseServer.countDown()
            listener.close()
            serverThread.join(5_000)
        }
    }

    @Test
    fun cancellingWhileWritingTheRequestSettlesTheCallOwner() = runBlocking {
        val releaseServer = CountDownLatch(1)
        val requestStarted = CompletableDeferred<Unit>()
        val requestBodyStarted = CompletableDeferred<Unit>()
        val requestBodyEnded = AtomicBoolean(false)
        server.createContext("/link/stream/write") { exchange ->
            requestStarted.complete(Unit)
            try {
                releaseServer.await()
            } finally {
                exchange.close()
            }
        }
        val endpoint = "http://127.0.0.1:${server.address.port}"
        val pin = "ab".repeat(32)
        val callObserver = object : LinkCallObserver {
            override fun requestBodyStart(path: String) {
                if (path == "/link/stream/write") requestBodyStarted.complete(Unit)
            }

            override fun requestBodyEnd(path: String, byteCount: Long) {
                if (path == "/link/stream/write") requestBodyEnded.set(true)
            }
        }
        val client = LinkClient.observed(endpoint, pin, MemoryLinkCredentialsStore(), transportConfig, callObserver)
            .also { clients.add(it) }
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val payload = mapOf("blob" to WireValue.StringValue("x".repeat(16 * 1024 * 1024)))
        val collecting = launch(Dispatchers.IO) { client.stream("write", payload).collect { } }

        try {
            withTimeout(10_000) { requestBodyStarted.await() }
            withTimeout(10_000) { requestStarted.await() }
            delay(50)
            assertFalse(requestBodyEnded.get(), "the request body completed before the write-cancellation assertion")
            assertTrue(!collecting.isCompleted, "the unread request body did not keep the write active")
            withTimeout(5_000) { collecting.cancelAndJoin() }
            assertTrue(collecting.isCompleted, "write cancellation did not settle its OkHttp call")
        } finally {
            collecting.cancel()
            releaseServer.countDown()
        }
    }

    @Test
    fun cancellingBeforeResponseHeadersSettlesTheCallOwner() = runBlocking {
        val releaseServer = CountDownLatch(1)
        val requestStarted = CompletableDeferred<Unit>()
        server.createContext("/link/stream/pre-headers") { exchange ->
            capture(exchange)
            requestStarted.complete(Unit)
            try {
                releaseServer.await()
            } finally {
                exchange.close()
            }
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        val collecting = launch(Dispatchers.IO) { client.stream("pre-headers").collect { } }

        try {
            withTimeout(5_000) { requestStarted.await() }
            withTimeout(5_000) { collecting.cancelAndJoin() }
            assertTrue(collecting.isCompleted, "pre-header cancellation did not settle its OkHttp call")
        } finally {
            collecting.cancel()
            releaseServer.countDown()
        }
    }

    @Test
    fun replacingTheWireRetiresThePreviousClientsActiveCall() = runBlocking {
        val releaseServer = CountDownLatch(1)
        val requestStarted = CompletableDeferred<Unit>()
        server.createContext("/link/stream/retired") { exchange ->
            capture(exchange)
            requestStarted.complete(Unit)
            try {
                releaseServer.await()
            } finally {
                exchange.close()
            }
        }
        val previous = client(MemoryLinkCredentialsStore())
        previous.pair(pairingPayload(), deviceName = "Pixel 9")
        val replacement = client(MemoryLinkCredentialsStore())
        replacement.pair(pairingPayload(), deviceName = "Pixel 10")
        val switching = SwitchableWireDriving(LinkWireDriving(previous))
        val failure = CompletableDeferred<Throwable?>()
        val collecting = launch(Dispatchers.IO) {
            failure.complete(runCatching { switching.stream("retired").collect { } }.exceptionOrNull())
        }

        try {
            withTimeout(5_000) { requestStarted.await() }
            switching.replaceAndAwait(LinkWireDriving(replacement))
            withTimeout(5_000) { collecting.join() }
            assertTrue(failure.await() is LinkClientException.Carrier, "retiring the old wire did not cancel its call")
        } finally {
            switching.closeAndAwait()
            collecting.cancel()
            releaseServer.countDown()
        }
    }

    @Test
    fun replacingTheWireWaitsForABackpressuredCollectorAndDropsQueuedOldFrames() = runBlocking {
        val releaseServer = CountDownLatch(1)
        val firstFrameEntered = CompletableDeferred<Unit>()
        val releaseFirstFrame = CompletableDeferred<Unit>()
        val secondFrameSeen = AtomicBoolean(false)
        server.createContext("/link/stream/backpressured") { exchange ->
            capture(exchange)
            exchange.responseHeaders.set("content-type", "application/x-ndjson")
            exchange.sendResponseHeaders(200, 0)
            try {
                exchange.responseBody.write(
                    (
                        """{"k":"v","v":{"type":"ready","clientId":"old-1"}}""" + "\n" +
                            """{"k":"v","v":{"type":"ready","clientId":"old-2"}}""" + "\n"
                    ).toByteArray(),
                )
                exchange.responseBody.flush()
                releaseServer.await()
            } finally {
                exchange.close()
            }
        }
        val previous = client(MemoryLinkCredentialsStore())
        previous.pair(pairingPayload(), deviceName = "Pixel 9")
        val replacement = client(MemoryLinkCredentialsStore())
        val switching = SwitchableWireDriving(LinkWireDriving(previous))
        val collectionFailure = CompletableDeferred<Throwable?>()
        val collecting = launch(Dispatchers.Default) {
            collectionFailure.complete(
                runCatching {
                    switching.stream("backpressured").collect { frame ->
                        val clientId = (frame as WireValue.ObjectValue).entries["clientId"]
                        if (clientId == WireValue.StringValue("old-1")) {
                            firstFrameEntered.complete(Unit)
                            releaseFirstFrame.await()
                        } else if (clientId == WireValue.StringValue("old-2")) {
                            secondFrameSeen.set(true)
                        }
                    }
                }.exceptionOrNull(),
            )
        }

        try {
            withTimeout(5_000) { firstFrameEntered.await() }
            val replacing = async(Dispatchers.Default) {
                switching.replaceAndAwait(LinkWireDriving(replacement))
            }
            delay(50)
            assertFalse(replacing.isCompleted, "replacement returned while the old collector still owned a frame")
            releaseFirstFrame.complete(Unit)
            withTimeout(5_000) { replacing.await() }
            assertTrue(collecting.isCompleted, "replacement returned before the old collection settled")
            assertFalse(secondFrameSeen.get(), "a queued frame from the retired transport reached the collector")
            assertTrue(
                collectionFailure.await() is LinkClientException.Carrier,
                "retiring the old transport did not terminate the collection as a carrier failure",
            )
        } finally {
            releaseFirstFrame.complete(Unit)
            releaseServer.countDown()
            collecting.cancelAndJoin()
            switching.closeAndAwait()
        }
    }

    @Test
    fun cancellingMidStreamClosesTheResponseSourceAndSettlesTheCollector() = runBlocking {
        val releaseServer = CountDownLatch(1)
        val firstFrame = CompletableDeferred<Unit>()
        server.createContext("/link/stream/blocked") { exchange ->
            capture(exchange)
            exchange.responseHeaders.set("content-type", "application/x-ndjson")
            exchange.sendResponseHeaders(200, 0)
            try {
                exchange.responseBody.write(
                    ("""{"k":"v","v":{"type":"ready","clientId":"blocked"}}""" + "\n").toByteArray(),
                )
                exchange.responseBody.flush()
                releaseServer.await()
            } finally {
                exchange.close()
            }
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Pixel 9")
        capturedBodies.poll()
        val collecting = launch(Dispatchers.IO) {
            client.stream("blocked").collect { firstFrame.complete(Unit) }
        }

        try {
            withTimeout(5_000) { firstFrame.await() }
            delay(50)
            assertTrue(!collecting.isCompleted, "the server still owns an open stream")
            withTimeout(5_000) { collecting.cancelAndJoin() }
            assertTrue(collecting.isCompleted, "mid-stream cancellation did not settle its response source")
        } finally {
            collecting.cancel()
            releaseServer.countDown()
        }
    }
}
