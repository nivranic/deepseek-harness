package ai.deepseek.dsh.companion

import java.io.ByteArrayInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeShareAttachmentsLifecycleTest {
    @Test fun `cancelling a blocking source waits for close while every prompt and attachment entry stays excluded`() = runTest {
        val fixture = ShareFixture(this, dispatcher = Dispatchers.IO); fixture.open()
        fixture.session.updateDraft("session", "retained")
        val original = fixture.inputs.state.value.drafts.getValue("session")
        fixture.inputs.update { it.copy(pendingPrompts = mapOf(original.requestId to PendingPrompt("session", original))) }
        val reading = CompletableDeferred<Unit>(); val release = CountDownLatch(1); val closes = AtomicInteger()
        val source = object : NativeFileAttachmentSource {
            override fun name() = "blocked.bin"
            override fun open() = object : ByteArrayInputStream(byteArrayOf(7)) {
                override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                    reading.complete(Unit); check(release.await(10, TimeUnit.SECONDS))
                    return super.read(bytes, offset, length)
                }
                override fun close() { closes.incrementAndGet(); super.close() }
            }
        }
        try {
            val importing = fixture.importBatch("shared", listOf(NativeShareItem(source)))
            reading.await()
            val cancelling = async { importing.cancelAndAwait() }; runCurrent()
            assertFalse(cancelling.isCompleted); assertEquals(0, closes.get())
            assertFalse(fixture.session.sendDraft()); assertFalse(fixture.session.send("direct"))
            fixture.session.submitDraft().join(); fixture.session.retryPrompt(original.requestId).join()
            assertNull(fixture.model.prepare()); assertNull(fixture.model.prepare(NativeAttachmentKind.IMAGE))
            assertEquals(NativeShareIssue.BUSY, assertIs<NativeShareResult.NotAdopted>(fixture.importBatch("second").awaitResult()).issue)
            assertTrue(fixture.wire.calls.isEmpty())
            release.countDown()
            assertEquals(NativeShareIssue.CANCELLED, assertIs<NativeShareResult.NotAdopted>(cancelling.await()).issue)
            assertEquals(1, closes.get()); assertEquals(original, fixture.inputs.state.value.drafts["session"])
            assertTrue(fixture.session.sendDraft())
        } finally { release.countDown(); fixture.model.closeAndAwait() }
    }

    @Test fun `one reservation survives every item and cancellation waits for a resistant upload without reading the next item`() = runTest {
        val fixture = ShareFixture(this); fixture.open(); fixture.session.updateDraft("session", "keep")
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        fixture.wire.stubSequence("fileUploads/upload", listOf(
            {
                assertFalse(fixture.session.sendDraft()); assertNull(fixture.model.prepare())
                fixture.receipt(image = false)
            },
            { entered.complete(Unit); withContext(NonCancellable) { release.await() }; fixture.receipt(image = false) },
        ))
        val third = SharedSource()
        try {
            val importing = fixture.importBatch("shared", listOf(NativeShareItem(SharedSource(byteArrayOf(1))), NativeShareItem(SharedSource(byteArrayOf(2))), NativeShareItem(third)))
            entered.await()
            val cancelling = async { fixture.model.cancelAndAwait() }; runCurrent()
            assertFalse(cancelling.isCompleted); assertFalse(fixture.session.sendDraft()); assertNull(fixture.model.prepare())
            assertEquals("keep", fixture.inputs.state.value.drafts.getValue("session").text)
            release.complete(Unit); cancelling.await()
            assertEquals(NativeShareIssue.CANCELLED, assertIs<NativeShareResult.NotAdopted>(importing.awaitResult()).issue)
            assertEquals(0, third.types); assertEquals(0, third.opens)
            assertEquals(2, fixture.wire.calls.size)
            assertTrue(fixture.inputs.state.value.drafts.getValue("session").attachments.isEmpty())
        } finally { release.complete(Unit); fixture.model.closeAndAwait() }
    }

    @Test fun `parent cancellation before the lazy import body releases admission without opening a source`() = runTest {
        val owner = CoroutineScope(backgroundScope.coroutineContext + SupervisorJob(backgroundScope.coroutineContext[Job]))
        val fixture = ShareFixture(this, parent = owner); fixture.open(); fixture.session.updateDraft("session", "keep")
        val source = SharedSource()
        val importing = fixture.importBatch("shared", listOf(NativeShareItem(source)))
        owner.cancel()
        assertEquals(NativeShareIssue.CANCELLED, assertIs<NativeShareResult.NotAdopted>(importing.awaitResult()).issue)
        assertEquals(0, source.types); assertEquals(0, source.opens)
        assertTrue(fixture.session.sendDraft()); assertEquals(listOf("session/prompt"), fixture.wire.calls.map { it.first })
        fixture.model.closeAndAwait()
    }

    @Test fun `retired Host work cannot enter a replacement Host even when both select the same Session id`() = runTest {
        val previous = ShareFixture(this); previous.open()
        val next = ShareFixture(this); next.open(); next.session.updateDraft("session", "replacement")
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        previous.wire.stub("fileUploads/upload") {
            entered.complete(Unit); withContext(NonCancellable) { release.await() }; previous.receipt(image = false)
        }
        try {
            val importing = previous.importBatch("old shared text", listOf(NativeShareItem(SharedSource())))
            entered.await()
            val closing = previous.model.close(); runCurrent(); assertFalse(closing.isCompleted)
            val replacement = assertIs<NativeShareResult.Adopted>(next.importBatch("new shared text").awaitResult())
            release.complete(Unit); closing.await()
            assertEquals(NativeShareIssue.STALE_TARGET, assertIs<NativeShareResult.NotAdopted>(importing.awaitResult()).issue)
            assertTrue(previous.inputs.state.value.drafts.isEmpty())
            assertEquals("replacement\n\nnew shared text", next.inputs.state.value.drafts.getValue("session").text)
            assertEquals(replacement.requestId, next.inputs.state.value.drafts.getValue("session").requestId)
            assertTrue(next.wire.calls.isEmpty())
        } finally { release.complete(Unit); previous.model.closeAndAwait(); next.model.closeAndAwait() }
    }

    @Test fun `cancellation after atomic adoption retains that fact and newer edits for save-only recovery`() = runTest {
        for (withFile in listOf(false, true)) {
            val store = ShareStore()
            val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
            val fixture = ShareFixture(this, inputs); fixture.open(); inputs.flush()
            val once = AtomicBoolean()
            lateinit var importing: NativeShareImport
            store.onSave = { snapshot ->
                if (snapshot.drafts["session"]?.text == "shared" && once.compareAndSet(false, true)) {
                    fixture.session.updateDraft("session", "newer user edit")
                    importing.cancel()
                }
            }
            importing = fixture.importBatch("shared", if (withFile) listOf(NativeShareItem(SharedSource())) else emptyList())
            val result = assertIs<NativeShareResult.Adopted>(importing.awaitResult())
            assertFalse(result.saved)
            val latest = inputs.state.value.drafts.getValue("session")
            assertEquals("newer user edit", latest.text); assertNotEquals(result.requestId, latest.requestId)
            assertEquals(if (withFile) 1 else 0, latest.attachments.size)
            store.onSave = null; inputs.flush()
            assertEquals(latest, store.saved?.drafts?.get("session"))
            assertEquals(if (withFile) listOf("fileUploads/upload") else emptyList(), fixture.wire.calls.map { it.first })
            assertEquals(result, importing.cancelAndAwait()); fixture.model.closeAndAwait()
        }
    }

    @Test fun `blocked input storage reports not adopted without replacing its retained snapshot`() = runTest {
        val store = object : CompanionInputStoring {
            override fun load(): CompanionInputSnapshot = throw InputPersistenceException()
            override fun save(snapshot: CompanionInputSnapshot) = error("unreadable input cannot be overwritten")
            override fun preserveAndStartFresh() = error("recovery requires a separate user action")
        }
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val fixture = ShareFixture(this, inputs); fixture.open()
        val result = assertIs<NativeShareResult.NotAdopted>(fixture.importBatch("shared").awaitResult())
        assertEquals(NativeShareIssue.INPUT_FAILED, result.issue)
        assertEquals(InputPersistenceStatus.RESTORE_FAILED, inputs.persistence.value)
        assertTrue(inputs.state.value.drafts.isEmpty()); assertTrue(fixture.wire.calls.isEmpty())
        fixture.model.closeAndAwait()
    }
}
