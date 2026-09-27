package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.PlainCredentialsCipher
import ai.deepseek.dsh.link.WireValue
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeFileDraftTest {
    private val first = SessionFileAttachment("receipt-first", "attachment-first", "报告.txt", 3)
    private val second = SessionFileAttachment("receipt-second", "attachment-second", "empty.bin", 0)
    private val directories = mutableListOf<File>()
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun accepted() = value("""{"accepted":true}""")
    private fun request(call: Pair<String, Map<String, WireValue>>) = call.second.getValue("request")
    private fun content(call: Pair<String, Map<String, WireValue>>) = WireShape.array(request(call), "content")!!

    @AfterTest fun cleanup() { directories.forEach { it.deleteRecursively() } }

    @Test fun `text and attachment edits preserve the other input and rotate only changed intent identities`() = runTest {
        val model = SessionModel(FakeWire(), backgroundScope)
        model.openSession("session")
        model.updateDraft("session", "keep text")
        val text = model.input.value.drafts.getValue("session")
        assertTrue(model.addFileAttachment("session", first))
        val attached = model.input.value.drafts.getValue("session")
        assertEquals(text.text, attached.text)
        assertEquals(listOf(first), attached.files)
        assertNotEquals(text.requestId, attached.requestId)
        model.updateDraft("session", "keep text")
        assertFalse(model.addFileAttachment("session", first))
        model.removeFileAttachment("session", "absent")
        assertEquals(attached, model.input.value.drafts["session"])

        assertTrue(model.addFileAttachment("session", second))
        val both = model.input.value.drafts.getValue("session")
        assertNotEquals(attached.requestId, both.requestId)
        model.removeFileAttachment("session", first.receiptId)
        val remaining = model.input.value.drafts.getValue("session")
        assertEquals("keep text", remaining.text)
        assertEquals(listOf(second), remaining.files)
        assertNotEquals(both.requestId, remaining.requestId)
        model.updateDraft("session", "")
        val fileOnly = model.input.value.drafts.getValue("session")
        assertEquals(listOf(second), fileOnly.files)
        assertEquals("", fileOnly.text)
        assertNotEquals(remaining.requestId, fileOnly.requestId)
        model.removeFileAttachment("session", second.receiptId)
        assertFalse("session" in model.input.value.drafts)
    }

    @Test fun `late attachments cannot enter another Session or change a retired composer`() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope)
        assertFalse(model.addFileAttachment("first", first))
        model.openSession("first")
        assertTrue(model.addFileAttachment("first", first))
        val retained = model.input.value.drafts.getValue("first")
        model.openSession("second")
        assertFalse(model.addFileAttachment("first", second))
        model.removeFileAttachment("first", first.receiptId)
        assertEquals(retained, model.input.value.drafts["first"])
        assertFalse("second" in model.input.value.drafts)
        assertFalse(model.sendDraft())
        model.closeAndAwait()
        assertFalse(model.addFileAttachment("second", second))
        assertTrue(wire.calls.isEmpty())
    }

    @Test fun `file-only prompts submit receipt references and clear their exact accepted draft`() = runTest {
        val wire = FakeWire().apply { stub("session/prompt") { accepted() } }
        val model = SessionModel(wire, backgroundScope)
        model.openSession("session")
        model.addFileAttachment("session", first)
        model.addFileAttachment("session", second)
        val original = model.input.value.drafts.getValue("session")
        assertTrue(model.sendDraft())
        assertEquals(original.requestId, WireShape.string(request(wire.calls.single()), "requestId"))
        assertEquals(listOf(
            value("""{"type":"text","text":""}"""),
            value("""{"type":"file","receiptId":"receipt-first"}"""),
            value("""{"type":"file","receiptId":"receipt-second"}"""),
        ), content(wire.calls.single()))
        assertTrue(model.input.value.drafts.isEmpty())
        assertTrue(model.input.value.pendingPrompts.isEmpty())
    }

    @Test fun `an acknowledgement preserves a newer attachment intent and another Session draft`() = runTest {
        val reply = CompletableDeferred<WireValue>()
        val wire = FakeWire().apply { stub("session/prompt") { reply.await() } }
        val model = SessionModel(wire, backgroundScope)
        model.openSession("first")
        model.updateDraft("first", "submitted")
        model.addFileAttachment("first", first)
        val original = model.input.value.drafts.getValue("first")
        val sending = async { model.sendDraft() }
        runCurrent()
        model.addFileAttachment("first", second)
        val newer = model.input.value.drafts.getValue("first")
        model.openSession("second")
        model.addFileAttachment("second", second)
        val foreign = model.input.value.drafts.getValue("second")
        reply.complete(accepted())
        assertTrue(sending.await())
        assertNotEquals(original.requestId, newer.requestId)
        assertEquals(newer, model.input.value.drafts["first"])
        assertEquals(foreign, model.input.value.drafts["second"])
        assertTrue(model.input.value.pendingPrompts.isEmpty())
        assertEquals("first", WireShape.string(request(wire.calls.single()), "sessionId"))
        assertEquals(value("""{"type":"file","receiptId":"receipt-first"}"""), content(wire.calls.single()).last())
    }

    @Test fun `cancelled file intent restores from disk and explicitly retries its original target and complete content`() = runTest {
        val directory = Files.createTempDirectory("native-file-draft-").toFile().also(directories::add)
        val store = FileCompanionInputStore(directory, CompanionInputPrincipal("host", "pin", "device"), PlainCredentialsCipher, 32_768)
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        model.openSession("first")
        model.updateDraft("first", "original text")
        model.addFileAttachment("first", first)
        val original = model.input.value.drafts.getValue("first")
        wire.stub("session/prompt") {
            assertEquals(original, store.load()!!.pendingPrompts.getValue(original.requestId).draft)
            awaitCancellation()
        }
        val sending = async { model.sendDraft() }
        runCurrent()
        assertFalse(model.sendDraft())
        model.updateDraft("first", "new text")
        model.addFileAttachment("first", second)
        val newer = model.input.value.drafts.getValue("first")
        inputs.flush()
        sending.cancelAndJoin()
        assertFalse(model.sending.value)
        model.closeAndAwait()
        inputs.retireAndAwait()

        val restored = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val next = SessionModel(wire, backgroundScope, inputs = restored)
        next.restoreSelection()
        assertEquals(original, next.input.value.pendingPrompts.getValue(original.requestId).draft)
        assertEquals(newer, next.input.value.drafts["first"])
        assertEquals(1, wire.calls.size)
        next.openSession("second")
        next.updateDraft("second", "other Session")
        wire.stub("session/prompt") { accepted() }
        next.retryPrompt(original.requestId).join()
        restored.flush()
        assertEquals(2, wire.calls.size)
        assertEquals(wire.calls.first(), wire.calls.last())
        assertEquals(newer, store.load()!!.drafts["first"])
        assertEquals("other Session", store.load()!!.drafts["second"]?.text)
        assertTrue(store.load()!!.pendingPrompts.isEmpty())
        next.closeAndAwait()
        restored.retireAndAwait()
    }

    @Test fun `invalid acknowledgements and missing staged files retain the complete pending intent`() = runTest {
        val wire = FakeWire().apply {
            stubSequence("session/prompt", listOf(
                { value("""{"accepted":false}""") },
                { throw LinkClientException.Refused("FILE_NOT_STAGED", "File receipt expired", WireValue.NullValue) },
            ))
        }
        val model = SessionModel(wire, backgroundScope)
        model.openSession("session")
        model.addFileAttachment("session", first)
        val original = model.input.value.drafts.getValue("session")
        assertFalse(model.sendDraft())
        model.retryPrompt(original.requestId).join()
        assertEquals(original, model.input.value.drafts["session"])
        assertEquals(original, model.input.value.pendingPrompts.getValue(original.requestId).draft)
        assertEquals(wire.calls.first(), wire.calls.last())
        assertEquals("FILE_NOT_STAGED", model.sendFailure.value?.refusal?.code)
    }

    @Test fun `a recorded receipt from another Session cannot clear a retained file intent`() = runTest {
        val inputs = CompanionInputState.memory()
        val original = SessionDraft("", "prompt-id", listOf(first))
        inputs.update { it.copy(drafts = mapOf("first" to original), pendingPrompts = mapOf("prompt-id" to PendingPrompt("first", original))) }
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        model.openSession("second")
        runCurrent()
        wire.emit(value("""{"type":"snapshot","header":{"id":"second"},"hasMore":false,"cursor":0,"records":[]}"""))
        wire.emit(value("""{"type":"event","event":{"type":"user/message","seq":1,"time":1759017600000,"data":{"content":[],"source":{"kind":"user","rpcId":"prompt-id"}}}}"""))
        runCurrent()
        assertEquals(1, model.state.items.size)
        assertEquals(original, model.input.value.drafts["first"])
        assertEquals(original, model.input.value.pendingPrompts["prompt-id"]?.draft)
        assertTrue(wire.calls.isEmpty())
    }
}
