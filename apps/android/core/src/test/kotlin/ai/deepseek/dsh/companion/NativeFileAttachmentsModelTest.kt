package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeHttpRequestTooLarge
import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import java.io.ByteArrayInputStream
import java.util.Base64
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeFileAttachmentsModelTest {
    private fun value(text: String) = WireValue.fromJsonElement(Json.parseToJsonElement(text))
    private fun result(size: Int, receipt: String = "receipt") = value("""{"receiptId":"$receipt","file":{"attachmentId":"attachment","name":"报告.bin","bytes":$size}}""")
    private class Source(val bytes: ByteArray, val title: String? = "报告.bin") : NativeFileAttachmentSource {
        var opens = 0
        var closes = 0
        override fun name() = title
        override fun open() = object : ByteArrayInputStream(bytes) {
            init { opens++ }
            override fun close() { closes++; super.close() }
        }
    }

    @Test fun `selection consumes one source and retains canonical bytes as a draft receipt without prompting`() = runTest {
        val wire = FakeWire()
        wire.stub("fileUploads/upload") { result(4) }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs)
        session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
        val ticket = assertNotNull(model.prepare())
        model.selectSession("selected")
        val source = Source(byteArrayOf(0, -1, 4, 12))
        model.accept(ticket, source).join()
        model.accept(ticket, source).join()
        assertEquals(1, source.opens); assertEquals(1, source.closes)
        assertEquals(listOf("fileUploads/upload"), wire.calls.map { it.first })
        val args = wire.calls.single().second
        assertEquals(WireValue.StringValue("selected"), args["agentId"])
        assertContentEquals(source.bytes, Base64.getDecoder().decode(WireShape.string(args.getValue("request"), "data")))
        assertEquals(listOf(SessionFileAttachment("receipt", "attachment", "报告.bin", 4)), inputs.state.value.drafts["selected"]?.attachments)
        assertEquals(NativeFileAttachmentPhase.IDLE, model.state.value.phase)
        model.closeAndAwait()
    }

    @Test fun `empty files are uploaded but one byte over the content limit closes locally without a call`() = runTest {
        val wire = FakeWire(); wire.stub("fileUploads/upload") { result(0) }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
        val tooLarge = Source(ByteArray(5))
        model.accept(assertNotNull(model.prepare()), tooLarge).join()
        assertEquals(NativeFileAttachmentIssue.TOO_LARGE, model.state.value.issue)
        assertEquals(1, tooLarge.closes); assertTrue(wire.calls.isEmpty())
        model.accept(assertNotNull(model.prepare()), Source(ByteArray(0))).join()
        assertEquals(0L, inputs.state.value.drafts["selected"]!!.attachments.single().bytes)
        model.closeAndAwait()
    }

    @Test fun `encoded metadata limit and attachment count refuse before another Host upload`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 64, 1), StandardTestDispatcher(testScheduler))
        model.accept(assertNotNull(model.prepare()), Source(byteArrayOf(1), "名".repeat(30))).join()
        assertEquals(NativeFileAttachmentIssue.REQUEST_TOO_LARGE, model.state.value.issue)
        session.addAttachment("selected", SessionFileAttachment("first", "stored", "one", 1))
        assertNull(model.prepare())
        assertEquals(NativeFileAttachmentIssue.TOO_MANY_FILES, model.state.value.issue)
        assertTrue(wire.calls.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `a picker cannot regain authority after leaving and reopening the same Session`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
        val ticket = assertNotNull(model.prepare())
        session.openSession("other"); session.openSession("selected")
        val source = Source(byteArrayOf(1))
        model.accept(ticket, source).join()
        assertEquals(0, source.opens); assertTrue(wire.calls.isEmpty()); assertTrue(inputs.state.value.drafts.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `retirement waits for cancellation resistant RPC cleanup and drops its late receipt`() = runTest {
        val wire = FakeWire()
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        wire.stub("fileUploads/upload") {
            entered.complete(Unit)
            withContext(NonCancellable) { release.await() }
            result(1)
        }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
        model.accept(assertNotNull(model.prepare()), Source(byteArrayOf(1)))
        entered.await()
        val retired = model.close()
        runCurrent(); assertFalse(retired.isCompleted)
        release.complete(Unit); retired.await()
        assertTrue(inputs.state.value.drafts.isEmpty()); assertNull(model.prepare())
    }

    @Test fun `invalid receipt metadata never enters the draft`() = runTest {
        val wire = FakeWire(); wire.stub("fileUploads/upload") { result(2) }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
        model.accept(assertNotNull(model.prepare()), Source(byteArrayOf(1))).join()
        assertEquals(ConnectionFailure.INVALID_RESPONSE, model.state.value.failure)
        assertTrue(inputs.state.value.drafts.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `complete request budget refusal closes the source and preserves pending intent and the newer draft`() = runTest {
        val wire = FakeWire()
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        wire.stub("fileUploads/upload") { entered.complete(Unit); release.await(); throw NativeHttpRequestTooLarge(2049, 2048) }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val original = SessionDraft("old intent", "pending-original", listOf(SessionFileAttachment("retained", "id", "old.bin", 1)))
        inputs.update { it.copy(drafts = mapOf("selected" to original),
            pendingPrompts = mapOf(original.requestId to PendingPrompt("selected", original))) }
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope,
            NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
        val source = Source(byteArrayOf(1))
        val upload = model.accept(assertNotNull(model.prepare()), source)
        entered.await()
        session.updateDraft("selected", "newer text")
        val preserved = inputs.state.value
        release.complete(Unit); upload.join()
        assertEquals(NativeFileAttachmentIssue.REQUEST_TOO_LARGE, model.state.value.issue)
        assertNull(model.state.value.refusal)
        assertEquals(preserved, inputs.state.value)
        assertEquals(1, source.opens); assertEquals(1, source.closes)
        assertEquals(listOf("fileUploads/upload"), wire.calls.map { it.first })
        model.closeAndAwait()
    }

    @Test fun `budget wire failures preserve their existing failure category and all unsent input`() = runTest {
        for ((failure, category) in listOf(
            LinkClientException.BadWire("invalid budget") to ConnectionFailure.INVALID_RESPONSE,
            LinkClientException.Carrier(503, "budget unavailable") to ConnectionFailure.TRANSPORT,
            LinkClientException.Refused("gateway/permission-denied", "budget refused",
                WireValue.ObjectValue(mapOf("scope" to WireValue.StringValue("view")))) to ConnectionFailure.REFUSED,
        )) {
            val wire = FakeWire(); wire.stub("fileUploads/upload") { throw failure }
            val inputs = CompanionInputState.memory()
            val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
            val original = SessionDraft("pending text", "pending-original")
            inputs.update { it.copy(drafts = mapOf("selected" to SessionDraft("new draft", "new-request")),
                pendingPrompts = mapOf(original.requestId to PendingPrompt("selected", original))) }
            val preserved = inputs.state.value
            val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope,
                NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
            val source = Source(byteArrayOf(1))
            model.accept(assertNotNull(model.prepare()), source).join()
            assertEquals(NativeFileAttachmentIssue.UPLOAD_FAILED, model.state.value.issue)
            assertEquals(category, model.state.value.failure)
            assertEquals((failure as? LinkClientException.Refused)?.let(GatewayFailureEnvelope::from), model.state.value.refusal)
            assertEquals(preserved, inputs.state.value)
            assertEquals(1, source.closes)
            assertEquals(listOf("fileUploads/upload"), wire.calls.map { it.first })
            model.closeAndAwait()
        }
    }

    @Test fun `the local 512 KiB source ceiling rejects before transport can offer any larger allowance`() = runTest {
        val wire = FakeWire(); wire.stub("fileUploads/upload") { error("oversized sources must not reach budget discovery") }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope,
            NativeFileAttachmentLimits(524_288, 1_048_576, 8), StandardTestDispatcher(testScheduler))
        val source = Source(ByteArray(524_289))
        model.accept(assertNotNull(model.prepare()), source).join()
        assertEquals(NativeFileAttachmentIssue.TOO_LARGE, model.state.value.issue)
        assertEquals(1, source.opens); assertEquals(1, source.closes)
        assertTrue(wire.calls.isEmpty()); assertTrue(inputs.state.value.drafts.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `cancelled selection and a retired Host ignore unopened source callbacks`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
        val source = Source(byteArrayOf(1))
        val cancelled = assertNotNull(model.prepare()); model.cancelSelection(cancelled); model.accept(cancelled, source).join()
        val retired = assertNotNull(model.prepare()); model.closeAndAwait(); model.accept(retired, source).join()
        assertEquals(0, source.opens); assertTrue(wire.calls.isEmpty())
    }

    @Test fun `durable file blocks render a searchable filename and size including empty content`() {
        val records = Json.parseToJsonElement("""[{"type":"event","event":{"type":"user/message","seq":1,"data":{"id":"m","role":"user","content":[{"type":"text","text":"Look"},{"type":"file","attachment":{"attachmentId":"f","name":"报告.bin","bytes":4}},{"type":"file","attachment":{"attachmentId":"e","name":"empty.txt","bytes":0}}],"source":{"kind":"user"}}}}]""").jsonArray
        assertEquals("Look\n文件 报告.bin（4 字节）\n文件 empty.txt（0 字节）", foldDomain(records).items.last().text)
    }

    private fun hexSha256(bytes: ByteArray): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun attachmentModel(wire: FakeWire, inputs: CompanionInputState, session: SessionModel,
                                scope: kotlinx.coroutines.CoroutineScope, scheduler: TestCoroutineScheduler) =
        NativeFileAttachmentsModel(wire, session, inputs, scope, NativeFileAttachmentLimits(8, 4096, 4), StandardTestDispatcher(scheduler))

    @Test fun `re-uploading remembered bytes skips re-sending them through the deduplication path`() = runTest {
        val bytes = byteArrayOf(0, -1, 4)
        val wire = FakeWire()
        wire.stub("fileUploads/upload") { result(3, "first") }
        wire.stub("fileUploads/uploadDedupe") { result(3, "second") }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = attachmentModel(wire, inputs, session, backgroundScope, testScheduler)
        model.accept(assertNotNull(model.prepare()), Source(bytes)).join()
        assertEquals("first", inputs.state.value.drafts["selected"]?.attachments?.single()?.receiptId)
        model.accept(assertNotNull(model.prepare()), Source(bytes, "副本.bin")).join()
        assertEquals(listOf("fileUploads/upload", "fileUploads/uploadDedupe"), wire.calls.map { it.first })
        val request = wire.calls.last().second.getValue("request")
        assertEquals(hexSha256(bytes), WireShape.string(request, "digest"))
        assertEquals("副本.bin", WireShape.string(request, "name"))
        assertEquals("second", inputs.state.value.drafts["selected"]?.attachments?.last()?.receiptId)
        model.closeAndAwait()
    }

    @Test fun `an unknown remembered digest falls back to exactly one full upload`() = runTest {
        val bytes = byteArrayOf(7)
        val wire = FakeWire()
        wire.stub("fileUploads/upload") { result(1, "full") }
        wire.stubSequence("fileUploads/uploadDedupe", listOf<suspend () -> WireValue> {
            throw LinkClientException.Refused("session/attachment-invalid", "no stored file",
                value("""{"reason":"FILE_DIGEST_NOT_KNOWN"}"""))
        })
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = attachmentModel(wire, inputs, session, backgroundScope, testScheduler)
        model.accept(assertNotNull(model.prepare()), Source(bytes)).join()
        model.accept(assertNotNull(model.prepare()), Source(bytes)).join()
        assertEquals(listOf("fileUploads/upload", "fileUploads/uploadDedupe", "fileUploads/upload"), wire.calls.map { it.first })
        assertEquals("full", inputs.state.value.drafts["selected"]?.attachments?.last()?.receiptId)
        model.closeAndAwait()
    }

    @Test fun `a Host without the deduplication capability keeps the remembered-digest path on the full upload`() = runTest {
        val bytes = byteArrayOf(9)
        val wire = FakeWire()
        wire.stub("fileUploads/upload") { result(1, "full") }
        wire.stubSequence("fileUploads/uploadDedupe", listOf<suspend () -> WireValue> {
            throw LinkClientException.Refused("host/capability-unavailable", "not advertised",
                value("""{"capability":"file-upload.dedupe.v1"}"""))
        })
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = attachmentModel(wire, inputs, session, backgroundScope, testScheduler)
        model.accept(assertNotNull(model.prepare()), Source(bytes)).join()
        model.accept(assertNotNull(model.prepare()), Source(bytes)).join()
        assertEquals(listOf("fileUploads/upload", "fileUploads/uploadDedupe", "fileUploads/upload"), wire.calls.map { it.first })
        assertEquals("full", inputs.state.value.drafts["selected"]?.attachments?.last()?.receiptId)
        model.closeAndAwait()
    }

    @Test fun `an unrelated deduplication refusal stays fatal instead of silently re-uploading`() = runTest {
        val bytes = byteArrayOf(5)
        val wire = FakeWire()
        wire.stub("fileUploads/upload") { result(1, "first") }
        wire.stubSequence("fileUploads/uploadDedupe", listOf<suspend () -> WireValue> {
            throw LinkClientException.Refused("session/attachment-invalid", "malformed digest",
                value("""{"reason":"FILE_DIGEST_INVALID"}"""))
        })
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = attachmentModel(wire, inputs, session, backgroundScope, testScheduler)
        model.accept(assertNotNull(model.prepare()), Source(bytes)).join()
        assertEquals("first", inputs.state.value.drafts["selected"]?.attachments?.single()?.receiptId)
        model.accept(assertNotNull(model.prepare()), Source(bytes)).join()
        assertEquals(listOf("fileUploads/upload", "fileUploads/uploadDedupe"), wire.calls.map { it.first })
        assertEquals(NativeFileAttachmentPhase.FAILED, model.state.value.phase)
        assertEquals("first", inputs.state.value.drafts["selected"]?.attachments?.single()?.receiptId)
        model.closeAndAwait()
    }
}
