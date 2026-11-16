package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.ByteArrayInputStream
import java.util.concurrent.CountDownLatch
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativePhotoAttachmentsModelTest {
    private fun value(text: String) = WireValue.fromJsonElement(Json.parseToJsonElement(text))
    private fun imageResult() = """{"receiptId":"photo","image":{"attachmentId":"image-id","mediaType":"image/png","bytes":69,"width":1,"height":1,"name":"红.png","originalDimensions":{"width":2,"height":3}}}"""
    private class Source(private val type: String? = "image/png", private val bytes: ByteArray = byteArrayOf(1)) : NativeFileAttachmentSource {
        var opens = 0
        var closes = 0
        override fun name() = "红.png"
        override fun mediaType() = type
        override fun open() = object : ByteArrayInputStream(bytes) {
            init { opens++ }
            override fun close() { closes++; super.close() }
        }
    }

    @Test fun `picker reading and upload admission exclude every prompt entry until cancellation settles`() = runTest {
        val wire = FakeWire().apply { stub("session/prompt") { value("""{"accepted":true}""") } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val draft = SessionDraft("retained", "request")
        inputs.update { it.copy(drafts = mapOf("session" to draft), pendingPrompts = mapOf("request" to PendingPrompt("session", draft))) }
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 8))
        suspend fun noPrompt() {
            assertFalse(session.sendDraft())
            session.submitDraft().join(); session.retryPrompt("request").join()
            assertTrue(wire.calls.none { it.first == "session/prompt" })
        }
        val selected = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE))
        noPrompt()
        val reading = CompletableDeferred<Unit>(); val releaseRead = CountDownLatch(1)
        val source = object : NativeFileAttachmentSource {
            override fun name() = "photo.png"
            override fun mediaType() = "image/png"
            override fun open() = object : ByteArrayInputStream(byteArrayOf(1)) {
                override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                    reading.complete(Unit); check(releaseRead.await(10, java.util.concurrent.TimeUnit.SECONDS))
                    return super.read(bytes, offset, length)
                }
            }
        }
        val uploading = CompletableDeferred<Unit>(); val releaseUpload = CompletableDeferred<Unit>()
        wire.stub("fileUploads/uploadImage") { uploading.complete(Unit); withContext(NonCancellable) { releaseUpload.await() }; value(imageResult()) }
        try {
            model.accept(selected, source)
            reading.await(); assertEquals(NativeFileAttachmentPhase.READING, model.state.value.phase); noPrompt()
            releaseRead.countDown(); uploading.await()
            assertEquals(NativeFileAttachmentPhase.UPLOADING, model.state.value.phase); noPrompt()
            val cancelling = model.cancel(); runCurrent(); assertFalse(cancelling.isCompleted); noPrompt()
            releaseUpload.complete(Unit); cancelling.join()
            assertTrue(session.sendDraft())
            assertEquals(1, wire.calls.count { it.first == "session/prompt" })
        } finally { releaseRead.countDown(); releaseUpload.complete(Unit); model.closeAndAwait() }
    }

    @Test fun `an admitted prompt blocks file and photo selection until acknowledgement finishes`() = runTest {
        val reply = CompletableDeferred<WireValue>()
        val wire = FakeWire().apply { stub("session/prompt") { reply.await() } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session"); session.updateDraft("session", "send")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 8), StandardTestDispatcher(testScheduler))
        val sending = session.submitDraft(); runCurrent()
        assertNull(model.prepare()); assertNull(model.prepare(NativeAttachmentKind.IMAGE))
        reply.complete(value("""{"accepted":true}""")); sending.join()
        val selected = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE))
        model.cancelSelection(selected); model.closeAndAwait()
    }

    @Test fun `cancellation before the upload body starts releases the exact prompt reservation without opening its source`() = runTest {
        val wire = FakeWire().apply { stub("session/prompt") { value("""{"accepted":true}""") } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session"); session.updateDraft("session", "send")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 8), StandardTestDispatcher(testScheduler))
        val source = Source()
        val job = model.accept(assertNotNull(model.prepare(NativeAttachmentKind.IMAGE)), source)
        job.cancel(); job.join()
        assertEquals(0, source.opens)
        assertEquals(NativeFileAttachmentPhase.IDLE, model.state.value.phase)
        val next = assertNotNull(model.prepare())
        assertFalse(session.sendDraft())
        model.cancelSelection(next)
        assertTrue(session.sendDraft())
        model.closeAndAwait()
    }

    @Test fun `parent cancellation retires an unreturned picker reservation without an explicit model close`() = runTest {
        val wire = FakeWire().apply { stub("session/prompt") { value("""{"accepted":true}""") } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session"); session.updateDraft("session", "send")
        val parent = SupervisorJob(backgroundScope.coroutineContext[Job])
        val model = NativeFileAttachmentsModel(wire, session, inputs, CoroutineScope(backgroundScope.coroutineContext + parent),
            NativeFileAttachmentLimits(4, 4096, 8), StandardTestDispatcher(testScheduler))
        val selected = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE))
        parent.cancelAndJoin()
        val source = Source(); model.accept(selected, source).join()
        assertEquals(0, source.opens)
        assertTrue(session.sendDraft())
        assertNull(model.prepare())
    }

    @Test fun `one owner preserves mixed file image order and accepts normalized image metadata`() = runTest {
        val wire = FakeWire().apply { stub("fileUploads/uploadImage") { value(imageResult()) } }
        val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val first = SessionFileAttachment("first", "first-id", "first.bin", 2)
        session.addAttachment("session", first)
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope,
            NativeFileAttachmentLimits(4, 4096, 2), StandardTestDispatcher(testScheduler))
        val selection = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE))
        assertNull(model.prepare())
        val source = Source()
        model.accept(selection, source).join(); model.accept(selection, source).join()
        assertEquals(1, source.opens); assertEquals(1, source.closes)
        val args = wire.calls.single().second
        assertEquals("fileUploads/uploadImage", wire.calls.single().first)
        assertEquals("image/png", WireShape.string(args.getValue("request"), "mediaType"))
        val attachments = session.input.value.drafts.getValue("session").attachments
        assertEquals(first, attachments[0])
        assertEquals(SessionImageAttachment("photo", "image-id", "image/png", 69, 1, 1, "红.png", SessionImageDimensions(2, 3)), attachments[1])
        assertNull(model.prepare())
        assertEquals(NativeFileAttachmentIssue.TOO_MANY_FILES, model.state.value.issue)
        model.closeAndAwait()
    }

    @Test fun `unknown media and oversize image data fail before upload and close opened sources`() = runTest {
        val wire = FakeWire(); val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 8), StandardTestDispatcher(testScheduler))
        for (type in listOf(null, "image/heic", "application/octet-stream", "image/svg+xml")) {
            val source = Source(type)
            model.accept(assertNotNull(model.prepare(NativeAttachmentKind.IMAGE)), source).join()
            assertEquals(NativeFileAttachmentIssue.UNSUPPORTED_IMAGE, model.state.value.issue)
            assertEquals(0, source.opens)
        }
        val large = Source(bytes = ByteArray(5))
        model.accept(assertNotNull(model.prepare(NativeAttachmentKind.IMAGE)), large).join()
        assertEquals(NativeFileAttachmentIssue.TOO_LARGE, model.state.value.issue)
        assertEquals(1, large.closes); assertTrue(wire.calls.isEmpty()); assertTrue(inputs.state.value.drafts.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `invalid normalized image receipts never become draft metadata`() = runTest {
        val wire = FakeWire(); val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 8), StandardTestDispatcher(testScheduler))
        val valid = Json.parseToJsonElement(imageResult()).jsonObject
        val image = valid.getValue("image").jsonObject
        val mutations = listOf("bytes" to JsonPrimitive(-1), "width" to JsonPrimitive(0), "height" to JsonPrimitive(1.5),
            "mediaType" to JsonPrimitive("image/heic"), "name" to JsonNull,
            "originalDimensions" to buildJsonObject { put("width", 1); put("height", 0) })
        val variants = mutations.map { JsonObject(image + it) } + JsonObject(image - "attachmentId")
        for (invalid in variants) {
            wire.stub("fileUploads/uploadImage") { WireValue.fromJsonElement(JsonObject(valid + ("image" to invalid))) }
            model.accept(assertNotNull(model.prepare(NativeAttachmentKind.IMAGE)), Source()).join()
            assertEquals(ConnectionFailure.INVALID_RESPONSE, model.state.value.failure)
            assertTrue(inputs.state.value.drafts.isEmpty())
        }
        model.closeAndAwait()
    }

    @Test fun `old photo selections stay retired after returning to the Session and Host close awaits upload cleanup`() = runTest {
        val wire = FakeWire(); val inputs = CompanionInputState.memory()
        val session = SessionModel(wire, backgroundScope, inputs = inputs); session.openSession("session")
        val model = NativeFileAttachmentsModel(wire, session, inputs, backgroundScope, NativeFileAttachmentLimits(4, 4096, 8), StandardTestDispatcher(testScheduler))
        val stale = assertNotNull(model.prepare(NativeAttachmentKind.IMAGE))
        session.openSession("other"); session.openSession("session")
        val untouched = Source(); model.accept(stale, untouched).join()
        assertEquals(0, untouched.opens)
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        wire.stub("fileUploads/uploadImage") { entered.complete(Unit); withContext(NonCancellable) { release.await() }; value(imageResult()) }
        model.accept(assertNotNull(model.prepare(NativeAttachmentKind.IMAGE)), Source())
        entered.await()
        val close = model.close(); runCurrent(); assertFalse(close.isCompleted)
        release.complete(Unit); close.await()
        assertTrue(inputs.state.value.drafts.isEmpty()); assertNull(model.prepare(NativeAttachmentKind.IMAGE))
    }
}
