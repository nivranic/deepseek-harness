package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.companion.*
import ai.deepseek.dsh.link.*
import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.io.IOException
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import kotlin.test.*

/** Controlled TLS wire fixtures exercise the Android client; these servers are not DSH Host instances. */
class NativeGatewayUploadBudgetTest {
    private data class CapturedRequest(val method: String, val body: ByteArray, val contentLength: String?) {
        val json: JsonObject get() = Json.parseToJsonElement(body.decodeToString()).jsonObject
    }

    private class Fixture(val hostId: String = "budget-host") : AutoCloseable {
        private val directory = Files.createTempDirectory("native-upload-budget")
        private val executor = Executors.newCachedThreadPool()
        private val keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        private val clients = CopyOnWriteArrayList<NativeGatewayClient>()
        val requests = CopyOnWriteArrayList<CapturedRequest>()
        @Volatile var capabilities = listOf("file-upload.stage.v1", "native-remote.http-request-budget.v1",
            "image-upload.stage.v1", "session.control.v1")
        @Volatile var budgetJson = "{\"maxRequestBodyBytes\":65536}"
        @Volatile var budgetResult = "success"
        @Volatile var uploadStatus = 200
        @Volatile var entered: CountDownLatch? = null
        @Volatile var release: CountDownLatch? = null
        @Volatile var responseFinished: CountDownLatch? = null
        val server: HttpsServer
        val credentials: LinkCredentials
        val client: NativeGatewayClient

