package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeHttpRequestTooLarge
import java.io.IOException
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeShareAttachmentsModelTest {
    @Test fun `a complete mixed batch merges once with the newest draft and leaves pending intent unchanged`() = runTest {
        val fixture = ShareFixture(this); fixture.open()
        val original = SessionDraft("original", "pending-original", listOf(SessionFileAttachment("existing", "existing-id", "old.txt", 1)))
        fixture.inputs.update { it.copy(drafts = mapOf("session" to original),
            pendingPrompts = mapOf(original.requestId to PendingPrompt("session", original))) }
        val uploaded = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        fixture.wire.stub("fileUploads/upload") { uploaded.complete(Unit); release.await(); fixture.receipt(image = false) }
        val image = SharedSource(type = "image/png"); val file = SharedSource()
        val importing = fixture.importBatch("shared text", listOf(NativeShareItem(image), NativeShareItem(file)))
        uploaded.await()
        assertEquals(original, fixture.inputs.state.value.drafts["session"])
        fixture.session.updateDraft("session", "edited during upload")
        val edited = fixture.inputs.state.value.drafts.getValue("session")
        release.complete(Unit)
        val result = assertIs<NativeShareResult.Adopted>(importing.awaitResult())
        val adopted = fixture.inputs.state.value.drafts.getValue("session")
        assertTrue(result.saved); assertEquals(adopted.requestId, result.requestId)
        assertNotEquals(edited.requestId, adopted.requestId)
        assertEquals("edited during upload\n\nshared text", adopted.text)
        assertEquals(listOf("existing", "receipt-1", "receipt-2"), adopted.attachments.map { it.receiptId })
        assertIs<SessionImageAttachment>(adopted.attachments[1]); assertIs<SessionFileAttachment>(adopted.attachments[2])
        assertEquals(mapOf(original.requestId to PendingPrompt("session", original)), fixture.inputs.state.value.pendingPrompts)
        assertEquals(listOf("fileUploads/uploadImage", "fileUploads/upload"), fixture.wire.calls.map { it.first })
        assertEquals(1, image.closes); assertEquals(1, file.closes)
        fixture.model.closeAndAwait()
    }

    @Test fun `every source and receipt failure leaves the complete preexisting draft unchanged`() = runTest {
        for (failure in listOf("read", "metadata", "upload", "receipt")) {
            val fixture = ShareFixture(this); fixture.open(); fixture.session.updateDraft("session", "keep")
            val original = fixture.inputs.state.value.drafts.getValue("session")
            val second = when (failure) {
                "read" -> object : SharedSource() { override fun open(): java.io.ByteArrayInputStream = throw IOException("provider") }
                "metadata" -> SharedSource(title = " ")
                else -> SharedSource()
            }
            fixture.wire.stubSequence("fileUploads/upload", listOf(
                { fixture.receipt(image = false) },
                { if (failure == "upload") throw IOException("wire") else sharedWireValue("""{"receiptId":"invalid","file":{"attachmentId":"bad","name":"bad","bytes":2}}""") },
            ))
            val result = assertIs<NativeShareResult.NotAdopted>(fixture.importBatch("never append", listOf(
                NativeShareItem(SharedSource()), NativeShareItem(second))).awaitResult())
            assertEquals(NativeShareIssue.ATTACHMENT_FAILED, result.issue)
            assertEquals(original, fixture.inputs.state.value.drafts["session"])
            assertTrue(fixture.wire.calls.none { it.first == "session/prompt" })
            fixture.model.closeAndAwait()
        }
    }

    @Test fun `a later file budget refusal prevents partial batch adoption and preserves newer input and pending intent`() = runTest {
        val fixture = ShareFixture(this); fixture.open()
        val pending = SessionDraft("old pending", "pending-original")
        fixture.inputs.update { it.copy(drafts = mapOf("session" to SessionDraft("initial draft", "initial-request")),
            pendingPrompts = mapOf(pending.requestId to PendingPrompt("session", pending))) }
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        fixture.wire.stubSequence("fileUploads/upload", listOf(
            { fixture.receipt(image = false) },
            { entered.complete(Unit); release.await(); throw NativeHttpRequestTooLarge(2049, 2048) },
        ))
        val first = SharedSource(); val second = SharedSource()
        val importing = fixture.importBatch("never append", listOf(NativeShareItem(first), NativeShareItem(second)))
        entered.await()
        fixture.session.updateDraft("session", "edited during budget query")
        val preserved = fixture.inputs.state.value
        release.complete(Unit)
        val result = assertIs<NativeShareResult.NotAdopted>(importing.awaitResult())
        assertEquals(NativeShareIssue.ATTACHMENT_FAILED, result.issue)
        assertEquals(NativeFileAttachmentIssue.REQUEST_TOO_LARGE, result.attachmentIssue)
        assertNull(result.refusal)
        assertEquals(preserved, fixture.inputs.state.value)
        assertEquals(1, first.closes); assertEquals(1, second.closes)
        assertEquals(listOf("fileUploads/upload", "fileUploads/upload"), fixture.wire.calls.map { it.first })
        fixture.model.closeAndAwait()
    }

    @Test fun `text and combined count limits reject before provider metadata or upload`() = runTest {
        val fixture = ShareFixture(this, limits = NativeFileAttachmentLimits(4, 4096, 1)); fixture.open()
        val source = SharedSource()
        val unicode = fixture.model.importShare(fixture.request("界界", listOf(NativeShareItem(source))), NativeShareLimits(5)).awaitResult()
        assertEquals(NativeShareIssue.TEXT_TOO_LARGE, assertIs<NativeShareResult.NotAdopted>(unicode).issue)
        fixture.session.addAttachment("session", SessionFileAttachment("existing", "id", "old", 1))
        val full = fixture.importBatch(items = listOf(NativeShareItem(source))).awaitResult()
        assertEquals(NativeFileAttachmentIssue.TOO_MANY_FILES, assertIs<NativeShareResult.NotAdopted>(full).attachmentIssue)
        assertEquals(0, source.types); assertEquals(0, source.names); assertEquals(0, source.opens)
        assertTrue(fixture.wire.calls.isEmpty())
        fixture.model.closeAndAwait()
    }

    @Test fun `per-item byte and encoded JSON limits close the source without adopting or calling the Host`() = runTest {
        for (source in listOf(SharedSource(ByteArray(5)), SharedSource(title = "名".repeat(50)))) {
            val fixture = ShareFixture(this, limits = NativeFileAttachmentLimits(4, 64, 8)); fixture.open()
            val result = assertIs<NativeShareResult.NotAdopted>(fixture.importBatch(items = listOf(NativeShareItem(source))).awaitResult())
            assertEquals(if (source.bytes.size > 4) NativeFileAttachmentIssue.TOO_LARGE else NativeFileAttachmentIssue.REQUEST_TOO_LARGE,
                result.attachmentIssue)
            assertEquals(1, source.closes); assertTrue(fixture.wire.calls.isEmpty()); assertTrue(fixture.inputs.state.value.drafts.isEmpty())
            fixture.model.closeAndAwait()
        }
    }

    @Test fun `declared and detected images never fall back to file upload and capabilities precede name and open`() = runTest {
        val fixture = ShareFixture(this); fixture.open()
        for ((type, required) in listOf(null to true, "application/pdf" to true, "image/heic" to false, "IMAGE/SVG+XML" to false)) {
            val source = SharedSource(type = type)
            val result = assertIs<NativeShareResult.NotAdopted>(fixture.importBatch(items = listOf(NativeShareItem(source, required))).awaitResult())
            assertEquals(NativeFileAttachmentIssue.UNSUPPORTED_IMAGE, result.attachmentIssue)
            assertEquals(1, source.types); assertEquals(0, source.names); assertEquals(0, source.opens)
        }
        for ((type, allowed) in listOf("application/pdf" to setOf(NativeAttachmentKind.IMAGE), "image/png" to setOf(NativeAttachmentKind.FILE))) {
            val source = SharedSource(type = type)
            val request = fixture.request(items = listOf(NativeShareItem(source)), allowed = allowed)
            val result = assertIs<NativeShareResult.NotAdopted>(fixture.model.importShare(request, NativeShareLimits(64)).awaitResult())
            assertEquals(NativeShareIssue.KIND_UNAVAILABLE, result.issue)
            assertEquals(1, source.types); assertEquals(0, source.names); assertEquals(0, source.opens)
        }
        assertTrue(fixture.wire.calls.isEmpty()); fixture.model.closeAndAwait()
    }

    @Test fun `text-only shares use one admission and preserve existing attachments without an upload`() = runTest {
        val fixture = ShareFixture(this); fixture.open(); fixture.session.updateDraft("session", "existing")
        val retained = SessionFileAttachment("existing", "id", "old", 0)
        fixture.session.addAttachment("session", retained)
        val importing = fixture.model.importShare(fixture.request("shared", allowed = emptySet()), NativeShareLimits(64))
        assertFalse(fixture.session.sendDraft()); assertNull(fixture.model.prepare())
        val busy = assertIs<NativeShareResult.NotAdopted>(fixture.importBatch("another").awaitResult())
        assertEquals(NativeShareIssue.BUSY, busy.issue)
        assertIs<NativeShareResult.Adopted>(importing.awaitResult())
        val draft = fixture.inputs.state.value.drafts.getValue("session")
        assertEquals("existing\n\nshared", draft.text); assertEquals(listOf(retained), draft.attachments)
        assertTrue(fixture.wire.calls.isEmpty())
        assertEquals(NativeShareIssue.EMPTY, assertIs<NativeShareResult.NotAdopted>(fixture.importBatch().awaitResult()).issue)
        fixture.model.closeAndAwait()
    }

    @Test fun `adoption rechecks current attachment count and never overwrites edits made while uploading`() = runTest {
        val fixture = ShareFixture(this, limits = NativeFileAttachmentLimits(4, 4096, 1)); fixture.open()
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        fixture.wire.stub("fileUploads/upload") { entered.complete(Unit); release.await(); fixture.receipt(image = false) }
        val importing = fixture.importBatch("shared", listOf(NativeShareItem(SharedSource())))
        entered.await(); fixture.session.updateDraft("session", "new text")
        fixture.session.addAttachment("session", SessionFileAttachment("newer", "id", "newer", 1))
        val newest = fixture.inputs.state.value.drafts.getValue("session")
        release.complete(Unit)
        assertEquals(NativeFileAttachmentIssue.TOO_MANY_FILES, assertIs<NativeShareResult.NotAdopted>(importing.awaitResult()).attachmentIssue)
        assertEquals(newest, fixture.inputs.state.value.drafts["session"]); fixture.model.closeAndAwait()
    }

    @Test fun `a reviewed Session generation cannot be substituted before or during import`() = runTest {
        val fixture = ShareFixture(this); fixture.open()
        val source = SharedSource(); val stale = fixture.request("shared", listOf(NativeShareItem(source)))
        fixture.session.openSession("other"); fixture.session.openSession("session")
        assertEquals(NativeShareIssue.STALE_TARGET, assertIs<NativeShareResult.NotAdopted>(fixture.model.importShare(stale, NativeShareLimits(64)).awaitResult()).issue)
        assertEquals(0, source.types)
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        fixture.wire.stub("fileUploads/upload") { entered.complete(Unit); release.await(); fixture.receipt(image = false) }
        val importing = fixture.importBatch("shared", listOf(NativeShareItem(source)))
        entered.await(); fixture.session.openSession("other"); fixture.session.openSession("session")
        release.complete(Unit)
        assertEquals(NativeShareIssue.STALE_TARGET, assertIs<NativeShareResult.NotAdopted>(importing.awaitResult()).issue)
        assertTrue(fixture.inputs.state.value.drafts.isEmpty()); fixture.model.closeAndAwait()
    }

    @Test fun `duplicate receipts reject the whole batch without replacing its original draft`() = runTest {
        val fixture = ShareFixture(this); fixture.open(); fixture.session.updateDraft("session", "keep")
        fixture.wire.stub("fileUploads/upload") { fixture.receipt(image = false, id = "duplicate") }
        val original = fixture.inputs.state.value.drafts.getValue("session")
        val result = fixture.importBatch("shared", listOf(NativeShareItem(SharedSource()), NativeShareItem(SharedSource()))).awaitResult()
        assertEquals(ConnectionFailure.INVALID_RESPONSE, assertIs<NativeShareResult.NotAdopted>(result).failure)
        assertEquals(original, fixture.inputs.state.value.drafts["session"]); fixture.model.closeAndAwait()
    }

    @Test fun `save failure retains adopted content and explicit save retry neither uploads nor appends it again`() = runTest {
        val store = ShareStore()
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val fixture = ShareFixture(this, inputs); fixture.open(); inputs.flush()
        store.fail = true
        val importing = fixture.importBatch("shared", listOf(NativeShareItem(SharedSource())))
        val result = assertIs<NativeShareResult.Adopted>(importing.awaitResult())
        assertFalse(result.saved); assertEquals(result.requestId, inputs.state.value.drafts.getValue("session").requestId)
        fixture.session.updateDraft("session", "user edited after import")
        val newest = inputs.state.value.drafts.getValue("session")
        store.fail = false; inputs.flush()
        assertEquals(newest, store.saved?.drafts?.get("session"))
        assertEquals(1, newest.attachments.size); assertEquals(1, fixture.wire.calls.size)
        assertEquals(result, importing.awaitResult()); fixture.model.closeAndAwait()
    }
}
