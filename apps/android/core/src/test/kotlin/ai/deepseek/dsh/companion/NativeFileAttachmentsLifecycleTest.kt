package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeFileAttachmentsLifecycleTest {
    private val limits = NativeFileAttachmentLimits(4, 4096, 2)
    private fun receipt() = WireValue.fromJsonElement(Json.parseToJsonElement(
        """{"receiptId":"receipt","file":{"attachmentId":"attachment","name":"file.bin","bytes":1}}"""))
    private fun source() = object : NativeFileAttachmentSource {
        override fun name() = "file.bin"
        override fun open(): InputStream = ByteArrayInputStream(byteArrayOf(7))
    }

    @Test fun `Host retirement waits for a blocked provider read and closes its stream once`() = runTest {
        val entered = CompletableDeferred<Unit>()
        val release = CountDownLatch(1)
        val opens = AtomicInteger()
        val closes = AtomicInteger()
        val source = object : NativeFileAttachmentSource {
            override fun name() = "file.bin"
            override fun open(): InputStream {
                opens.incrementAndGet()
                return object : InputStream() {
                    override fun read(): Int = error("bulk reads required")
                    override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                        entered.complete(Unit)
                        release.await()
                        bytes[offset] = 7
                        return 1
                    }
                    override fun close() { closes.incrementAndGet() }
                }
            }
        }
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs)
        session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, limits)
        try {
            model.accept(assertNotNull(model.prepare()), source)
            entered.await()
            val closing = model.close()
            runCurrent()
            assertFalse(closing.isCompleted)
            assertEquals(1, opens.get())
            assertEquals(0, closes.get())
            assertTrue(wire.calls.isEmpty())
            release.countDown()
            closing.await()
            assertEquals(1, closes.get())
            assertTrue(inputs.state.value.drafts.isEmpty())
            assertTrue(wire.calls.isEmpty())
            assertNull(model.prepare())
        } finally {
            release.countDown()
            model.closeAndAwait()
        }
    }

    @Test fun `failed input storage retains its file receipt and an explicit durability retry makes no upload`() = runTest {
        var failing = true
        var saved: CompanionInputSnapshot? = null
        val store = object : CompanionInputStoring {
            override fun load(): CompanionInputSnapshot? = null
            override fun save(snapshot: CompanionInputSnapshot) {
                if (failing) throw IOException("fixture storage unavailable")
                saved = snapshot
            }
            override fun preserveAndStartFresh() = error("no recovery requested")
        }
        val dispatcher = StandardTestDispatcher(testScheduler)
        val inputs = CompanionInputState.restore(store, backgroundScope, dispatcher)
        val wire = FakeWire().apply { stub("fileUploads/upload") { receipt() } }
        val session = SessionModel(wire, backgroundScope, inputs = inputs)
        session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, limits, dispatcher)
        try {
            model.accept(assertNotNull(model.prepare()), source()).join()
            assertEquals(NativeFileAttachmentPhase.FAILED, model.state.value.phase)
            assertEquals(NativeFileAttachmentIssue.PERSISTENCE_FAILED, model.state.value.issue)
            assertEquals(InputPersistenceStatus.WRITE_FAILED, inputs.persistence.value)
            val retained = inputs.state.value.drafts.getValue("selected")
            assertEquals(listOf(SessionFileAttachment("receipt", "attachment", "file.bin", 1)), retained.attachments)
            assertTrue(inputs.state.value.pendingPrompts.isEmpty())
            assertNull(saved)
            assertEquals(listOf("fileUploads/upload"), wire.calls.map { it.first })

            failing = false
            inputs.flush()
            runCurrent()
            assertEquals(InputPersistenceStatus.SAVED, inputs.persistence.value)
            assertEquals(inputs.state.value, saved)
            assertEquals(retained, saved!!.drafts["selected"])
            assertEquals(listOf("fileUploads/upload"), wire.calls.map { it.first })
        } finally {
            model.closeAndAwait()
            inputs.retireAndAwait()
        }
    }

    @Test fun `a completed cancellation cannot erase a replacement picker selection`() = runTest {
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val wire = FakeWire().apply { stub("fileUploads/upload") {
            entered.complete(Unit)
            withContext(NonCancellable) { release.await() }
            receipt()
        } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs)
        session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, limits, StandardTestDispatcher(testScheduler))
        var replacement: NativeFileSelection? = null
        var published: NativeFileAttachmentPhase? = null
        try {
            val uploading = model.accept(assertNotNull(model.prepare()), source())
            entered.await()
            // Completion publishes the new picker before the suspended cancellation resumes.
            uploading.invokeOnCompletion {
                replacement = model.prepare()
                published = model.state.value.phase
            }
            val cancelling = async { model.cancelAndAwait() }
            runCurrent()
            assertFalse(cancelling.isCompleted)
            release.complete(Unit)
            cancelling.await()
            assertTrue(uploading.isCancelled)
            assertEquals(NativeFileAttachmentPhase.SELECTING, published)
            assertEquals(NativeFileAttachmentPhase.SELECTING, model.state.value.phase)
            assertNull(model.prepare())
            model.cancelSelection(assertNotNull(replacement))
            assertEquals(NativeFileAttachmentPhase.IDLE, model.state.value.phase)
            assertTrue(inputs.state.value.drafts.isEmpty())
            assertEquals(1, wire.calls.size)
        } finally {
            release.complete(Unit)
            model.closeAndAwait()
        }
    }
}
