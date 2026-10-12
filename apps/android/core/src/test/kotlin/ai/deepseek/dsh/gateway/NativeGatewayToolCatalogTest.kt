package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolRisk
import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.LinkCredentials
import ai.deepseek.dsh.link.LinkCredentialsStoring
import ai.deepseek.dsh.link.LinkPinning
import ai.deepseek.dsh.link.LinkTransportConfig
import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The tools/list catalog fetch over a controlled TLS wire; these servers are not DSH Host instances. */
class NativeGatewayToolCatalogTest {
    private class Fixture : AutoCloseable {
        private val directory = Files.createTempDirectory("native-tool-catalog")
        private val executor = Executors.newCachedThreadPool()
        val methods = CopyOnWriteArrayList<String>()
        @Volatile var capabilities = listOf("session.follow.v1", "tool.catalog.v1")
        @Volatile var toolsJson =
            """{"tools":[{"id":"web_search","version":1,"risk":"low","permissions":["net.search"],"supportsLite":true,"supportsRemote":true}]}"""
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
                    val method = exchange.requestURI.path.removePrefix("/api/")
                    methods.add(method)
                    val value = when (method) {
                        "host/negotiate" -> """{"hostId":"catalog-host","displayName":"Catalog fixture","productVersion":"test",""" +
                            """"apiProtocolVersion":2,"runtimeMode":"full","sessionFormatVersion":0,"capabilities":${JsonArray(capabilities.map(::JsonPrimitive))}}"""
                        "tools/list" -> toolsJson
                        else -> "null"
                    }
                    val id = Json.parseToJsonElement(body).jsonObject.getValue("rpcId")
                    val response = """{"type":"server-response","rpcId":$id,"result":{"ok":true,"value":$value}}"""
                        .toByteArray(Charsets.UTF_8)
                    try {
                        exchange.sendResponseHeaders(200, response.size.toLong())
                        exchange.responseBody.use { it.write(response) }
                    } finally { exchange.close() }
                }
                start()
            }
            val key = KeyPairGenerator.getInstance("Ed25519").generateKeyPair().private.encoded.takeLast(32).toByteArray()
            val credentials = LinkCredentials("catalog-device", "catalog-host", "Catalog fixture", "collaborator",
                "https://127.0.0.1:${server.address.port}", LinkPinning.spkiFingerprint(store.getCertificate("test") as X509Certificate),
                Base64.getEncoder().encodeToString(key), NativeGatewayProtocol.credentialFormat)
            val memory = object : LinkCredentialsStoring {
                override fun load(): LinkCredentials = credentials
                override fun save(credentials: LinkCredentials) = error("catalog fixture credentials are immutable")
                override fun clear() = error("catalog fixture credentials are immutable")
            }
            client = requireNotNull(NativeGatewayClient.restore(memory,
                NativeGatewayConfig(LinkTransportConfig(5000, 5000, 15000, 20000, 0, 0), 8)))
        }

        fun count(method: String): Int = methods.count { it == method }

        override fun close() {
            runBlocking { client.closeAndAwait() }
            server.stop(0)
            executor.shutdownNow()
            check(executor.awaitTermination(10, TimeUnit.SECONDS))
            directory.toFile().deleteRecursively()
        }
    }

    @Test
    fun `a Host without the tool catalog capability serves no declaration and stays on the fallback path`() = runBlocking {
        Fixture().use { fixture ->
            fixture.capabilities = listOf("session.follow.v1")
            fixture.client.describe()
            assertNull(fixture.client.toolDescriptors())
            assertEquals(listOf("host/negotiate"), fixture.methods)
        }
    }

    @Test
    fun `tools list parses caches per negotiation and refetches after renegotiation`() = runBlocking {
        Fixture().use { fixture ->
            val expected = listOf(ToolDescriptor("web_search", 1, ToolRisk.LOW, listOf("net.search"), true, true))
            val first = fixture.client.toolDescriptors()
            assertEquals(expected, first)
            assertEquals(1, fixture.count("tools/list"))
            // The cache serves the second read without a new HTTP call.
            assertEquals(first, fixture.client.toolDescriptors())
            assertEquals(1, fixture.count("tools/list"))
            // A renegotiation retires the cached declaration.
            fixture.toolsJson = """{"tools":[]}"""
            fixture.client.describe()
            assertEquals(emptyList(), fixture.client.toolDescriptors())
            assertEquals(2, fixture.count("tools/list"))
        }
    }

    @Test
    fun `a malformed catalog reply fails loud as bad wire and caches nothing`() = runBlocking {
        Fixture().use { fixture ->
            fixture.toolsJson = """{"tools":[{"id":"web_search","version":0}]}"""
            val failure = assertFailsWith<LinkClientException.BadWire> { fixture.client.toolDescriptors() }
            assertTrue(failure.message!!.contains("invalid tool catalog"), failure.message)
            // The failed fetch cached nothing; a later well-formed reply parses.
            fixture.toolsJson =
                """{"tools":[{"id":"web_search","version":1,"risk":"low","permissions":[],"supportsLite":false,"supportsRemote":true}]}"""
            assertEquals(1, fixture.client.toolDescriptors()!!.size)
        }
    }

    @Test
    fun `generic wire calls gate tools list on the advertised capability`() = runBlocking {
        Fixture().use { fixture ->
            fixture.capabilities = listOf("session.follow.v1")
            fixture.client.describe()
            val failure = assertFailsWith<LinkClientException.Refused> { fixture.client.call("tools/list") }
            assertEquals("host/capability-unavailable", failure.code)
            assertEquals(0, fixture.count("tools/list"))
            fixture.capabilities = listOf("session.follow.v1", "tool.catalog.v1")
            fixture.client.refreshHostDescription()
            fixture.client.call("tools/list")
            assertEquals(1, fixture.count("tools/list"))
        }
    }
}
