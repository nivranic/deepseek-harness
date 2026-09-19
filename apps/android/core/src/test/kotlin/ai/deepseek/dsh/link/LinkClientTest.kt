package ai.deepseek.dsh.link

import ai.deepseek.dsh.companion.LinkWireDriving
import ai.deepseek.dsh.companion.SessionModel
import ai.deepseek.dsh.companion.SwitchableWireDriving
import ai.deepseek.dsh.companion.WireDriving
import ai.deepseek.dsh.companion.toJson
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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
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
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
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
    @Volatile private var descriptionResponse =
        """{"linkProtocolVersion":1,"contractVersion":1,"hostVersion":"0.1.2","hostId":"h-1","hostName":"Studio Desk",""" +
            """"runtimeClass":"full","sessionFormatVersion":0,"allowRemoteApproval":false,""" +
            """"capabilities":{"session":{"list":true,"history":true,"follow":true,"prompt":true,"cancel":true},""" +
            """"workspace":{"follow":true},"interaction":{"approval":true,"question":true}}}"""
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
            respond(exchange, 200, descriptionResponse)
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
                    """{"k":"e","c":"role","m":"observer may not answer","d":{"role":"observer"}}""" + "\n",
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

    @Test
    fun sessionModelKeepsUnknownEventsAcrossLiveFramesAndReplacementSnapshots() = runBlocking {
        val scenario = checkNotNull(javaClass.getResource("/conformance/unknown-session-events.json"))
            .readText().let { Json.parseToJsonElement(it).jsonObject }
        val records = scenario.getValue("records").jsonArray
        val expected = scenario.getValue("expected").jsonObject
        val template = checkNotNull(javaClass.getResource("/fixtures/session-snapshot-frame.json"))
            .readText().let { Json.parseToJsonElement(it).jsonObject }
        fun snapshot(count: Int) = JsonObject(template + mapOf(
            "cursor" to JsonPrimitive(count), "records" to JsonArray(records.take(count)),
            "hasMore" to JsonPrimitive(false),
        ))
        val releaseUnknown = CountDownLatch(1)
        val releaseKnown = CountDownLatch(1)
        val releaseReplacement = CountDownLatch(1)
        val releaseServer = CountDownLatch(1)
        val connections = AtomicInteger()
        server.createContext("/link/stream/session/follow") { exchange ->
            capture(exchange)
            exchange.responseHeaders.set("content-type", "application/x-ndjson")
            exchange.sendResponseHeaders(200, 0)
            fun send(value: JsonElement) {
                val line = JsonObject(mapOf("k" to JsonPrimitive("v"), "v" to value)).toString() + "\n"
                exchange.responseBody.write(line.toByteArray(Charsets.UTF_8))
                exchange.responseBody.flush()
            }
            try {
                when (connections.incrementAndGet()) {
                    1 -> {
                        send(snapshot(3))
                        releaseUnknown.await()
                        send(records[3])
                        releaseKnown.await()
                        records.drop(4).forEach(::send)
                    }
                    2 -> {
                        releaseReplacement.await()
                        send(snapshot(records.size))
                        releaseServer.await()
                    }
                    else -> error("unexpected extra follow connection")
                }
            } finally {
                exchange.close()
            }
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), deviceName = "Session compatibility")
        val productionWire = LinkWireDriving(client)
        val delivered = Channel<WireValue>(Channel.UNLIMITED)
        val observingWire = object : WireDriving by productionWire {
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
                productionWire.stream(endpoint, payload).collect { frame ->
                    emit(frame)
                    delivered.send(frame)
                }
            }
        }
        val model = SessionModel(observingWire, this, reconnectDelayMillis = 1)
        suspend fun nextDelivered() = withTimeout(5_000) { delivered.receive().toJsonElement().jsonObject }
        try {
            model.openSession("session-1")
            assertEquals("snapshot", nextDelivered().getValue("type").jsonPrimitive.content)
            val opening = checkNotNull(model.open.value).state
            assertEquals(3, opening.items.size)
            assertEquals(3L, opening.cursor)
            assertTrue(opening.planActive)
            assertEquals("in_progress", opening.todos.single().status)
            assertEquals("", opening.items.last().text)

            releaseUnknown.countDown()
            assertEquals("event", nextDelivered().getValue("type").jsonPrimitive.content)
            val unknown = checkNotNull(model.open.value).state
            assertEquals(4L, unknown.cursor)
            assertEquals(4, unknown.items.size)
            assertTrue(unknown.planActive)
            assertEquals(opening.todos, unknown.todos)
            assertEquals("", unknown.items.last().text)
            assertTrue(unknown.items.none { "未知载荷" in it.text })

            releaseKnown.countDown()
            repeat(2) { assertEquals("event", nextDelivered().getValue("type").jsonPrimitive.content) }
            assertEquals(expected, checkNotNull(model.open.value).state.toJson())
            releaseReplacement.countDown()
            assertEquals("snapshot", nextDelivered().getValue("type").jsonPrimitive.content)
            assertEquals(2, connections.get())
            assertEquals(expected, checkNotNull(model.open.value).state.toJson())
            withTimeout(5_000) { model.closeAndAwait(); client.closeAndAwait() }
            assertEquals(null, model.open.value)
            val closed = client.requestSnapshot()
            assertTrue(closed.closed)
            assertEquals(0, closed.pendingRequests)
            assertEquals(closed.startedRequests, closed.finishedRequests)
        } finally {
            releaseUnknown.countDown()
            releaseKnown.countDown()
            releaseReplacement.countDown()
            releaseServer.countDown()
            model.closeAndAwait()
            client.closeAndAwait()
            delivered.close()
        }
    }

    @Test
    fun responseCompatibilityCorpusChecksActualRpcAndStreamReceivers() = runBlocking {
        val corpus = javaClass.getResourceAsStream("/fixtures/client-responses.v1.json")!!.use {
            Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject
        }
        assertEquals(1, corpus.getValue("schemaVersion").jsonPrimitive.int)
        val cases = corpus.getValue("cases").jsonArray
        assertTrue(cases.isNotEmpty())
        val response = AtomicReference("")
        val requestId = corpus.getValue("requestRpcId").jsonPrimitive.content
        server.createContext("/api/compatibility/response") { exchange ->
            val body = capture(exchange)
            respond(exchange, 200, response.get().replace("\"$requestId\"", "\"${rpcId(body)}\""))
        }
        server.createContext("/link/stream/compatibility/response") { exchange ->
            capture(exchange)
            respond(exchange, 200, response.get() + "\n", contentType = "application/x-ndjson")
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), "Response Phone")
        val failures = mutableListOf<String>()
        for (element in cases) {
            val row = element.jsonObject
            val id = row.getValue("id").jsonPrimitive.content
            response.set(row.getValue("body").jsonPrimitive.content)
            val received = mutableListOf<WireValue>()
            suspend fun operation(): WireValue = when (row.getValue("kind").jsonPrimitive.content) {
                "rpc" -> client.call("compatibility/response")
                "stream" -> {
                    client.stream("compatibility/response").toList(received)
                    assertEquals(1, received.size, id)
                    received.single()
                }
                else -> error("unknown response corpus kind")
            }
            runCatching {
                when (row.getValue("outcome").jsonPrimitive.content) {
                    "value" -> assertEquals(row.getValue("value"), operation().toJsonElement(), id)
                    "void" -> assertEquals(WireValue.NullValue, operation(), id)
                    "bad-wire" -> {
                        assertFailsWith<LinkClientException.BadWire>(id) { operation() }
                        assertTrue(received.isEmpty(), id)
                    }
                    "refused" -> {
                        val failure = assertFailsWith<LinkClientException.Refused>(id) { operation() }
                        assertEquals(row.getValue("code").jsonPrimitive.content, failure.code, id)
                        assertTrue(received.isEmpty(), id)
                    }
                    else -> error("unknown response corpus outcome")
                }
            }.onFailure { failures.add("$id: ${it.javaClass.simpleName}") }
        }
        println("response corpus: ${cases.size - failures.size}/${cases.size}")
        assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    }

    @Test
    fun pairingResponseCompatibilityPreservesCredentialsOnRefusal() = runBlocking {
        val corpus = javaClass.getResourceAsStream("/fixtures/pair-responses.v1.json")!!.use {
            Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject
        }
        assertEquals(1, corpus.getValue("schemaVersion").jsonPrimitive.int)
        assertEquals(pairingPayload().v, corpus.getValue("protocolVersion").jsonPrimitive.double)
        val cases = corpus.getValue("cases").jsonArray
        assertTrue(cases.isNotEmpty())
        val store = MemoryLinkCredentialsStore()
        val client = client(store)
        client.pair(pairingPayload(), "Compatibility Phone")
        for (element in cases) {
            val row = element.jsonObject
            val id = row.getValue("id").jsonPrimitive.content
            pairResponse = row.getValue("response").toString()
            val before = store.load()
            if (row.getValue("accepted").jsonPrimitive.boolean) {
                val credentials = client.pair(pairingPayload(), "Compatibility Phone")
                assertEquals("device-1", credentials.deviceId, id)
                assertEquals("host-1", credentials.hostId, id)
                assertEquals("Compatibility Host", credentials.hostName, id)
                assertEquals(row.getValue("response").jsonObject.getValue("role").jsonPrimitive.content, credentials.role, id)
                assertEquals(credentials, store.load(), id)
            } else {
                assertFailsWith<LinkClientException.BadWire>(id) { client.pair(pairingPayload(), "Compatibility Phone") }
                assertEquals(before, store.load(), id)
            }
        }
    }

    @Test
    fun authenticatedDescriptionCompatibilityPrecedesOperations() = runBlocking {
        val corpus = javaClass.getResourceAsStream("/fixtures/host-descriptions.v1.json")!!.use {
            Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject
        }
        assertEquals(1, corpus.getValue("schemaVersion").jsonPrimitive.int)
        val cases = corpus.getValue("cases").jsonArray
        assertTrue(cases.isNotEmpty())
        val operations = AtomicInteger()
        server.createContext("/api/compatibility") { exchange ->
            val body = capture(exchange)
            operations.incrementAndGet()
            respond(exchange, 200, """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":true,"value":"accepted"}}""")
        }
        server.createContext("/link/stream/compatibility") { exchange ->
            capture(exchange)
            operations.incrementAndGet()
            respond(exchange, 200, """{"k":"v","v":"accepted"}""" + "\n", contentType = "application/x-ndjson")
        }
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), "Compatibility Phone")
        val normalDescription = descriptionResponse
        for (element in cases) {
            val row = element.jsonObject
            val id = row.getValue("id").jsonPrimitive.content
            descriptionResponse = row.getValue("body").jsonPrimitive.content
            val decodes = row.getValue("decodes").jsonPrimitive.boolean
            val compatible = row.getValue("compatible").jsonPrimitive.boolean
            val before = operations.get()
            if (decodes) {
                val value = client.describe()
                assertEquals(compatible, isHostCompatible(value), id)
                if (id == "known-capability-disabled") assertFalse(value.capabilities.session.prompt)
            } else {
                assertFailsWith<LinkClientException.BadWire>(id) { client.describe() }
            }
            if (compatible) {
                assertEquals(WireValue.StringValue("accepted"), client.call("compatibility"), id)
                assertEquals(listOf(WireValue.StringValue("accepted")), client.stream("compatibility").toList(), id)
            } else if (decodes) {
                assertEquals("incompatible-host", assertFailsWith<LinkClientException.Refused>(id) { client.call("compatibility") }.code)
                assertEquals("incompatible-host", assertFailsWith<LinkClientException.Refused>(id) { client.stream("compatibility").toList() }.code)
            } else {
                assertFailsWith<LinkClientException.BadWire>(id) { client.call("compatibility") }
                assertFailsWith<LinkClientException.BadWire>(id) { client.stream("compatibility").toList() }
            }
            assertEquals(before + if (compatible) 2 else 0, operations.get(), id)
        }
        descriptionResponse = normalDescription
        assertEquals(WireValue.StringValue("accepted"), client.call("compatibility"))
    }

    private fun capture(exchange: HttpExchange): String {
        val body = exchange.requestBody.readBytes().decodeToString()
        if (exchange.requestURI.path != "/link/describe") capturedBodies.add(body)
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
    fun refusalsCarryTheFailureEnvelopeIncludingDetails() = runBlocking {
        server.createContext("/api/session/artifact") { exchange ->
            val body = capture(exchange)
            respond(
                exchange,
                200,
                """{"type":"server-response","rpcId":"${rpcId(body)}",""" +
                    """"result":{"ok":false,"error":{"code":"gateway/permission-denied",""" +
                    """"message":"interaction approval denied",""" +
                    """"details":{"endpoint":"session/artifact","requiredPermission":"interaction.answer"}}}}""",
            )
        }
        val link = client(pairedStore("http://127.0.0.1:${server.address.port}", "ab".repeat(32)))
        val failure = assertFailsWith<LinkClientException.Refused> { link.call("session/artifact") }
        assertEquals("gateway/permission-denied", failure.code)
        assertEquals("interaction approval denied", failure.envelopeMessage)
        val details = assertIs<WireValue.ObjectValue>(failure.details)
        assertEquals(WireValue.StringValue("session/artifact"), details.entries["endpoint"])
        assertEquals(WireValue.StringValue("interaction.answer"), details.entries["requiredPermission"])
    }

    @Test
    fun requestSnapshotsTrackRealOwnershipAndRetiredClients() = runBlocking {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        server.createContext("/api/session/support-check") { exchange ->
            val body = capture(exchange)
            entered.countDown()
            try {
                check(release.await(10, java.util.concurrent.TimeUnit.SECONDS))
                respond(exchange, 200, """{"type":"server-response","rpcId":"${rpcId(body)}","result":{"ok":true,"value":null}}""")
            } finally { exchange.close() }
        }
        val client = client(MemoryLinkCredentialsStore())
        assertEquals(LinkRequestSnapshot(false, 0, 0, 0), client.requestSnapshot())
        client.pair(pairingPayload(), "private-device-name")
        val wire = SwitchableWireDriving(LinkWireDriving(client))
        val request = async(Dispatchers.IO) { wire.call("session/support-check") }
        try {
            assertTrue(kotlinx.coroutines.withContext(Dispatchers.IO) { entered.await(5, java.util.concurrent.TimeUnit.SECONDS) })
            val snapshot = wire.requestSnapshot()!!
            assertEquals(1, snapshot.pendingRequests)
            assertEquals(3, snapshot.startedRequests)
        } finally {
            release.countDown()
            request.await()
            client.closeAndAwait()
        }
        assertEquals(LinkRequestSnapshot(true, 0, 3, 3), client.requestSnapshot())
        val next = client(MemoryLinkCredentialsStore())
        wire.replaceAndAwait(LinkWireDriving(next))
        assertEquals(LinkRequestSnapshot(false, 0, 0, 0), wire.requestSnapshot())
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
        assertEquals("full", description.runtimeClass)
        assertEquals(true, description.capabilities.session.follow)
        assertEquals(true, description.capabilities.interaction.approval)
        assertEquals(true, description.capabilities.interaction.question)
    }

    @Test
    fun describeRejectsMalformedBodiesAndMissingRequiredFields() = runBlocking {
        val client = client(MemoryLinkCredentialsStore())
        client.pair(pairingPayload(), "private device label")
        for (body in listOf("{private malformed response", "[]", "null", "{}", "{\"capabilities\":false}")) {
            server.removeContext("/link/describe")
            server.createContext("/link/describe") { exchange ->
                capture(exchange)
                respond(exchange, 200, body)
            }
            val failure = assertFailsWith<LinkClientException.BadWire> { client.describe() }
            assertFalse(failure.message.orEmpty().contains("private malformed response"))
        }
    }

    @Test
    fun diagnosticSnapshotsUseReadObservationsWithoutReadingIdentityStorage() = runBlocking {
        descriptionResponse = descriptionResponse.replace("\"runtimeClass\":\"full\"", "\"runtimeClass\":\"future-runtime\"")
        val backing = MemoryLinkCredentialsStore()
        var reads = 0
        val store = object : LinkCredentialsStoring by backing {
            override fun load(): LinkCredentials? { reads++; return backing.load() }
        }
        val client = client(store)
        assertEquals(LinkDescriptionState.NOT_REQUESTED, client.diagnosticSnapshot().descriptionState)
        client.pair(pairingPayload(), "private device label")
        assertEquals(LinkDeviceRole.CONTROLLER, client.diagnosticSnapshot().lastKnownRole)
        assertEquals(0, reads)
        val wire = LinkWireDriving(client)
        wire.refreshHostDescription()
        val before = reads
        val observed = wire.diagnosticSnapshot()
        assertEquals(LinkDescriptionState.AVAILABLE, observed.descriptionState)
        assertEquals(1.0, observed.description!!.contractVersion)
        assertEquals(LinkObservedRuntimeClass.UNRECOGNIZED, observed.description.runtimeClass)
        assertFalse(observed.toString().contains("Studio Desk"))
        assertFalse(observed.toString().contains("h-1"))
        assertEquals(before, reads)
        server.removeContext("/link/describe")
        server.createContext("/link/describe") { exchange -> respond(exchange, 403, """{"error":"forbidden","message":"private refusal"}""") }
        wire.refreshHostDescription()
        val refused = wire.diagnosticSnapshot()
        assertEquals(LinkDescriptionState.FAILED, refused.descriptionState)
        assertEquals(LinkDescriptionFailure.REFUSED, refused.descriptionFailure)
        assertEquals(null, refused.description)
        assertEquals(LinkDeviceRole.CONTROLLER, refused.lastKnownRole)
        assertFalse(refused.toString().contains("private refusal"))
        client.closeAndAwait()
        assertEquals(LinkDescriptionState.RETIRED, client.diagnosticSnapshot().descriptionState)
        val restored = LinkClient.restore(store, transportConfig)!!
        try {
            val count = reads
            assertEquals(LinkDeviceRole.CONTROLLER, restored.diagnosticSnapshot().lastKnownRole)
            assertEquals(LinkDescriptionState.NOT_REQUESTED, restored.diagnosticSnapshot().descriptionState)
            assertEquals(count, reads)
        } finally { restored.closeAndAwait() }
    }

    @Test
    fun anOlderDescriptionCannotReplaceTheNewerObservation() = runBlocking {
        val executor = Executors.newCachedThreadPool()
        val receiver = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        receiver.executor = executor
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val sequence = AtomicInteger()
        receiver.createContext("/link/describe") { exchange ->
            exchange.requestBody.use { it.readBytes() }
            val version = sequence.incrementAndGet()
            if (version == 1) { entered.countDown(); check(release.await(10, java.util.concurrent.TimeUnit.SECONDS)) }
            respond(exchange, 200, """{"linkProtocolVersion":1,"contractVersion":$version,"hostVersion":"test","hostId":"private","hostName":"private","runtimeClass":"full","sessionFormatVersion":0,"allowRemoteApproval":false,"capabilities":{"session":{"list":true,"history":true,"follow":true,"prompt":true,"cancel":true},"workspace":{"follow":true},"interaction":{"approval":false,"question":false}}}""")
        }
        receiver.start()
        val endpoint = "http://127.0.0.1:${receiver.address.port}"
        val client = client(endpoint, "ab".repeat(32), pairedStore(endpoint, "ab".repeat(32)))
        val first = async(Dispatchers.IO) { client.describe() }
        try {
            assertTrue(kotlinx.coroutines.withContext(Dispatchers.IO) { entered.await(5, java.util.concurrent.TimeUnit.SECONDS) })
            assertEquals(LinkDescriptionState.CHECKING, client.diagnosticSnapshot().descriptionState)
            assertEquals(2.0, client.describe().contractVersion)
            release.countDown()
            assertEquals(1.0, first.await().contractVersion)
            assertEquals(2.0, client.diagnosticSnapshot().description!!.contractVersion)
        } finally {
            release.countDown(); first.cancelAndJoin(); client.closeAndAwait()
            receiver.stop(0); executor.shutdownNow()
            assertTrue(executor.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS))
        }
    }

    @Test
    fun cancelledAndRetiredDescriptionsCannotPublishValues() = runBlocking {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        server.removeContext("/link/describe")
        server.createContext("/link/describe") { exchange ->
            exchange.requestBody.use { it.readBytes() }; entered.countDown()
            try { check(release.await(10, java.util.concurrent.TimeUnit.SECONDS)) } finally { exchange.close() }
        }
        val endpoint = "http://127.0.0.1:${server.address.port}"
        val client = client(pairedStore(endpoint, "ab".repeat(32)))
        val pending = async(Dispatchers.IO) { client.describe() }
        try {
            assertTrue(kotlinx.coroutines.withContext(Dispatchers.IO) { entered.await(5, java.util.concurrent.TimeUnit.SECONDS) })
            pending.cancelAndJoin()
            assertEquals(LinkDescriptionState.CANCELLED, client.diagnosticSnapshot().descriptionState)
            assertEquals(null, client.diagnosticSnapshot().description)
            client.closeAndAwait()
            assertEquals(LinkDescriptionState.RETIRED, client.diagnosticSnapshot().descriptionState)
            assertFailsWith<LinkClientException.Carrier> { client.describe() }
            assertEquals(LinkDescriptionState.RETIRED, client.diagnosticSnapshot().descriptionState)
        } finally { release.countDown(); pending.cancelAndJoin() }
    }

    @Test
    fun closingAnInFlightDescriptionKeepsTheRetiredObservation() = runBlocking {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        server.removeContext("/link/describe")
        server.createContext("/link/describe") { exchange ->
            exchange.requestBody.use { it.readBytes() }; entered.countDown()
            try { check(release.await(10, java.util.concurrent.TimeUnit.SECONDS)) } finally { exchange.close() }
        }
        val endpoint = "http://127.0.0.1:${server.address.port}"
        val client = client(pairedStore(endpoint, "ab".repeat(32)))
        val pending = async(Dispatchers.IO) { runCatching { client.describe() } }
        try {
            assertTrue(kotlinx.coroutines.withContext(Dispatchers.IO) { entered.await(5, java.util.concurrent.TimeUnit.SECONDS) })
            client.closeAndAwait()
            assertTrue(pending.await().exceptionOrNull() is LinkClientException.Carrier)
            val snapshot = client.diagnosticSnapshot()
            assertEquals(LinkDescriptionState.RETIRED, snapshot.descriptionState)
            assertEquals(null, snapshot.description)
            assertEquals(null, snapshot.descriptionFailure)
            assertEquals(0, snapshot.requests.pendingRequests)
        } finally { release.countDown(); pending.cancelAndJoin() }
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
        assertEquals("role", failure.code)
        val streamDetails = assertIs<WireValue.ObjectValue>(failure.details)
        assertEquals(WireValue.StringValue("observer"), streamDetails.entries["role"])
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
