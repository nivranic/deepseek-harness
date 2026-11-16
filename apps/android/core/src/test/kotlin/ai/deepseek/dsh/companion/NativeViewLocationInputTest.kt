package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeViewLocationInputTest {
    private val file = SessionFileAttachment("file-receipt", "file-id", "报告.txt", 3)
    private val image = SessionImageAttachment("image-receipt", "image-id", "image/png", 69, 1, 1, "红.png")
    private val nextFile = SessionFileAttachment("next-receipt", "next-id", "new.bin", 0)
    private val first = SessionDraft("first input", "first-intent", listOf(file, image))
    private val target = SessionDraft("target input", "target-intent", listOf(image, file))
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun snapshot(sessionId: String, requestId: String? = null): WireValue {
        val source = requestId?.let { """, "source":{"kind":"user","rpcId":"$it"}""" } ?: ""
        return value("""{"type":"snapshot","header":{"id":"$sessionId"},"cursor":0,"hasMore":false,"records":[{"type":"event","event":{"seq":0,"type":"user/message","data":{"content":[{"type":"text","text":"recorded"}]$source}}}]}""")
    }
    private fun retained() = CompanionInputSnapshot(
        drafts = mapOf("first" to first, "target" to target),
        pendingPrompts = mapOf(first.requestId to PendingPrompt("first", first), target.requestId to PendingPrompt("target", target)),
        lastSessionId = "first",
    )

    @Test fun `navigation preserves both complete attachment drafts and pending prompts without submission`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val original = retained()
        inputs.update { original }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        model.openSession("first"); runCurrent()
        wire.emit(snapshot("first")); runCurrent()
        wire.clearFrames()
        val opening = async { model.openViewLocation(NativeViewLocation("host", "target", 0), "host") }
        runCurrent()
        wire.emit(snapshot("target"))
        opening.await()
        assertEquals(original.copy(lastSessionId = "target"), inputs.state.value)
        assertEquals(0L, model.viewAnchor.value?.seq)
        assertTrue(wire.calls.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `navigation reconciles an accepted complete intent only in its own Session`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val original = retained()
        inputs.update { original }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        val opening = async { model.openViewLocation(NativeViewLocation("host", "target", 0), "host") }
        runCurrent()
        wire.emit(snapshot("target", target.requestId))
        opening.await()
        assertEquals(original.copy(drafts = mapOf("first" to first),
            pendingPrompts = mapOf(first.requestId to PendingPrompt("first", first)), lastSessionId = "target"), inputs.state.value)
        assertTrue(wire.calls.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `navigation receipt reconciliation preserves newer text attachments and request identity`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val newer = SessionDraft("newer target edit", "newer-intent", listOf(image, nextFile))
        val original = retained().copy(drafts = mapOf("first" to first, "target" to newer))
        inputs.update { original }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        val opening = async { model.openViewLocation(NativeViewLocation("host", "target", 0), "host") }
        runCurrent()
        wire.emit(snapshot("target", target.requestId))
        opening.await()
        assertEquals(original.copy(pendingPrompts = mapOf(first.requestId to PendingPrompt("first", first)),
            lastSessionId = "target"), inputs.state.value)
        assertTrue(wire.calls.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `navigation during send keeps its original complete target and preserves later drafts on acknowledgement`() = runTest {
        val reply = CompletableDeferred<WireValue>()
        val wire = FakeWire().apply { stub("session/prompt") { reply.await() } }
        val inputs = CompanionInputState.memory()
        inputs.update { retained().copy(pendingPrompts = emptyMap()) }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        model.openSession("first"); runCurrent()
        wire.emit(snapshot("first")); runCurrent()
        val sending = async { model.sendDraft() }
        runCurrent()
        assertEquals(PendingPrompt("first", first), inputs.state.value.pendingPrompts[first.requestId])
        model.updateDraft("first", "edited during send")
        model.addAttachment("first", nextFile)
        val newer = inputs.state.value.drafts.getValue("first")
        wire.clearFrames()
        val opening = async { model.openViewLocation(NativeViewLocation("host", "target", 0), "host") }
        runCurrent()
        wire.emit(snapshot("target"))
        opening.await()
        assertTrue(model.sending.value)
        assertFalse(sending.isCompleted)
        assertFalse(model.sendDraft())
        assertEquals(1, wire.calls.size)
        reply.complete(value("""{"accepted":true}"""))
        assertTrue(sending.await())
        assertEquals(mapOf("first" to newer, "target" to target), inputs.state.value.drafts)
        assertTrue(inputs.state.value.pendingPrompts.isEmpty())
        val request = wire.calls.single().second.getValue("request")
        assertEquals("session/prompt", wire.calls.single().first)
        assertEquals("first", WireShape.string(request, "sessionId"))
        assertEquals(first.requestId, WireShape.string(request, "requestId"))
        assertEquals(listOf(value("""{"type":"text","text":"first input"}"""),
            value("""{"type":"file","receiptId":"file-receipt"}"""),
            value("""{"type":"staged-image","receiptId":"image-receipt"}""")), WireShape.array(request, "content"))
        model.closeAndAwait()
    }

    @Test fun `navigation invalidates a staged Share batch without replacing either Session input`() = runTest {
        val fixture = ShareFixture(this)
        fixture.inputs.update { CompanionInputSnapshot(drafts = mapOf("session" to first, "target" to target),
            pendingPrompts = mapOf(first.requestId to PendingPrompt("session", first))) }
        fixture.open()
        val retained = fixture.inputs.state.value
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        fixture.wire.stub("fileUploads/upload") { entered.complete(Unit); release.await(); fixture.receipt(image = false) }
        val importing = fixture.importBatch("shared text", listOf(NativeShareItem(SharedSource())))
        val result = async { importing.awaitResult() }
        try {
            entered.await()
            val opening = async { fixture.session.openViewLocation(NativeViewLocation("host", "target", 0), "host") }
            runCurrent()
            fixture.wire.emit(snapshot("target"))
            opening.await()
            assertFalse(result.isCompleted)
            release.complete(Unit)
            assertEquals(NativeShareIssue.STALE_TARGET, assertIs<NativeShareResult.NotAdopted>(result.await()).issue)
            assertEquals(retained.copy(lastSessionId = "target"), fixture.inputs.state.value)
            assertEquals(listOf("fileUploads/upload"), fixture.wire.calls.map { it.first })
        } finally {
            release.complete(Unit)
            fixture.model.closeAndAwait()
            fixture.session.closeAndAwait()
        }
    }
}
