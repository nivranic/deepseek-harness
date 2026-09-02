package ai.deepseek.dsh.link

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import java.io.ByteArrayInputStream
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** SPKI pinning over a real certificate: the leaf fingerprint is SHA-256 of
 * the public key's SubjectPublicKeyInfo DER, exactly compared. */
class LinkPinningTest {
    private val transportConfig = LinkTransportConfig(
        connectTimeoutMillis = 5_000,
        writeTimeoutMillis = 5_000,
        unaryReadTimeoutMillis = 5_000,
        unaryCallTimeoutMillis = 10_000,
        streamReadTimeoutMillis = 0,
        streamCallTimeoutMillis = 0,
    )

    private fun fixtureCertificate(): java.security.cert.X509Certificate {
        val der = javaClass.getResourceAsStream("/certificates/pin-fixture.der")!!.readBytes()
        return CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as java.security.cert.X509Certificate
    }

    @Test
    fun fingerprintIsSha256OfTheLeafSpkiDer() {
        val certificate = fixtureCertificate()
        assertEquals(
            LinkSigning.sha256Hex(certificate.publicKey.encoded),
            LinkPinning.spkiFingerprint(certificate),
        )
    }

    @Test
    fun checkAcceptsThePinnedFingerprintAndRejectsAnyOther() {
        val certificate = fixtureCertificate()
        val pinned = LinkPinning.spkiFingerprint(certificate)
        LinkPinning.check(certificate, pinned)

        val other = "ab".repeat(32)
        val failure = assertFailsWith<LinkPinning.PinFailure.FingerprintMismatch> { LinkPinning.check(certificate, other) }
        assertEquals(other, failure.pinned)
        assertEquals(pinned, failure.presented)
    }

    @Test
    fun clientTransportAcceptsTheRightPinAndRejectsTheWrongPinBeforeRequestBytes() = runBlocking {
        val directory = Files.createTempDirectory("link-tls")
        val password = "changeit".toCharArray()
        val keyStorePath = directory.resolve("server.p12")
        generateKeyStore(keyStorePath, String(password))
        val keyStore = KeyStore.getInstance("PKCS12").apply {
            Files.newInputStream(keyStorePath).use { load(it, password) }
        }
        val certificate = keyStore.getCertificate("link-test") as X509Certificate
        val keyManager = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
            init(keyStore, password)
        }
        val serverContext = SSLContext.getInstance("TLS").apply {
            init(keyManager.keyManagers, null, null)
        }
        val requests = AtomicInteger()
        val server = HttpsServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            httpsConfigurator = HttpsConfigurator(serverContext)
            createContext("/link/describe") { exchange ->
                exchange.requestBody.use { it.readBytes() }
                requests.incrementAndGet()
                val body = """{"linkProtocolVersion":1,"contractVersion":1,"hostVersion":"test","hostId":"h1","hostName":"TLS Host","runtimeClass":"node","sessionFormatVersion":0,"allowRemoteApproval":false,"capabilities":{"session":{"list":true,"history":true,"follow":true,"prompt":true,"cancel":true},"workspace":{"follow":true},"interaction":{"approval":true,"question":true}}}"""
                val bytes = body.toByteArray(Charsets.UTF_8)
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
                exchange.close()
            }
            start()
        }
        try {
            val endpoint = "https://127.0.0.1:${server.address.port}"
            val rightPin = LinkPinning.spkiFingerprint(certificate)
            LinkClient(endpoint, rightPin, credentialsStore(endpoint, rightPin), transportConfig).use { right ->
                assertEquals("TLS Host", right.describe().hostName)
                assertEquals(1, requests.get())
            }

            val wrongPin = "ab".repeat(32).takeUnless { it == rightPin } ?: "cd".repeat(32)
            LinkClient(endpoint, wrongPin, credentialsStore(endpoint, wrongPin), transportConfig).use { wrong ->
                assertFailsWith<LinkClientException.Carrier> { wrong.describe() }
                assertEquals(1, requests.get(), "a rejected TLS handshake must not reach the HTTP handler")
            }
        } finally {
            server.stop(0)
            directory.toFile().deleteRecursively()
        }
    }

    private fun credentialsStore(endpoint: String, pin: String): MemoryLinkCredentialsStore {
        val key = KeyPairGenerator.getInstance("Ed25519").generateKeyPair().private.encoded
        return MemoryLinkCredentialsStore().apply {
            save(
                LinkCredentials(
                    deviceId = "d1",
                    hostId = "h1",
                    hostName = "TLS Host",
                    role = "controller",
                    endpoint = endpoint,
                    pinnedFingerprint = pin,
                    signingKeyBase64 = Base64.getEncoder().encodeToString(key.copyOfRange(key.size - 32, key.size)),
                ),
            )
        }
    }

    private fun generateKeyStore(path: Path, password: String) {
        val executable = Path.of(
            System.getProperty("java.home"),
            "bin",
            if (System.getProperty("os.name").startsWith("Windows")) "keytool.exe" else "keytool",
        )
        val process = ProcessBuilder(
            executable.toString(),
            "-genkeypair",
            "-alias", "link-test",
            "-keyalg", "EC",
            "-groupname", "secp256r1",
            "-dname", "CN=localhost",
            "-ext", "SAN=dns:localhost,ip:127.0.0.1",
            "-validity", "1",
            "-storetype", "PKCS12",
            "-keystore", path.toString(),
            "-storepass", password,
            "-keypass", password,
            "-noprompt",
        ).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        check(process.waitFor() == 0) { "keytool failed: $output" }
    }
}
