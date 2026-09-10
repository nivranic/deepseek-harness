package ai.deepseek.dsh.companion

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject

/** Exercises the installed APK's verified JNI library with exact admission and real random credential rejection. */
class SupportExportNativeTest {
    private val policy = SupportExportPolicy(1024 * 1024, 10_000)

    @Test fun installedScannerAdmitsExactBytesAndRefusesCredentials() = runBlocking(Dispatchers.IO) {
        val scanner = AndroidSupportScanner(InstrumentationRegistry.getInstrumentation().targetContext)
        val identity = scanner.identity()
        assertEquals("8.30.1", identity.version)
        assertTrue(Regex("[a-f0-9]{64}").matches(identity.rulesDigest))
        val input = "{\"platform\":\"android\",\"complete\":false}\n".toByteArray()
        val operation = scanner.open(input, policy)
        val expected = input.copyOf()
        input[0] = 0
        val result = operation.run()
        operation.cancelAndJoin()
        assertEquals("approved", result.status)
        assertArrayEquals(expected, result.bytes)
        val secret = "GITHUB_TOKEN=" + "ghp_" + ByteArray(18).also { SecureRandom().nextBytes(it) }
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val contaminated = scanner.open(secret.toByteArray(), policy)
        val rejected = contaminated.run()
        contaminated.cancelAndJoin()
        assertEquals("secrets-detected", rejected.status)
        assertTrue(rejected.bytes?.isEmpty() != false)
        assertEquals("", rejected.digest)
        val cancelled = scanner.open(expected, policy)
        cancelled.cancelAndJoin()
        assertEquals("cancelled", cancelled.run().status)
    }

    @Test fun installedExporterProducesACompleteScannedDocument() = runBlocking(Dispatchers.IO) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val scanner = AndroidSupportScanner(context)
        val document = SupportDocumentExporter(scanner, policy).prepare(
            SupportProductIdentity("0.1.2-alpha.1", 1, "dev"), SupportLocalSnapshot(false, null, ConnectionSnapshots.unavailable),
        )
        assertTrue(document.copyBytes().decodeToString().contains("\"restored\":false"))
        val copy = document.copyBytes(); copy[0] = 0
        assertNotEquals(0.toByte(), document.copyBytes()[0])
        val identity = scanner.identity()
        val digest = MessageDigest.getInstance("SHA-256")
        File(context.applicationInfo.sourceDir).inputStream().use { input ->
            val buffer = ByteArray(65536)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        val proof = JSONObject().put("schemaVersion", 1)
            .put("apkSha256", digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) })
            .put("scanner", JSONObject().put("version", identity.version).put("rulesDigest", identity.rulesDigest)
                .put("sourceSha", identity.sourceSha).put("nativeSha256", identity.nativeSha256))
        File(context.cacheDir, "support-scanner-identity.json").writeText(proof.toString() + "\n", Charsets.UTF_8)
    }
}
