package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Interaction projections recognize the Host's exact forward names and agent attribution. */
class InteractionEventCompatibilityTest {
    private fun frame(event: String, overrides: Map<String, String?> = emptyMap()): WireValue {
        val resource = checkNotNull(javaClass.getResource("/fixtures/remote-event-waterfall.json"))
        val fields = Json.parseToJsonElement(resource.readText()).jsonObject.toMutableMap()
        fields["event"] = JsonPrimitive(event)
        fields["agentId"] = JsonPrimitive("host-agent")
        fields["sessionId"] = JsonPrimitive("ignored-top-level")
        fields["request"] = JsonObject(fields.getValue("request").jsonObject +
            ("sessionId" to JsonPrimitive("ignored-request")))
        for ((name, value) in overrides) {
            if (value == null) fields.remove(name) else fields[name] = JsonPrimitive(value)
        }
        return WireValue.fromJsonElement(JsonObject(fields))
    }

    @Test
    fun knownForwardsUseHostAgentIdentity() = runTest {
        for ((event, kind) in listOf(
            "approval/request" to PendingInteraction.Kind.APPROVAL,
            "user-questions/request" to PendingInteraction.Kind.QUESTION,
        )) {
            val model = InteractionModel(FakeWire(), backgroundScope)
            val input = frame(event)
            model.collect(input)
            assertEquals(kind, model.inbox.value.single().kind, event)
            assertEquals("host-agent", model.inbox.value.single().sessionId, event)
            val expected = if (kind == PendingInteraction.Kind.APPROVAL)
                CompanionPush.ApprovalWaiting("host-agent", "event-approval-1")
            else CompanionPush.QuestionWaiting("host-agent", "event-approval-1")
            assertEquals(expected, pushFromForward(input), event)
        }
    }

    @Test
    fun unknownNamesCannotCreateInteractionsOrPushes() = runTest {
        for (event in listOf(
            "future/approval/request", "future/user-questions/request", "approval/request/future",
            "approval/requested", "question/request", "question/requested", "future/approval-question", "",
        )) {
            val model = InteractionModel(FakeWire(), backgroundScope)
            val input = frame(event)
            model.collect(input)
            assertEquals(emptyList(), model.inbox.value, event)
            assertNull(pushFromForward(input), event)
        }
    }

    @Test
    fun onlyWaterfallForwardsCreatePushes() = runTest {
        for (type in listOf("emit", "ready", "cancel", "future", "", null)) {
            val model = InteractionModel(FakeWire(), backgroundScope)
            val input = frame("approval/request", mapOf("type" to type))
            model.collect(input)
            assertEquals(emptyList(), model.inbox.value, type)
            assertNull(pushFromForward(input), type)
        }
    }

    @Test
    fun forwardsNeedNonemptyEventAndAgentIdentities() = runTest {
        for (field in listOf("agentId", "eventId")) {
            for (value in listOf("", null)) {
                val model = InteractionModel(FakeWire(), backgroundScope)
                val input = frame("approval/request", mapOf(field to value))
                model.collect(input)
                assertEquals(emptyList(), model.inbox.value, field)
                assertNull(pushFromForward(input), field)
            }
        }
    }
}
