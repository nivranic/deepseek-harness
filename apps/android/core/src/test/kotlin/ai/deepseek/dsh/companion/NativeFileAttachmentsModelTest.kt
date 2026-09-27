package ai.deepseek.dsh.companion

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
        assertEquals(listOf(SessionFileAttachment("receipt", "attachment", "报告.bin", 4)), inputs.state.value.drafts["selected"]?.files)
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
        assertEquals(0L, inputs.state.value.drafts["selected"]!!.files.single().bytes)
        model.closeAndAwait()
    }

    @Test fun `encoded metadata limit and attachment count refuse before another Host upload`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("selected")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 64, 1), StandardTestDispatcher(testScheduler))
        model.accept(assertNotNull(model.prepare()), Source(byteArrayOf(1), "名".repeat(30))).join()
        assertEquals(NativeFileAttachmentIssue.REQUEST_TOO_LARGE, model.state.value.issue)
        session.addFileAttachment("selected", SessionFileAttachment("first", "stored", "one", 1))
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
}