        init {
            val password = "changeit"
            val path = directory.resolve("server.p12")
            val executable = Path.of(System.getProperty("java.home"), "bin",
                if (System.getProperty("os.name").startsWith("Windows")) "keytool.exe" else "keytool")
            val process = ProcessBuilder(executable.toString(), "-genkeypair", "-alias", "test", "-keyalg", "EC",
                "-groupname", "secp256r1", "-dname", "CN=localhost", "-validity", "1", "-storetype", "PKCS12",
                "-keystore", path.toString(), "-storepass", password, "-keypass", password, "-noprompt")
                .redirectErrorStream(true).start()
            process.inputStream.use { it.readBytes() }
            check(process.waitFor() == 0)
            val store = KeyStore.getInstance("PKCS12").apply { Files.newInputStream(path).use { load(it, password.toCharArray()) } }
            val managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(store, password.toCharArray()) }
            val tls = SSLContext.getInstance("TLS").apply { init(managers.keyManagers, null, null) }
            server = HttpsServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
                httpsConfigurator = HttpsConfigurator(tls)
                executor = this@Fixture.executor
                createContext("/api/") { exchange ->
                    val body = exchange.requestBody.use { it.readBytes() }
                    val method = exchange.requestURI.path.removePrefix("/api/")
                    val request = CapturedRequest(method, body, exchange.requestHeaders.getFirst("Content-Length"))
                    requests.add(request)
                    val isBudget = method == "nativeRemote/httpRequestBudget"
                    try {
                        if (isBudget) {
                            entered?.countDown()
                            check(release?.await(15, TimeUnit.SECONDS) != false)
                        }
                        val status = when {
                            isBudget && budgetResult == "transport" -> 503
                            method == "fileUploads/upload" -> uploadStatus
                            else -> 200
                        }
                        if (status != 200) exchange.sendResponseHeaders(status, -1)
                        else {
                            val value = when (method) {
                                "host/negotiate" -> """{"hostId":"$hostId","displayName":"Budget fixture","productVersion":"test","apiProtocolVersion":2,"runtimeMode":"full","sessionFormatVersion":0,"capabilities":${JsonArray(capabilities.map(::JsonPrimitive))}}"""
                                "nativeRemote/httpRequestBudget" -> budgetJson
                                else -> "null"
                            }
                            val result = if (isBudget && budgetResult == "refused")
                                """{"ok":false,"error":{"code":"gateway/permission-denied","message":"budget refused","details":{"scope":"view"}}}"""
                            else """{"ok":true,"value":$value}"""
                            val response = """{"type":"server-response","rpcId":${request.json.getValue("rpcId")},"result":$result}""".toByteArray(Charsets.UTF_8)
                            exchange.sendResponseHeaders(200, response.size.toLong())
                            exchange.responseBody.use { it.write(response) }
                        }
                    } catch (_: IOException) {
                        // A cancelled client closes its connection before the held budget response is released.
                    } finally {
                        exchange.close()
                        if (isBudget) responseFinished?.countDown()
                    }
                }
                start()
            }
            credentials = LinkCredentials("budget-device", hostId, "Budget fixture", "collaborator",
                "https://127.0.0.1:${server.address.port}", LinkPinning.spkiFingerprint(store.getCertificate("test") as X509Certificate),
                Base64.getEncoder().encodeToString(keys.private.encoded.takeLast(32).toByteArray()), NativeGatewayProtocol.credentialFormat)
            client = newClient()
        }

        fun newClient(): NativeGatewayClient {
            val store = object : LinkCredentialsStoring {
                override fun load() = credentials
                override fun save(credentials: LinkCredentials) = error("fixture credentials are immutable")
                override fun clear() = error("fixture credentials are immutable")
            }
            return requireNotNull(NativeGatewayClient.restore(store,
                NativeGatewayConfig(LinkTransportConfig(5000, 5000, 15000, 20000, 0, 0), 8))).also(clients::add)
        }

        fun count(method: String) = requests.count { it.method == method }
        fun upload() = requests.last { it.method == "fileUploads/upload" }
        fun image() = requests.last { it.method == "fileUploads/uploadImage" }
        fun holdBudget() { entered = CountDownLatch(1); release = CountDownLatch(1); responseFinished = CountDownLatch(1) }
        suspend fun awaitBudget() = withContext(Dispatchers.IO) { assertTrue(entered!!.await(5, TimeUnit.SECONDS)) }
        suspend fun releaseBudget() {
            release!!.countDown()
            withContext(Dispatchers.IO) { assertTrue(responseFinished!!.await(5, TimeUnit.SECONDS)) }
        }

        fun assertSigned(request: CapturedRequest) {
            assertEquals(request.body.size.toString(), request.contentLength)
            val envelope = request.json
            assertEquals("client-request", envelope.getValue("type").jsonPrimitive.content)
            assertEquals(request.method, envelope.getValue("method").jsonPrimitive.content)
            assertEquals(2, envelope.getValue("payload").jsonObject.getValue("apiProtocolVersion").jsonPrimitive.int)
            val admission = envelope.getValue("payload").jsonObject.getValue("device").jsonObject
            assertEquals(credentials.deviceId, admission.getValue("deviceId").jsonPrimitive.content)
            val signed = listOf("deviceId", "timestamp", "nonce").joinToString("\n") { admission.getValue(it).jsonPrimitive.content }
            val verifier = Signature.getInstance("Ed25519").apply { initVerify(keys.public); update(signed.toByteArray(Charsets.UTF_8)) }
            assertTrue(verifier.verify(Base64.getDecoder().decode(admission.getValue("signature").jsonPrimitive.content)))
        }

        override fun close() {
            release?.countDown()
            runBlocking { clients.forEach { it.closeAndAwait() } }
            server.stop(0)
            executor.shutdownNow()
            check(executor.awaitTermination(10, TimeUnit.SECONDS))
            directory.toFile().deleteRecursively()
        }
    }

    private fun args(name: String = "界🙂\"\\\n\t.bin", bytes: Int = 1) = mapOf(
        "agentId" to WireValue.StringValue("session"),
        "request" to WireValue.ObjectValue(mapOf("name" to WireValue.StringValue(name),
            "data" to WireValue.StringValue(Base64.getEncoder().encodeToString(ByteArray(bytes) { 7 })))),
    )

    @Test fun `each explicit upload queries a fresh budget and signs the exact UTF-8 body at the inclusive limit`() = runBlocking {
        Fixture().use { fixture ->
            val args = args()
            fixture.client.call("fileUploads/upload", args)
            val bytes = fixture.upload().body.size
            fixture.budgetJson = "{\"maxRequestBodyBytes\":$bytes,\"extension\":true}"
            fixture.client.call("fileUploads/upload", args)
            assertEquals(bytes, fixture.upload().body.size)
            assertEquals(WireValue.ObjectValue(args).toJsonElement(), fixture.upload().json.getValue("payload").jsonObject["args"])
            assertTrue(fixture.upload().body.size > fixture.upload().body.decodeToString().length)
            fixture.budgetJson = "{\"maxRequestBodyBytes\":${bytes - 1}}"
            val failure = assertFailsWith<NativeHttpRequestTooLarge> { fixture.client.call("fileUploads/upload", args) }
            assertEquals(bytes.toLong(), failure.actualBodyBytes)
            assertEquals(bytes - 1L, failure.maxRequestBodyBytes)
            assertEquals(3, fixture.count("nativeRemote/httpRequestBudget"))
            assertEquals(2, fixture.count("fileUploads/upload"))
            assertEquals(6, fixture.client.diagnosticSnapshot().value.startedHttpCalls)
            fixture.requests.forEach(fixture::assertSigned)
            val admissions = fixture.requests.map { it.json.getValue("payload").jsonObject.getValue("device").jsonObject }
            assertEquals(admissions.size, admissions.map { it.getValue("nonce") }.toSet().size)
        }
    }

    @Test fun `arguments below 2048 bytes still reject when the complete request exceeds the discovered budget`() = runBlocking {
        Fixture().use { fixture ->
            val args = args(bytes = 1280)
            val argsBytes = WireValue.ObjectValue(args).toJsonElement().toString().toByteArray(Charsets.UTF_8).size
            assertTrue(argsBytes <= 2048)
            fixture.budgetJson = "{\"maxRequestBodyBytes\":2048}"
            val failure = assertFailsWith<NativeHttpRequestTooLarge> { fixture.client.call("fileUploads/upload", args) }
            assertTrue(failure.actualBodyBytes > 2048)
            assertEquals(2048L, failure.maxRequestBodyBytes)
            assertEquals(listOf("host/negotiate", "nativeRemote/httpRequestBudget"), fixture.requests.map { it.method })
            assertEquals(2, fixture.client.diagnosticSnapshot().value.startedHttpCalls)
        }
    }

    @Test fun `missing or unknown budget capabilities prevent queries and file POSTs through direct wire calls`() = runBlocking {
        Fixture().use { fixture ->
            for (capabilities in listOf(listOf("file-upload.stage.v1"),
                listOf("file-upload.stage.v1", "native-remote.http-request-budget.v2"))) {
                fixture.capabilities = capabilities
                fixture.client.describe()
                val failure = assertFailsWith<LinkClientException.Refused> { fixture.client.call("fileUploads/upload", args()) }
                assertEquals("host/capability-unavailable", failure.code)
                assertEquals(WireValue.ObjectValue(mapOf("capability" to WireValue.StringValue("native-remote.http-request-budget.v1"))), failure.details)
            }
            assertEquals(2, fixture.requests.size)
            assertEquals(0, fixture.count("nativeRemote/httpRequestBudget"))
            assertEquals(0, fixture.count("fileUploads/upload"))
        }
    }

    @Test fun `malformed refused and unavailable budget replies never reuse an earlier allowance`() = runBlocking {
        Fixture().use { fixture ->
            fixture.client.call("fileUploads/upload", args())
            for (invalid in listOf("{}", "null", "{\"maxRequestBodyBytes\":\"2048\"}",
                "{\"maxRequestBodyBytes\":1.5}", "{\"maxRequestBodyBytes\":0}", "{\"maxRequestBodyBytes\":9007199254740992}")) {
                fixture.budgetJson = invalid
                assertFailsWith<LinkClientException.BadWire> { fixture.client.call("fileUploads/upload", args()) }
            }
            fixture.budgetResult = "refused"
            val refused = assertFailsWith<LinkClientException.Refused> { fixture.client.call("fileUploads/upload", args()) }
            assertEquals("gateway/permission-denied", refused.code)
            assertEquals(WireValue.ObjectValue(mapOf("scope" to WireValue.StringValue("view"))), refused.details)
            fixture.budgetResult = "transport"
            assertEquals(503, assertFailsWith<LinkClientException.Carrier> { fixture.client.call("fileUploads/upload", args()) }.status)
            assertEquals(9, fixture.count("nativeRemote/httpRequestBudget"))
            assertEquals(1, fixture.count("fileUploads/upload"))
        }
    }

    @Test fun `prompt operations do not query the upload budget and a Host upload refusal is not retried`() = runBlocking {
        Fixture().use { fixture ->
            fixture.capabilities = listOf("file-upload.stage.v1", "native-remote.http-request-budget.v1", "session.control.v1")
            fixture.client.describe()
            fixture.client.call("session/prompt", mapOf("text" to WireValue.StringValue("旧".repeat(700))))
            assertEquals(0, fixture.count("nativeRemote/httpRequestBudget"))
            fixture.uploadStatus = 413
            assertEquals(413, assertFailsWith<LinkClientException.Carrier> { fixture.client.call("fileUploads/upload", args()) }.status)
            assertEquals(1, fixture.count("nativeRemote/httpRequestBudget"))
            assertEquals(1, fixture.count("fileUploads/upload"))
        }
    }

    @Test fun `each explicit image upload queries a fresh budget and rejects the complete body over it before the POST`() = runBlocking {
        Fixture().use { fixture ->
            fixture.capabilities = listOf("image-upload.stage.v1", "native-remote.http-request-budget.v1", "session.control.v1")
            fixture.client.call("fileUploads/uploadImage", args())
            val bytes = fixture.image().body.size
            fixture.budgetJson = "{\"maxRequestBodyBytes\":$bytes,\"extension\":true}"
            fixture.client.call("fileUploads/uploadImage", args())
            assertEquals(bytes, fixture.image().body.size)
            assertEquals(WireValue.ObjectValue(args()).toJsonElement(), fixture.image().json.getValue("payload").jsonObject["args"])
            fixture.budgetJson = "{\"maxRequestBodyBytes\":${bytes - 1}}"
            val failure = assertFailsWith<NativeHttpRequestTooLarge> { fixture.client.call("fileUploads/uploadImage", args()) }
            assertEquals(bytes.toLong(), failure.actualBodyBytes)
            assertEquals(bytes - 1L, failure.maxRequestBodyBytes)
            assertEquals(3, fixture.count("nativeRemote/httpRequestBudget"))
            assertEquals(2, fixture.count("fileUploads/uploadImage"))
            assertEquals(0, fixture.count("fileUploads/upload"))
            fixture.requests.forEach(fixture::assertSigned)
        }
    }

    @Test fun `image uploads without the budget capability are blocked instead of falling back to an unbounded body`() = runBlocking {
        Fixture().use { fixture ->
            fixture.capabilities = listOf("image-upload.stage.v1", "session.control.v1")
            fixture.client.describe()
            val failure = assertFailsWith<LinkClientException.Refused> { fixture.client.call("fileUploads/uploadImage", args()) }
            assertEquals("host/capability-unavailable", failure.code)
            assertEquals(WireValue.ObjectValue(mapOf("capability" to WireValue.StringValue("native-remote.http-request-budget.v1"))), failure.details)
            assertEquals(1, fixture.requests.size)
            assertEquals(0, fixture.count("nativeRemote/httpRequestBudget"))
            assertEquals(0, fixture.count("fileUploads/uploadImage"))
        }
    }

    @Test fun `cancelled budget queries settle without sending their waiting file`() = runBlocking {
        Fixture().use { fixture ->
            fixture.client.describe()
            fixture.holdBudget()
            val upload = launch { fixture.client.call("fileUploads/upload", args()) }
            fixture.awaitBudget()
            upload.cancelAndJoin()
            fixture.client.closeAndAwait()
            fixture.releaseBudget()
            val snapshot = fixture.client.diagnosticSnapshot().value
            assertTrue(snapshot.closed)
            assertEquals(0, snapshot.pendingHttpCallbacks)
            assertEquals(snapshot.startedHttpCalls, snapshot.finishedHttpCalls)
            assertEquals(0, fixture.count("fileUploads/upload"))
        }
    }

    @Test fun `public Host selection retires a held budget query before using the other Host allowance`() = runBlocking {
        Fixture("host-a").use { a -> Fixture("host-b").use { b ->
            val store = object : NativeHostStoring {
                var value = NativeHostCatalog()
                override fun load() = value
                override fun save(catalog: NativeHostCatalog) { value = catalog }
                override fun preserveAndStartFresh() = error("no damaged catalog")
            }
            var activeA = a.client
            val controller = CompanionHostController(store, { credentials ->
                when (credentials.hostId) {
                    a.hostId -> a.newClient().also { activeA = it }
                    b.hostId -> b.newClient()
                    else -> error("unexpected fixture Host")
                }
            }, { CompanionInputState.memory() })
            try {
                controller.restore()
                a.client.describe(); controller.remember(a.credentials, a.client)
                b.client.describe(); controller.remember(b.credentials, b.client)
                controller.select(nativeHostKey(a.credentials))
                controller.wire.call("fileUploads/upload", args())
                a.holdBudget()
                val oldUpload = async { runCatching { controller.wire.call("fileUploads/upload", args()) } }
                a.awaitBudget()
                controller.select(nativeHostKey(b.credentials))
                assertEquals(NativeHostStatus.READY, controller.state.value.status)
                assertEquals(b.hostId, controller.state.value.selected!!.hostId)
                assertTrue(oldUpload.await().isFailure)
                val retired = activeA.diagnosticSnapshot().value
                assertTrue(retired.closed)
                assertEquals(0, retired.pendingHttpCallbacks)
                assertEquals(retired.startedHttpCalls, retired.finishedHttpCalls)
                a.releaseBudget()
                b.budgetJson = "{\"maxRequestBodyBytes\":128}"
                assertFailsWith<NativeHttpRequestTooLarge> { controller.wire.call("fileUploads/upload", args()) }
                assertEquals(1, a.count("fileUploads/upload"))
                assertEquals(1, b.count("nativeRemote/httpRequestBudget"))
                assertEquals(0, b.count("fileUploads/upload"))
                b.budgetJson = "{\"maxRequestBodyBytes\":65536}"
                controller.wire.call("fileUploads/upload", args())
                assertEquals(2, b.count("nativeRemote/httpRequestBudget"))
                assertEquals(1, b.count("fileUploads/upload"))
                assertEquals(b.hostId, controller.state.value.selected!!.hostId)
                assertEquals(2, store.value.hosts.size)
            } finally { controller.closeAndAwait() }
        } }
    }
}
