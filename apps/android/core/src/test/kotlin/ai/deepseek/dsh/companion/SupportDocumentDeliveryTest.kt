package ai.deepseek.dsh.companion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SupportDocumentDeliveryTest {
    private val bytes = "{\"complete\":false}\n".toByteArray()
    private fun document() = ApprovedSupportDocument.admitted(bytes, SupportScanResult("approved", bytes, supportSha256(bytes)))

    @Test fun writesExactApprovedBytesWithoutDiscardingSuccessfulDelivery() = runBlocking {
        var written: ByteArray? = null
        var discarded = false
        deliverSupportDocument(document(), object : SupportSaveDestination {
            override fun write(bytes: ByteArray) { written = bytes }
            override fun discard() { discarded = true }
        })
        assertContentEquals(bytes, written)
        assertFalse(discarded)
    }

    @Test fun writeAndCleanupFailuresRemainFixedRefusals() = runBlocking {
        for (cleanupFails in listOf(false, true)) {
            var discarded = false
            val failure = assertFailsWith<SupportExportException> {
                deliverSupportDocument(document(), object : SupportSaveDestination {
                    override fun write(bytes: ByteArray) { error("private provider error") }
                    override fun discard() {
                        discarded = true
                        if (cleanupFails) error("private cleanup error")
                    }
                })
            }
            assertTrue(discarded)
            assertEquals(SupportExportFailure.SAVE_FAILED, failure.failure)
            assertEquals("SAVE_FAILED", failure.message)
        }
    }

    @Test fun cancellationJoinsWritingBeforeDiscardingTheNewDocument() = runBlocking {
        val started = CountDownLatch(1); val release = CountDownLatch(1); val discarded = CountDownLatch(1)
        var finishedWriting = false
        val writing = async {
            deliverSupportDocument(document(), object : SupportSaveDestination {
                override fun write(bytes: ByteArray) {
                    started.countDown()
                    check(release.await(10, TimeUnit.SECONDS))
                    finishedWriting = true
                }
                override fun discard() {
                    check(finishedWriting)
                    discarded.countDown()
                }
            })
        }
        try {
            assertTrue(withContext(Dispatchers.IO) { started.await(5, TimeUnit.SECONDS) })
            writing.cancel()
            assertFalse(writing.isCompleted)
            assertEquals(1L, discarded.count)
        } finally {
            release.countDown()
            writing.cancelAndJoin()
        }
        assertTrue(finishedWriting)
        assertEquals(0L, discarded.count)
        assertTrue(writing.isCancelled)
    }
}
