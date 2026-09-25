package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.*

class NativeInteractionModelTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun ready(ids: String = "\"event\"") = value("""{"type":"ready","clientId":"client","pendingInteractionIds":[$ids]}""")
    private fun question(revision: Int = 1) = value("""{"type":"waterfall","event":"user-questions/request","eventId":"event","agentId":"activation","interaction":{"requestId":"event","sessionId":"session","type":"question","requiredPermission":"question.respond","status":"pending","revision":$revision},"request":{"questions":[{"id":"color","question":"Which color?","multiSelect":true,"options":[{"label":"Blue"},{"label":"Green"}]}]}}""")

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
