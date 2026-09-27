package ai.deepseek.dsh.companion

import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlin.test.*

private fun completeResource(bytes: ByteArray = "saved 中文".encodeToByteArray(), path: String = "folder/报告.txt") = NativeResourceState(
    NativeResourceTarget("session", path), NativeResourcePhase.READY, NativeFileDescriptor("/workspace/$path", "v1", bytes.size.toLong()),
    receivedBytes = bytes.size, content = bytes,
)

private open class SaveDestination : NativeResourceSaveDestination {
    val writes = AtomicInteger()
    val discards = AtomicInteger()
    var content: ByteArray? = null
    override fun write(bytes: ByteArray) { writes.incrementAndGet(); content = bytes.copyOf() }
    override fun discard() { discards.incrementAndGet(); content = null }
}

@OptIn(ExperimentalCoroutinesApi::class)
class NativeResourceSaveTest {
    @Test fun completeBytesAreCapturedOnceWithUnicodeFilename() = runTest {
        val bytes = "saved 中文".encodeToByteArray()
        val source = completeResource(bytes)
        val saver = NativeResourceSaver(backgroundScope) { source }
        val request = assertNotNull(saver.prepare(source))
        assertEquals("报告.txt", request.filename)
        assertEquals("text/plain", request.mediaType)
        bytes.fill(0)
        val destination = SaveDestination()
        assertEquals(NativeResourceSavePhase.SAVED, saver.save(request, destination))
        assertContentEquals("saved 中文".encodeToByteArray(), destination.content)
        assertEquals(NativeResourceSavePhase.SAVED, saver.phase.value)
        assertEquals(NativeResourceSavePhase.EXPIRED, saver.save(request, destination))
        assertEquals(1, destination.writes.get())
        assertEquals(0, destination.discards.get(), "duplicate callback deleted the accepted document")
    }

    @Test fun zeroBytesCreateAnEmptyDocument() = runTest {
        val source = completeResource(byteArrayOf())
        val saver = NativeResourceSaver(backgroundScope) { source }
        val destination = SaveDestination()
        assertEquals(NativeResourceSavePhase.SAVED, saver.save(assertNotNull(saver.prepare(source)), destination))
        assertContentEquals(byteArrayOf(), destination.content)
    }

    @Test fun partialAndFailedObservationsNeverOpenASaveSelection() = runTest {
        for (phase in NativeResourcePhase.entries.filter { it != NativeResourcePhase.READY }) {
            val source = completeResource().copy(phase = phase)
            val saver = NativeResourceSaver(backgroundScope) { source }
            assertNull(saver.prepare(source), phase.name)
            assertEquals(NativeResourceSavePhase.IDLE, saver.phase.value)
        }
    }

    @Test fun pickerCancellationConsumesTheSelectionWithoutWriting() = runTest {
        val source = completeResource()
        val saver = NativeResourceSaver(backgroundScope) { source }
        val request = assertNotNull(saver.prepare(source))
        assertNull(saver.prepare(source))
        assertEquals(NativeResourceSavePhase.CANCELLED, saver.save(request, null))
        assertEquals(NativeResourceSavePhase.CANCELLED, saver.phase.value)
        assertNotNull(saver.prepare(source))
        saver.invalidateAndAwait()
    }

    @Test fun oldPickerResultCannotConsumeTheReplacementSelection() = runTest {
        var source = completeResource()
        val saver = NativeResourceSaver(backgroundScope) { source }
        val old = assertNotNull(saver.prepare(source))
        saver.invalidate()
        source = completeResource(path = "new.bin", bytes = byteArrayOf(0, 1, 2))
        val replacement = assertNotNull(saver.prepare(source))
        assertEquals("application/octet-stream", replacement.mediaType)
        val oldDestination = SaveDestination()
        assertEquals(NativeResourceSavePhase.EXPIRED, saver.save(old, oldDestination))
        assertEquals(0, oldDestination.writes.get())
        assertEquals(1, oldDestination.discards.get())
        assertEquals(NativeResourceSavePhase.CHOOSING, saver.phase.value)
        val destination = SaveDestination()
        assertEquals(NativeResourceSavePhase.SAVED, saver.save(replacement, destination))
        assertContentEquals(byteArrayOf(0, 1, 2), destination.content)
    }

