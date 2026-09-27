package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.companion.ConnectionFailure
import ai.deepseek.dsh.companion.SwitchableWireDriving
import ai.deepseek.dsh.link.*
import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.json.*
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import kotlin.test.*

class NativeGatewayDiagnosticsTest {
    private class Fixture : AutoCloseable {
        val directory = Files.createTempDirectory("native-diagnostics")
        val requests = AtomicInteger()
        var reads = 0
        @Volatile var result = "success"
        @Volatile var entered: CountDownLatch? = null
        @Volatile var release: CountDownLatch? = null
        val executor = Executors.newCachedThreadPool()
        val server: HttpsServer
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
                    val body = exchange.requestBody.use { it.readBytes().decodeToString() }
                    requests.incrementAndGet()
                    entered?.countDown()
                    check(release?.await(10, TimeUnit.SECONDS) != false)
                    if (exchange.requestURI.path.endsWith("remote.mux")) {
                        exchange.sendResponseHeaders(503, -1)
                        exchange.close()
                    } else {
                        val id = Json.parseToJsonElement(body).jsonObject.getValue("rpcId")
                        val response = when (result) {
                            "refused" -> """{"ok":false,"error":{"code":"gateway/permission-denied","message":"private refusal poison","details":{}}}"""
                            "invalid" -> """{"ok":true,"value":{}}"""
                            else -> """{"ok":true,"value":{"hostId":"private-host-poison","displayName":"private-label-poison","productVersion":"private-version-poison","apiProtocolVersion":2,"runtimeMode":"full","sessionFormatVersion":999,"capabilities":["session.follow.v1","private-capability-poison"]}}"""
                        }
                        val bytes = """{"type":"server-response","rpcId":$id,"result":$response}""".toByteArray()
                        try {
                            exchange.sendResponseHeaders(200, bytes.size.toLong())
                            exchange.responseBody.use { it.write(bytes) }
                        } catch (_: java.io.IOException) {
                            // Cancelled clients close the test connection before the held response is released.
                        } finally { exchange.close() }
                    }
                }
                start()
            }
            val key = KeyPairGenerator.getInstance("Ed25519").generateKeyPair().private.encoded.takeLast(32).toByteArray()
            val credentials = LinkCredentials("private-device-poison", "private-host-poison", "private-label-poison", "collaborator",
                "https://127.0.0.1:${server.address.port}", LinkPinning.spkiFingerprint(store.getCertificate("test") as X509Certificate),
                Base64.getEncoder().encodeToString(key), NativeGatewayProtocol.credentialFormat)
            val memory = object : LinkCredentialsStoring {
                override fun load(): LinkCredentials { reads++; return credentials }
                override fun save(credentials: LinkCredentials) = error("diagnostics cannot save credentials")
                override fun clear() = error("diagnostics cannot clear credentials")
            }
            client = requireNotNull(NativeGatewayClient.restore(memory,
                NativeGatewayConfig(LinkTransportConfig(5000, 5000, 15000, 20000, 0, 0), 8)))
        }

        fun hold() { entered = CountDownLatch(1); release = CountDownLatch(1) }
        suspend fun awaitRequest() = withContext(Dispatchers.IO) { assertTrue(entered!!.await(5, TimeUnit.SECONDS)) }
        override fun close() {
            release?.countDown()
            runBlocking { client.closeAndAwait() }
            server.stop(0); executor.shutdownNow()
            check(executor.awaitTermination(10, TimeUnit.SECONDS))
            directory.toFile().deleteRecursively()
        }
    }

    @Test fun `snapshot is pure and retains only allowlisted facts after failed refresh`() = runBlocking {
        Fixture().use { fixture ->
            val client = fixture.client
            val wire = SwitchableWireDriving(client)
            assertEquals(NativeDescriptionState.NOT_REQUESTED, client.diagnosticSnapshot().value.descriptionState)
            repeat(3) { wire.diagnosticSnapshot() }
            assertEquals(1, fixture.reads); assertEquals(0, fixture.requests.get())
            client.describe()
            val first = client.diagnosticSnapshot().value
            assertEquals(999, first.description!!.sessionFormatVersion)
            assertEquals(setOf(NativeObservedCapability.SESSION_FOLLOW), first.description.capabilities)
            assertEquals(NativeObservedRole.COLLABORATOR, first.lastKnownRole)
            assertFalse(first.toString().contains("poison"))
            for ((response, failure) in listOf("refused" to ConnectionFailure.REFUSED, "invalid" to ConnectionFailure.INVALID_RESPONSE)) {
                fixture.result = response
                client.refreshHostDescription()
                val failed = client.diagnosticSnapshot().value
                assertEquals(NativeDescriptionState.FAILED, failed.descriptionState)
                assertEquals(failure, failed.descriptionFailure)
                assertEquals(first.description, failed.description)
                assertFalse(failed.toString().contains("poison"))
            }
            client.closeAndAwait()
            val retired = client.diagnosticSnapshot().value
            assertEquals(NativeDescriptionState.RETIRED, retired.descriptionState)
            assertEquals(3, retired.startedHttpCalls); assertEquals(3, retired.finishedHttpCalls)
            assertEquals(0, retired.pendingHttpCallbacks)
            assertEquals(first.description, retired.description)
            assertEquals(1, fixture.reads)
            assertEquals(3, fixture.requests.get())
        }
    }

    @Test fun `cancellation records its category and late response cannot revive a retired client`() = runBlocking {
        Fixture().use { fixture ->
            fixture.hold()
            val query = launch { fixture.client.describe() }
            fixture.awaitRequest()
            val pending = fixture.client.diagnosticSnapshot().value
            assertEquals(NativeDescriptionState.CHECKING, pending.descriptionState)
            assertEquals(1, pending.pendingHttpCallbacks)
            assertEquals(1, pending.startedHttpCalls); assertEquals(0, pending.finishedHttpCalls)
            query.cancelAndJoin()
            assertEquals(NativeDescriptionState.CANCELLED, fixture.client.diagnosticSnapshot().value.descriptionState)
            assertEquals(ConnectionFailure.CANCELLED, fixture.client.diagnosticSnapshot().value.descriptionFailure)
            fixture.client.closeAndAwait()
            fixture.release!!.countDown()
            val retired = fixture.client.diagnosticSnapshot().value
            assertTrue(retired.closed)
            assertEquals(NativeDescriptionState.RETIRED, retired.descriptionState)
            assertNull(retired.description)
            assertEquals(0, retired.pendingHttpCallbacks)
            assertEquals(retired.startedHttpCalls, retired.finishedHttpCalls)
            assertFailsWith<LinkClientException.Carrier> { fixture.client.describe() }
            assertEquals(retired, fixture.client.diagnosticSnapshot().value)
        }
    }

    @Test fun `close while description waits leaves retirement authoritative`() = runBlocking {
        Fixture().use { fixture ->
            fixture.hold()
            val query = async { runCatching { fixture.client.describe() } }
            fixture.awaitRequest()
            fixture.client.closeAndAwait()
            assertTrue(query.await().isFailure)
            fixture.release!!.countDown()
            assertEquals(NativeDescriptionState.RETIRED, fixture.client.diagnosticSnapshot().value.descriptionState)
            assertNull(fixture.client.diagnosticSnapshot().value.descriptionFailure)
        }
    }

    @Test fun `registered mux subscriptions are distinct from HTTP callbacks and settle on close`() = runBlocking {
        Fixture().use { fixture ->
            fixture.client.describe()
            fixture.hold()
            val stream = async { runCatching { fixture.client.stream("session/follow").collect() } }
            fixture.awaitRequest()
            val registered = fixture.client.diagnosticSnapshot().value
            assertEquals(1, registered.registeredMuxStreams)
            assertEquals(1, registered.startedHttpCalls)
            fixture.client.closeAndAwait()
            assertTrue(stream.await().isFailure)
            val retired = fixture.client.diagnosticSnapshot().value
            assertEquals(0, retired.registeredMuxStreams); assertEquals(0, retired.retiringMuxes)
            assertEquals(0, retired.pendingHttpCallbacks); assertEquals(1, retired.finishedHttpCalls)
            fixture.release!!.countDown()
        }
    }
}
