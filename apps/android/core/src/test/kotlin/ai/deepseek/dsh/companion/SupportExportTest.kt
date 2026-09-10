package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkRequestSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SupportExportTest {
    private val identity = SupportScannerIdentity("8.30.1", "a".repeat(64), "b".repeat(40), "c".repeat(64))
    private val product = SupportProductIdentity("0.1.2-alpha.1", 1, "dev")
    private val snapshot = SupportLocalSnapshot(true, LinkRequestSnapshot(false, 2, 5, 3))
    private val policy = SupportExportPolicy(1024 * 1024, 10_000)

    @Test fun projectsLocalFactsWithoutClaimingHealthOrAuthorization() {
        val bytes = encodeSupportDocument(product, snapshot, identity, policy.maximumBytes)
        val expected = requireNotNull(javaClass.getResourceAsStream("/support-export.json")).use { it.readBytes() }
        assertContentEquals(expected, bytes)
        val value = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
        assertEquals("false", value["complete"].toString())
        assertEquals("2", value["transport"]!!.jsonObject["pendingRequests"].toString())
        assertEquals("true", value["localIdentity"]!!.jsonObject["restored"].toString())
        assertTrue(value["uncollected"].toString().contains("role"))
        assertFalse(bytes.decodeToString().contains("hostId"))
        assertTrue(bytes.last() == 10.toByte())
        val absent = Json.parseToJsonElement(encodeSupportDocument(product, SupportLocalSnapshot(false, null), identity, policy.maximumBytes).decodeToString()).jsonObject
        assertEquals("\"unavailable\"", absent["transport"]!!.jsonObject["observation"].toString())
    }

    @Test fun rejectsInvalidProductMetadataAndScannerIdentity() {
        for (version in listOf("01.2.3", "1.2", "1.2.3\nsecret", "1.2.3-01", "1.2.3+private", "1.2.3-")) {
            assertEquals(SupportExportFailure.INVALID_IDENTITY,
                assertFailsWith<SupportExportException> { SupportProductIdentity(version, 1, "dev") }.failure)
        }
        for (channel in listOf("stable", "other")) {
            assertFailsWith<SupportExportException> { SupportProductIdentity("1.2.3-alpha", 1, channel) }
        }
        assertFailsWith<SupportExportException> { SupportProductIdentity("1.2.3", 1, "beta") }
        assertFailsWith<SupportExportException> { SupportExportPolicy(0, 1) }
        assertFailsWith<SupportExportException> { encodeSupportDocument(product, snapshot, identity.copy(sourceSha = "payload"), policy.maximumBytes) }
    }

    private fun scanner(result: (ByteArray) -> SupportScanResult, cancel: () -> Unit = {}): SupportDocumentScanner =
        object : SupportDocumentScanner {
            override fun identity() = this@SupportExportTest.identity
            override fun open(document: ByteArray, policy: SupportExportPolicy): SupportScanOperation {
                val copy = document.copyOf()
                return object : SupportScanOperation {
                    override fun run() = result(copy)
                    override fun cancelAndJoin() = cancel()
                }
            }
        }

    @Test fun admitsOnlyExactBytesAndReturnsIndependentCopies() = runBlocking {
        var joined = false
        val exporter = SupportDocumentExporter(scanner({ SupportScanResult("approved", it, supportSha256(it)) }, { joined = true }), policy)
        val document = exporter.prepare(product, snapshot)
        assertTrue(joined)
        val expected = encodeSupportDocument(product, snapshot, identity, policy.maximumBytes)
        val copy = document.copyBytes(); copy[0] = 0
        assertContentEquals(expected, document.copyBytes())
        assertEquals(supportSha256(expected), document.digest)
    }

    @Test fun refusesFindingsUnknownResultsAndMismatchedAdmissionBytes() = runBlocking {
        for (status in listOf("secrets-detected", "timed-out", "cancelled", "already-run", "unexpected")) {
            val exporter = SupportDocumentExporter(scanner({ SupportScanResult(status, it, supportSha256(it)) }), policy)
            assertFailsWith<SupportExportException> { exporter.prepare(product, snapshot) }
        }
        for (changed in listOf(false, true)) {
            val exporter = SupportDocumentExporter(scanner({ SupportScanResult("approved", if (changed) byteArrayOf(0) else it, "d".repeat(64)) }), policy)
            assertEquals(SupportExportFailure.INVALID_SCANNER, assertFailsWith<SupportExportException> { exporter.prepare(product, snapshot) }.failure)
        }
        val exporter = SupportDocumentExporter(scanner({ error("must not scan oversized input") }), SupportExportPolicy(1, 10_000))
        assertEquals(SupportExportFailure.OVERSIZED, assertFailsWith<SupportExportException> { exporter.prepare(product, snapshot) }.failure)
    }

    @Test fun cancellationWaitsForNativeCompletionAndCannotDeliverBytes() = runBlocking {
        val started = CountDownLatch(1); val cancelling = CountDownLatch(1); val release = CountDownLatch(1); val stopped = CountDownLatch(1)
        val adapter = scanner({ input ->
            started.countDown()
            try { check(release.await(10, TimeUnit.SECONDS)) } finally { stopped.countDown() }
            SupportScanResult("approved", input, supportSha256(input))
        }, {
            cancelling.countDown()
            check(stopped.await(10, TimeUnit.SECONDS))
        })
        val result = async { SupportDocumentExporter(adapter, policy).prepare(product, snapshot) }
        try {
            assertTrue(withContext(Dispatchers.IO) { started.await(5, TimeUnit.SECONDS) })
            result.cancel()
            assertTrue(withContext(Dispatchers.IO) { cancelling.await(5, TimeUnit.SECONDS) })
            assertFalse(result.isCompleted)
        } finally {
            release.countDown()
            result.cancelAndJoin()
        }
        assertEquals(0L, stopped.count)
        assertTrue(result.isCancelled)
    }
}