    @Test fun aWriteFailureDiscardsTheNewPartialDocument() = runTest {
        val source = completeResource()
        val saver = NativeResourceSaver(backgroundScope) { source }
        val destination = object : SaveDestination() {
            override fun write(bytes: ByteArray) { super.write(bytes.copyOf(2)); throw IOException("full") }
        }
        assertEquals(NativeResourceSavePhase.FAILED, saver.save(assertNotNull(saver.prepare(source)), destination))
        assertNull(destination.content)
        assertEquals(1, destination.discards.get())
    }

    @Test fun destinationCleanupFailureRemainsVisible() = runTest {
        val source = completeResource()
        val saver = NativeResourceSaver(backgroundScope) { source }
        val destination = object : SaveDestination() {
            override fun write(bytes: ByteArray) { throw IOException("write denied") }
            override fun discard() { throw IOException("delete denied") }
        }
        val request = assertNotNull(saver.prepare(source))
        assertEquals(NativeResourceSavePhase.CLEANUP_FAILED, saver.save(request, destination))
        assertEquals(NativeResourceSavePhase.CLEANUP_FAILED, request.result)
    }

    @Test fun retirementWaitsForWritingAndDiscardsBeforeAnotherSaveCanBegin() = runTest {
        val source = completeResource()
        val saver = NativeResourceSaver(backgroundScope) { source }
        val entered = CompletableDeferred<Unit>()
        val release = CountDownLatch(1)
        val destination = object : SaveDestination() {
            override fun write(bytes: ByteArray) { entered.complete(Unit); release.await(); super.write(bytes) }
        }
        val request = assertNotNull(saver.prepare(source))
        val saving = async { saver.save(request, destination) }
        try {
            entered.await()
            val retiring = async { saver.invalidateAndAwait() }
            runCurrent()
            assertFalse(retiring.isCompleted)
            assertEquals(NativeResourceSavePhase.RETIRING, saver.phase.value)
            assertNull(saver.prepare(source))
            release.countDown()
            retiring.await(); saving.join()
            assertTrue(saving.isCancelled)
            assertNull(destination.content)
            assertEquals(1, destination.discards.get())
            assertEquals(NativeResourceSavePhase.IDLE, saver.phase.value)
            assertNotNull(saver.prepare(source))
        } finally { release.countDown(); saver.invalidateAndAwait() }
    }

    @Test fun retiredHostRejectsLatePickerButStillCleansItsNewDocument() = runTest {
        val lifetime = SupervisorJob()
        val scope = CoroutineScope(coroutineContext + lifetime)
        val source = completeResource()
        val saver = NativeResourceSaver(scope) { source }
        val request = assertNotNull(saver.prepare(source))
        saver.invalidateAndAwait(); lifetime.cancelAndJoin()
        val destination = SaveDestination()
        assertFailsWith<CancellationException> { saver.save(request, destination) }
        assertEquals(0, destination.writes.get())
        assertEquals(1, destination.discards.get())
        assertEquals(NativeResourceSavePhase.EXPIRED, request.result)
        assertNull(saver.prepare(source))
    }

    @Test fun retiredHostStillReportsFailedDestinationCleanup() = runTest {
        val lifetime = SupervisorJob()
        val scope = CoroutineScope(coroutineContext + lifetime)
        val source = completeResource()
        val saver = NativeResourceSaver(scope) { source }
        val request = assertNotNull(saver.prepare(source))
        saver.invalidateAndAwait(); lifetime.cancelAndJoin()
        val destination = object : SaveDestination() {
            override fun discard() { throw IOException("provider refused cleanup") }
        }
        assertFailsWith<CancellationException> { saver.save(request, destination) }
        assertEquals(0, destination.writes.get())
        assertEquals(NativeResourceSavePhase.CLEANUP_FAILED, request.result)
    }

    @Test fun retirementDuringSavingPublicationPreventsTheFirstWrite() = runTest {
        val source = completeResource()
        val saver = NativeResourceSaver(backgroundScope) { source }
        val request = assertNotNull(saver.prepare(source))
        val observer = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            saver.phase.collect { if (it == NativeResourceSavePhase.SAVING) saver.invalidate() }
        }
        val destination = SaveDestination()
        assertFailsWith<CancellationException> { saver.save(request, destination) }
        assertEquals(0, destination.writes.get())
        assertEquals(1, destination.discards.get())
        observer.cancelAndJoin()
        saver.invalidateAndAwait()
    }
}
