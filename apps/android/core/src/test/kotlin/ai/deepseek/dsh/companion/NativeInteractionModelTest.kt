package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import ai.deepseek.dsh.link.LinkClientException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NativeInteractionModelTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun ready(ids: String = "\"event\"") = value("""{"type":"ready","clientId":"client","pendingInteractionIds":[$ids]}""")
    private fun question(revision: Int = 1) = value("""{"type":"waterfall","event":"user-questions/request","eventId":"event","agentId":"activation","interaction":{"requestId":"event","sessionId":"session","type":"question","requiredPermission":"question.respond","status":"pending","revision":$revision},"request":{"questions":[{"id":"color","question":"Which color?","multiSelect":true,"options":[{"label":"Blue"},{"label":"Green"}]}]}}""")

    @Test fun `permanent and unknown stream refusals stop automatic reconnect`() = runTest {
        for (code in listOf("device/already-revoked", "gateway/permission-denied", "host/protocol-unsupported", "future/refusal")) {
            var attempts = 0
            val wire = object : WireDriving {
                override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("no mutation")
                override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
                    attempts++
                    throw LinkClientException.Refused(code, "refused")
                }
            }
            val model = InteractionModel(wire, backgroundScope, 1000)
            model.startWatching(); runCurrent()
            advanceTimeBy(5000); runCurrent()
            assertEquals(1, attempts, code)
            assertEquals(ConnectionState.ENDED, model.connectionSnapshot.state)
            assertEquals("", model.clientId.value)
            model.stopWatchingAndAwait()
        }
    }

    @Test fun `temporary Host refusal reconnects and observes a new event client`() = runTest {
        var attempts = 0
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("no mutation")
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
                if (++attempts == 1) throw LinkClientException.Refused("gateway/host-not-ready", "starting")
                emit(ready()); awaitCancellation()
            }
        }
        val model = InteractionModel(wire, backgroundScope, 1000)
        model.startWatching(); runCurrent()
        assertEquals(1, attempts)
        advanceTimeBy(1000); runCurrent()
        assertEquals(2, attempts)
        assertEquals("client", model.clientId.value)
        model.stopWatchingAndAwait()
        advanceTimeBy(5000); runCurrent()
        assertEquals(2, attempts)
    }

    @Test fun `Question sends structured labels and custom text with Host revision`() = runTest {
        val wire = FakeWire()
        val model = InteractionModel(wire, backgroundScope)
        model.collect(ready()); model.collect(question(7))
        val pending = model.inbox.value.single()
        assertEquals("session", pending.sessionId)
        model.answerQuestions(pending, listOf(CompanionQuestionAnswer("color", listOf("Blue"), "Include accessibility notes")))
        val args = wire.calls.single().second
        assertEquals(WireValue.NumberValue(7.0), args["interactionRevision"])
        val result = (args["outcome"] as WireValue.ObjectValue).entries["value"]!!
        assertEquals(value("""{"answers":[{"id":"color","selected":["Blue"],"custom":"Include accessibility notes"}]}"""), result)
        assertTrue(model.inbox.value.isEmpty())
    }

    @Test fun `refused answers retain their card and wait for explicit retry`() = runTest {
        val wire = FakeWire()
        wire.stub("\$events/result") { throw LinkClientException.Refused("gateway/permission-denied", "private Host detail") }
        val model = InteractionModel(wire, backgroundScope)
        model.collect(ready()); model.collect(question())
        val pending = model.inbox.value.single()
        val answer = listOf(CompanionQuestionAnswer("color", listOf("Blue")))
        model.answerQuestions(pending, answer)
        assertEquals("Host 拒绝了本次调用", model.lastRefusal.value)
        assertEquals(listOf(pending), model.inbox.value)
        advanceTimeBy(5000); runCurrent()
        assertEquals(1, wire.calls.size)
        wire.stub("\$events/result") { WireValue.NullValue }
        model.answerQuestions(pending, answer)
        assertNull(model.lastRefusal.value)
        assertTrue(model.inbox.value.isEmpty())
        assertEquals(2, wire.calls.size)
    }

    @Test fun `ready snapshot removes closed interactions and a stale revision cannot reply`() = runTest {
        val wire = FakeWire()
        val model = InteractionModel(wire, backgroundScope)
        model.collect(ready()); model.collect(question())
        val old = model.inbox.value.single()
        model.collect(question(2))
        model.answerQuestions(old, listOf(CompanionQuestionAnswer("color", listOf("Blue"))))
        assertTrue(wire.calls.isEmpty())
        assertEquals(2, model.inbox.value.single().revision)
        model.collect(ready(""))
        assertTrue(model.inbox.value.isEmpty())
    }

    @Test fun `Boolean approval cannot answer a Question and unknown labels never dispatch`() = runTest {
        val wire = FakeWire()
        val model = InteractionModel(wire, backgroundScope)
        model.collect(ready()); model.collect(question())
        val pending = model.inbox.value.single()
        assertFailsWith<IllegalArgumentException> { model.answer(pending, true) }
        assertFailsWith<IllegalArgumentException> {
            model.answerQuestions(pending, listOf(CompanionQuestionAnswer("color", listOf("not-offered"))))
        }
        assertTrue(wire.calls.isEmpty())
    }
}
