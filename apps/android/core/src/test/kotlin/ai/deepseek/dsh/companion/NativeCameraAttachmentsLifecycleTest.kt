package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeCameraAttachmentsLifecycleTest {
    private val limits = NativeFileAttachmentLimits(4, 4096, 8)
    private fun value(text: String) = WireValue.fromJsonElement(Json.parseToJsonElement(text))
    private fun receipt() = value("""{"receiptId":"camera","image":{"attachmentId":"image","mediaType":"image/jpeg","bytes":1,"width":1,"height":1}}""")
    private fun source() = object : NativeFileAttachmentSource {
        override fun name() = "capture.jpg"
        override fun mediaType() = "image/jpeg"
        override fun open() = ByteArrayInputStream(byteArrayOf(7))
    }

    @Test fun `cancel waits for stream close and cleanup while every prompt and attachment entry remains excluded`() = runTest {
        val wire = FakeWire().apply { stub("session/prompt") { value("""{"accepted":true}""") } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val draft = SessionDraft("retained", "request")
        inputs.update { it.copy(drafts = mapOf("session" to draft), pendingPrompts = mapOf("request" to PendingPrompt("session", draft))) }
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, limits)
        val reading = CompletableDeferred<Unit>(); val releaseRead = CountDownLatch(1)
        val cleaning = CompletableDeferred<Unit>(); val releaseCleanup = CountDownLatch(1)
        val closes = AtomicInteger(); val cleanups = AtomicInteger()
        val selected = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE) {
            assertEquals(1, closes.get())
            cleanups.incrementAndGet(); cleaning.complete(Unit)
            check(releaseCleanup.await(10, TimeUnit.SECONDS))
        })
        val blocked = object : NativeFileAttachmentSource {
            override fun name() = "capture.jpg"
            override fun mediaType() = "image/jpeg"
            override fun open() = object : ByteArrayInputStream(byteArrayOf(7)) {
                override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                    reading.complete(Unit); check(releaseRead.await(10, TimeUnit.SECONDS))
                    return super.read(bytes, offset, length)
                }
                override fun close() { closes.incrementAndGet(); super.close() }
            }
        }
        try {
            model.accept(selected, blocked); reading.await()
            val cancelling = async { model.cancelAndAwait() }; runCurrent()
            assertFalse(cancelling.isCompleted); assertEquals(0, cleanups.get()); assertEquals(0, closes.get())
            releaseRead.countDown(); cleaning.await()
            assertEquals(NativeFileAttachmentPhase.CLEANING, model.state.value.phase)
            assertFalse(cancelling.isCompleted); assertFalse(selected.released.isCompleted)
            assertNull(model.prepare()); assertNull(model.prepare(NativeAttachmentKind.IMAGE))
            assertFalse(session.sendDraft()); session.submitDraft().join(); session.retryPrompt("request").join()
            assertTrue(wire.calls.isEmpty())
            releaseCleanup.countDown(); cancelling.await(); selected.awaitReleased()
            assertEquals(1, cleanups.get()); assertEquals(1, closes.get())
            assertTrue(session.sendDraft()); assertEquals(listOf("session/prompt"), wire.calls.map { it.first })
        } finally { releaseRead.countDown(); releaseCleanup.countDown(); model.closeAndAwait() }
    }

    @Test fun `Host close waits for upload completion before running and awaiting owned output cleanup`() = runTest {
        val uploading = CompletableDeferred<Unit>(); val releaseUpload = CompletableDeferred<Unit>()
        val cleaning = CompletableDeferred<Unit>(); val releaseCleanup = CountDownLatch(1)
        val cleanups = AtomicInteger()
        val wire = FakeWire().apply { stub("fileUploads/uploadImage") {
            uploading.complete(Unit); withContext(NonCancellable) { releaseUpload.await() }; receipt()
        } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, limits)
        val selected = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE) {
            cleanups.incrementAndGet(); cleaning.complete(Unit); check(releaseCleanup.await(10, TimeUnit.SECONDS))
        })
        try {
            model.accept(selected, source()); uploading.await()
            val closing = model.close(); runCurrent()
            assertFalse(closing.isCompleted); assertEquals(0, cleanups.get())
            releaseUpload.complete(Unit); cleaning.await()
            assertFalse(closing.isCompleted); assertFalse(selected.released.isCompleted)
            releaseCleanup.countDown(); closing.await(); selected.awaitReleased()
            assertEquals(1, cleanups.get()); assertTrue(inputs.state.value.drafts.isEmpty()); assertNull(model.prepare())
        } finally { releaseUpload.complete(Unit); releaseCleanup.countDown(); model.closeAndAwait() }
    }

    @Test fun `successful image receipt cannot be submitted until its owned output cleanup finishes`() = runTest {
        val wire = FakeWire().apply {
            stub("fileUploads/uploadImage") { receipt() }
            stub("session/prompt") { value("""{"accepted":true}""") }
        }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, limits)
        val cleaning = CompletableDeferred<Unit>(); val release = CountDownLatch(1)
        val selected = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE) {
            cleaning.complete(Unit); check(release.await(10, TimeUnit.SECONDS))
        })
        try {
            val upload = model.accept(selected, source()); cleaning.await()
            assertEquals(1, inputs.state.value.drafts.getValue("session").attachments.size)
            assertFalse(upload.isCompleted); assertFalse(session.sendDraft()); assertNull(model.prepare())
            release.countDown(); upload.join(); selected.awaitReleased()
            assertTrue(session.sendDraft()); assertEquals(1, wire.calls.count { it.first == "session/prompt" })
        } finally { release.countDown(); model.closeAndAwait() }
    }

    @Test fun `parent cancellation before upload starts still finalizes exactly once without opening a source`() = runTest {
        val wire = FakeWire(); val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val parent = SupervisorJob(backgroundScope.coroutineContext[Job])
        val model = NativeFileAttachmentsModel(wire, session, inputs, CoroutineScope(backgroundScope.coroutineContext + parent),
            limits, StandardTestDispatcher(testScheduler))
        var cleanups = 0; var opens = 0
        val selected = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE) { cleanups++ })
        val untouched = object : NativeFileAttachmentSource {
            override fun name() = "capture.jpg"
            override fun mediaType() = "image/jpeg"
            override fun open(): ByteArrayInputStream { opens++; return ByteArrayInputStream(byteArrayOf(7)) }
        }
        model.accept(selected, untouched); parent.cancelAndJoin(); selected.awaitReleased()
        model.cancelSelection(selected); model.accept(selected, untouched).join(); model.closeAndAwait()
        assertEquals(1, cleanups); assertEquals(0, opens); assertTrue(wire.calls.isEmpty())
        val replacement = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, limits, StandardTestDispatcher(testScheduler))
        val next = assertNotNull(replacement.prepare()); replacement.cancelSelection(next); replacement.closeAndAwait()
    }

    @Test fun `cleanup failure is visible and releases admission after a cancelled picker`() = runTest {
        val wire = FakeWire().apply { stub("session/prompt") { value("""{"accepted":true}""") } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session"); session.updateDraft("session", "send")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, limits, StandardTestDispatcher(testScheduler))
        var cleanups = 0
        val selected = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE) { cleanups++; throw IOException("owned cleanup failed") })
        model.cancelSelection(selected); selected.awaitReleased()
        assertTrue(selected.cleanupFailed); assertEquals(NativeFileAttachmentIssue.CLEANUP_FAILED, model.state.value.issue)
        assertEquals(NativeFileAttachmentPhase.FAILED, model.state.value.phase)
        val next = assertNotNull(model.prepare()); model.cancelSelection(next)
        assertTrue(session.sendDraft()); model.closeAndAwait(); assertEquals(1, cleanups)
    }
}
