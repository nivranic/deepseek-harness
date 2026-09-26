package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class CompanionInputPersistenceTest {
    private class Store : CompanionInputStoring {
        var saved: CompanionInputSnapshot? = null
        var fail = false
        var onSave: ((CompanionInputSnapshot) -> Unit)? = null
        override fun load() = saved
        override fun save(snapshot: CompanionInputSnapshot) { check(!fail); saved = snapshot; onSave?.invoke(snapshot) }
        override fun preserveAndStartFresh() { saved = CompanionInputSnapshot() }
    }
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun accepted() = value("""{"accepted":true}""")
    private fun ready(client: String = "client", pending: String = "\"event\"") =
        value("""{"type":"ready","clientId":"$client","pendingInteractionIds":[$pending]}""")
    private fun question(revision: Int = 1) = value("""{"type":"waterfall","event":"user-questions/request","eventId":"event","agentId":"activation","interaction":{"requestId":"event","sessionId":"session","type":"question","requiredPermission":"question.respond","status":"pending","revision":$revision},"request":{"questions":[{"id":"color","question":"Which color?","multiSelect":true,"options":[{"label":"Blue"}]}]}}""")

    @Test fun `prompt identity is durable before dispatch and survives a lost acknowledgement`() = runTest {
        val store = Store()
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val wire = FakeWire()
        val admitted = mutableSetOf<String>()
        wire.stub("session/prompt") {
            val request = wire.calls.last().second.getValue("request")
            val id = requireNotNull(WireShape.string(request, "requestId"))
            assertEquals("persist before network", store.saved?.pendingPrompts?.get(id)?.draft?.text)
            if (admitted.add(id)) throw LinkClientException.Carrier(0, "acknowledgement lost")
            accepted()
        }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        model.openSession("session"); model.updateDraft("session", "persist before network")
        assertFalse(model.sendDraft())
        val id = model.input.value.drafts.getValue("session").requestId
        model.closeAndAwait(); inputs.flush(); inputs.retireAndAwait()
        val restored = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val next = SessionModel(wire, backgroundScope, inputs = restored)
        next.restoreSelection()
        assertEquals("session", next.open.value?.sessionId)
        assertEquals(1, wire.calls.size)
        next.retryPrompt(id).join()
        restored.flush()
        assertEquals(setOf(id), admitted)
        assertEquals(2, wire.calls.size)
        assertTrue(store.saved!!.pendingPrompts.isEmpty())
        assertTrue(store.saved!!.drafts.isEmpty())
    }

    @Test fun `failed local checkpoint prevents a prompt from reaching the Host`() = runTest {
        val store = Store().apply { fail = true }
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val wire = FakeWire().apply { stub("session/prompt") { accepted() } }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        model.openSession("session"); model.updateDraft("session", "not yet durable")
        assertFalse(model.sendDraft())
        assertTrue(wire.calls.isEmpty())
        assertEquals(InputPersistenceStatus.WRITE_FAILED, inputs.persistence.value)
        assertEquals("not yet durable", model.input.value.drafts["session"]?.text)
        store.fail = false
        assertTrue(model.sendDraft())
        assertEquals(1, wire.calls.size)
    }

    @Test fun `restoration keeps both an unconfirmed original and newer composer text`() = runTest {
        val store = Store()
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val wire = FakeWire().apply { stub("session/prompt") { awaitCancellation() } }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        model.openSession("session"); model.updateDraft("session", "original")
        val original = model.input.value.drafts.getValue("session")
        val sending = async { model.sendDraft() }
        runCurrent()
        model.updateDraft("session", "newer edit")
        inputs.flush(); sending.cancelAndJoin(); model.closeAndAwait(); inputs.retireAndAwait()
        val restored = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val next = SessionModel(wire, backgroundScope, inputs = restored)
        next.restoreSelection()
        assertEquals(original, next.input.value.pendingPrompts[original.requestId]?.draft)
        assertEquals("newer edit", next.input.value.drafts["session"]?.text)
        assertEquals(1, wire.calls.size)
        wire.stub("session/prompt") { accepted() }
        next.retryPrompt(original.requestId).join()
        assertTrue(next.input.value.pendingPrompts.isEmpty())
        assertEquals("newer edit", next.input.value.drafts["session"]?.text)
    }

    @Test fun `snapshot and live Host receipts retire accepted input without sending it again`() = runTest {
        for (snapshot in listOf(true, false)) {
            val inputs = CompanionInputState.memory()
            val draft = SessionDraft("already received", "receipt-id")
            inputs.update { it.copy(drafts = mapOf("session" to draft), pendingPrompts =
                mapOf(draft.requestId to PendingPrompt("session", draft)), lastSessionId = "session") }
            val wire = FakeWire()
            val model = SessionModel(wire, backgroundScope, inputs = inputs)
            model.restoreSelection(); runCurrent()
            val record = """{"type":"event","event":{"type":"user/message","seq":1,"time":1759017600000,"data":{"id":"message","role":"user","content":[{"type":"text","text":"already received"}],"source":{"kind":"user","rpcId":"receipt-id"}}}}"""
            if (!snapshot) wire.emit(value("""{"type":"snapshot","hasMore":false,"cursor":0,"records":[]}"""))
            wire.emit(value(if (snapshot) """{"type":"snapshot","hasMore":false,"cursor":1,"records":[$record]}""" else record))
            runCurrent()
            assertTrue(model.input.value.pendingPrompts.isEmpty())
            assertTrue(model.input.value.drafts.isEmpty())
            assertTrue(wire.calls.isEmpty())
            model.closeAndAwait()
        }
    }

    @Test fun `a receipt from another Session does not retire the original intent`() = runTest {
        val inputs = CompanionInputState.memory()
        val draft = SessionDraft("private original", "receipt-id")
        inputs.update { it.copy(drafts = mapOf("original" to draft),
            pendingPrompts = mapOf(draft.requestId to PendingPrompt("original", draft))) }
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        model.openSession("other"); runCurrent()
        wire.emit(value("""{"type":"snapshot","hasMore":false,"cursor":0,"records":[]}"""))
        wire.emit(value("""{"type":"event","event":{"type":"user/message","seq":1,"time":1759017600000,"data":{"content":[],"source":{"kind":"user","rpcId":"receipt-id"}}}}"""))
        runCurrent()
        assertEquals(1, model.state.items.size)
        assertEquals(draft, model.input.value.drafts["original"])
        assertEquals(1, model.input.value.pendingPrompts.size)
    }

    @Test fun `Question input restores only into the delivered revision and is durable before reply`() = runTest {
        val store = Store()
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val wire = FakeWire()
        val model = InteractionModel(wire, backgroundScope, inputs = inputs)
        model.collect(ready()); model.collect(question())
        val pending = model.inbox.value.single()
        val answer = CompanionQuestionAnswer("color", listOf("Blue"), "preserved answer")
        model.updateAnswer(pending, answer); inputs.flush(); inputs.retireAndAwait()
        val restored = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val next = InteractionModel(wire, backgroundScope, inputs = restored)
        next.collect(ready("new-client")); next.collect(question())
        assertEquals(listOf(answer), next.input.value.answers[pending.questionDraftKey])
        assertTrue(wire.calls.isEmpty())
        wire.stub("\$events/result") {
            assertEquals(listOf(answer), store.saved?.answers?.get(pending.questionDraftKey))
            WireValue.NullValue
        }
        next.answerQuestions(next.inbox.value.single(), next.input.value.answers.getValue(pending.questionDraftKey))
        restored.flush()
        assertTrue(store.saved!!.answers.isEmpty())
        assertEquals(1, wire.calls.size)
    }

    @Test fun `event client replacement during the storage checkpoint prevents a stale reply`() = runTest {
        val store = Store()
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val wire = FakeWire()
        val model = InteractionModel(wire, backgroundScope, inputs = inputs)
        model.collect(ready()); model.collect(question())
        val pending = model.inbox.value.single()
        store.onSave = { model.collect(ready("replacement")) }
        model.answerQuestions(pending, listOf(CompanionQuestionAnswer("color", listOf("Blue"))))
        assertTrue(wire.calls.isEmpty())
        assertNotNull(model.lastRefusal.value)
        assertTrue(model.input.value.answers.containsKey(pending.questionDraftKey))
    }

    @Test fun `retired writers refuse further edits and explicit checkpoints`() = runTest {
        val store = Store()
        val inputs = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        inputs.update { it.copy(lastSessionId = "session") }; inputs.flush(); inputs.retireAndAwait()
        assertFailsWith<InputPersistenceException> { inputs.update { CompanionInputSnapshot() } }
        assertFailsWith<InputPersistenceException> { inputs.flush() }
        assertEquals("session", store.saved?.lastSessionId)
    }
}
