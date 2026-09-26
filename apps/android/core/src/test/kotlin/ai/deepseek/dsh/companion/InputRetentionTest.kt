package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class InputRetentionTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun accepted() = value("""{"accepted":true}""")
    private fun request(call: Pair<String, Map<String, WireValue>>) = call.second.getValue("request")
    private fun ready(ids: String = "\"event\"") = value("""{"type":"ready","clientId":"current-client","pendingInteractionIds":[$ids]}""")
    private fun question(revision: Int = 1) = value("""{"type":"waterfall","event":"user-questions/request","eventId":"event","agentId":"activation","interaction":{"requestId":"event","sessionId":"session","type":"question","requiredPermission":"question.respond","status":"pending","revision":$revision},"request":{"questions":[{"id":"color","question":"Which color?","multiSelect":true,"options":[{"label":"Blue"},{"label":"Green"}]}]}}""")

    @Test fun `unconfirmed prompt retains text and explicitly retries the same Host request identity`() = runTest {
        val wire = FakeWire()
        wire.stub("session/prompt") { throw LinkClientException.Carrier(0, "connection lost") }
        val model = SessionModel(wire, backgroundScope)
        model.openSession("first")
        model.updateDraft("first", "中文 draft")
        val original = model.drafts.value.getValue("first")
        assertFalse(model.sendDraft())
        assertEquals(original, model.drafts.value["first"])
        assertEquals(ConnectionFailure.TRANSPORT, model.sendFailure.value?.category)
        advanceTimeBy(10_000)
        assertEquals(1, wire.calls.size)
        wire.stub("session/prompt") { accepted() }
        assertTrue(model.sendDraft())
        assertTrue(model.drafts.value.isEmpty())
        assertNull(model.sendFailure.value)
        assertEquals(listOf(original.requestId, original.requestId), wire.calls.map { WireShape.string(request(it), "requestId") })
    }

    @Test fun `acknowledgement clears only the submitted version and keeps the original target`() = runTest {
        val reply = CompletableDeferred<WireValue>()
        val wire = FakeWire()
        wire.stub("session/prompt") { reply.await() }
        val model = SessionModel(wire, backgroundScope)
        model.openSession("first")
        model.updateDraft("first", "submitted")
        val submission = async { model.sendDraft() }
        runCurrent()
        model.updateDraft("first", "new edit")
        model.openSession("second")
        model.updateDraft("second", "different Session")
        reply.complete(accepted())
        assertTrue(submission.await())
        assertEquals("first", WireShape.string(request(wire.calls.single()), "sessionId"))
        assertEquals("new edit", model.drafts.value["first"]?.text)
        assertEquals("different Session", model.drafts.value["second"]?.text)
    }

    @Test fun `cancelled and duplicate submissions do not clear or replay input`() = runTest {
        val wire = FakeWire()
        wire.stub("session/prompt") { awaitCancellation() }
        val model = SessionModel(wire, backgroundScope)
        model.openSession("first")
        model.updateDraft("first", "keep me")
        val submission = async { model.sendDraft() }
        runCurrent()
        assertFalse(model.sendDraft())
        assertEquals(1, wire.calls.size)
        submission.cancelAndJoin()
        assertTrue(submission.isCancelled)
        assertFalse(model.sending.value)
        assertEquals("keep me", model.drafts.value["first"]?.text)
        advanceTimeBy(10_000)
        assertEquals(1, wire.calls.size)
    }

    @Test fun `invalid acknowledgement and Host refusal preserve the draft and refusal details`() = runTest {
        val wire = FakeWire()
        val details = value("""{"reason":"fixture"}""")
        wire.stubSequence("session/prompt", listOf(
            { value("""{"accepted":false}""") },
            { throw LinkClientException.Refused("gateway/permission-denied", "Host detail", details) },
        ))
        val model = SessionModel(wire, backgroundScope)
        model.openSession("first"); model.updateDraft("first", "retain")
        assertFalse(model.sendDraft())
        assertEquals(ConnectionFailure.INVALID_RESPONSE, model.sendFailure.value?.category)
        assertFalse(model.sendDraft())
        assertEquals(GatewayFailureEnvelope("gateway/permission-denied", "Host detail", details), model.sendFailure.value?.refusal)
        assertEquals("retain", model.drafts.value["first"]?.text)
    }

    @Test fun `Question choices and custom text survive a refused reply and a new event client`() = runTest {
        val wire = FakeWire()
        wire.stub("\$events/result") { throw LinkClientException.Carrier(0, "connection lost") }
        val model = InteractionModel(wire, backgroundScope)
        model.collect(ready()); model.collect(question())
        val pending = model.inbox.value.single()
        val answer = CompanionQuestionAnswer("color", listOf("Blue"), "custom text")
        model.updateAnswer(pending, answer)
        model.answerQuestions(pending, model.drafts.value.getValue(pending.questionDraftKey))
        model.stopWatching()
        model.collect(ready()); model.collect(question())
        assertEquals(listOf(answer), model.drafts.value[pending.questionDraftKey])
        advanceTimeBy(10_000)
        assertEquals(1, wire.calls.size)
        wire.stub("\$events/result") { WireValue.NullValue }
        model.answerQuestions(pending, model.drafts.value.getValue(pending.questionDraftKey))
        assertTrue(model.drafts.value.isEmpty())
        assertTrue(model.inbox.value.isEmpty())
        assertEquals(2, wire.calls.size)
    }

    @Test fun `new revisions cancellation and authoritative snapshots retire obsolete answers`() = runTest {
        val wire = FakeWire()
        val model = InteractionModel(wire, backgroundScope)
        model.collect(ready()); model.collect(question())
        val first = model.inbox.value.single()
        val answer = CompanionQuestionAnswer("color", listOf("Blue"))
        model.updateAnswer(first, answer)
        model.collect(question(2))
        assertTrue(model.drafts.value.isEmpty())
        model.updateAnswer(first, answer)
        assertTrue(model.drafts.value.isEmpty())
        model.updateAnswer(model.inbox.value.single(), answer)
        model.collect(value("""{"type":"cancel","eventId":"event"}"""))
        assertTrue(model.drafts.value.isEmpty())
        model.collect(question(3))
        model.updateAnswer(model.inbox.value.single(), answer)
        model.collect(ready(""))
        assertTrue(model.drafts.value.isEmpty())
        assertTrue(wire.calls.isEmpty())
    }

    @Test fun `replacing the connection retires pending sends and does not adopt another identity input`() = runTest {
        val wire = FakeWire()
        wire.stub("session/prompt") { awaitCancellation() }
        val first = CompanionModelSet(wire, backgroundScope)
        first.session.openSession("same-id"); first.session.updateDraft("same-id", "private input")
        val sending = async { first.session.sendDraft() }
        runCurrent()
        first.closeAndAwait(); sending.join()
        assertTrue(sending.isCancelled)
        val replacement = CompanionModelSet(wire, backgroundScope)
        replacement.session.openSession("same-id")
        assertTrue(replacement.session.drafts.value.isEmpty())
        assertFalse(replacement.session.sendDraft())
        assertEquals(1, wire.calls.size)
        replacement.closeAndAwait()
    }

    @Test fun `UI caller disposal leaves a model owned prompt waiting for its acknowledgement`() = runTest {
        val reply = CompletableDeferred<WireValue>()
        val wire = FakeWire()
        wire.stub("session/prompt") { reply.await() }
        val model = SessionModel(wire, backgroundScope)
        model.openSession("session"); model.updateDraft("session", "keep until acknowledged")
        lateinit var submission: Job
        val ui = launch(start = CoroutineStart.UNDISPATCHED) {
            submission = model.submitDraft()
            awaitCancellation()
        }
        ui.cancelAndJoin()
        assertTrue(model.sending.value)
        assertFalse(submission.isCancelled)
        assertEquals(1, wire.calls.size)
        reply.complete(accepted()); submission.join()
        assertTrue(model.drafts.value.isEmpty())
    }

    @Test fun `UI caller disposal does not cancel a Question reply or lose its retained answers`() = runTest {
        val reply = CompletableDeferred<WireValue>()
        val wire = FakeWire()
        wire.stub("\$events/result") { reply.await() }
        val model = InteractionModel(wire, backgroundScope)
        model.collect(ready()); model.collect(question())
        val pending = model.inbox.value.single()
        val answer = CompanionQuestionAnswer("color", listOf("Blue"), "retained")
        lateinit var submission: Job
        val ui = launch(start = CoroutineStart.UNDISPATCHED) {
            submission = model.submitQuestions(pending, listOf(answer))
            awaitCancellation()
        }
        ui.cancelAndJoin()
        assertTrue(model.answering.value)
        assertEquals(listOf(answer), model.drafts.value[pending.questionDraftKey])
        assertFalse(submission.isCancelled)
        reply.complete(WireValue.NullValue); submission.join()
        assertTrue(model.inbox.value.isEmpty())
        assertTrue(model.drafts.value.isEmpty())
        assertNull(model.replyFailure.value)
    }
}
