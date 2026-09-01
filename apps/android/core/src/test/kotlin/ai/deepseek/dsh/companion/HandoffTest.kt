package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The chapter-40 Handoff L1 device side: snapshot building and sending. */
class HandoffTest {
    private fun foldedState(): LiteDomainState {
        val fold = LiteFold()
        fold.apply("""{"type":"user/message","text":"帮我跑一遍测试"}""".asLiteEvent())
        return fold.state
    }

    private fun String.asLiteEvent(): kotlinx.serialization.json.JsonObject =
        kotlinx.serialization.json.Json.parseToJsonElement(this) as kotlinx.serialization.json.JsonObject

    @Test
    fun buildsTheSnapshotFromTheFoldedState() = runTest {
        val fold = LiteFold()
        for (line in listOf(
            """{"type":"user/message","text":"帮我跑一遍测试"}""",
            """{"type":"assistant/message","text":"需要宿主。"}""",
            """{"type":"plan/changed","active":true}""",
            """{"type":"todo/changed","todos":[{"content":"在宿主继续","status":"pending"}]}""",
            """{"type":"artifact/created","id":"art-1","kind":"report","title":"本机报告"}""",
            """{"type":"artifact/status","id":"art-1","status":"ready"}""",
            """{"type":"tool/call","id":"t1","name":"run_tests","arguments":"{}"}""",
            """{"type":"handoff/requested","capability":"run_tests"}""",
        )) {
            fold.apply(line.asLiteEvent())
        }
        val handoff = LiteHandoff(FakeWire())
        val snapshot = handoff.snapshotValue(
            fold.state,
            sourceSessionId = "lite-7f3a",
            capability = "run_tests",
            provenance = HandoffProvenance(deviceId = "dev-phone", platform = "android", at = 1_782_000_000_000),
            modelPreference = "deepseek-chat",
        )
        val json = snapshot.toJson()
        assertTrue(json.contains("\"sourceSessionId\":\"lite-7f3a\""))
        assertTrue(json.contains("\"sourceRuntime\":\"lite\""))
        assertTrue(json.contains("\"requestedCapability\":\"run_tests\""))
        assertTrue(json.contains("\"role\":\"user\""))
        assertTrue(json.contains("帮我跑一遍测试"))
        assertTrue(json.contains("\"planActive\":true"))
        assertTrue(json.contains("\"content\":\"在宿主继续\""))
        assertTrue(json.contains("\"id\":\"art-1\""))
        assertTrue(json.contains("\"status\":\"ready\""))
        assertTrue(json.contains("\"modelPreference\":\"deepseek-chat\""))
        assertTrue(json.contains("\"deviceId\":\"dev-phone\""))
    }

    @Test
    fun sendsOverTheWireAndReadsTheNewSessionId() = runTest {
        val wire = FakeWire()
        wire.stub("session/handoff") { WireValue.ObjectValue(mapOf("sessionId" to WireValue.StringValue("session-hnd-1"))) }
        val handoff = LiteHandoff(wire)
        val snapshot = handoff.snapshotValue(
            foldedState(),
            sourceSessionId = "lite-1",
            capability = "run_tests",
            provenance = HandoffProvenance("dev-phone", "android", 1L),
        )
        assertEquals("session-hnd-1", handoff.send(snapshot))
        val call = wire.calls.first { it.first == "session/handoff" }
        val request = call.second["request"] as WireValue.ObjectValue
        assertEquals("run_tests", (request.entries["requestedCapability"] as WireValue.StringValue).value)
    }

    @Test
    fun refusalAndMissingAnswerReadAsNull() = runTest {
        val refused = FakeWire()
        refused.stub("session/handoff") { throw ai.deepseek.dsh.link.LinkClientException.Refused("role", "observer may not hand off") }
        assertNull(LiteHandoff(refused).send(LiteHandoff(refused).snapshotValue(foldedState(), "lite-1", "run_tests", HandoffProvenance("d", "android", 1L))))

        val empty = FakeWire()
        empty.stub("session/handoff") { WireValue.ObjectValue(emptyMap()) }
        assertNull(LiteHandoff(empty).send(WireValue.ObjectValue(emptyMap())))
    }
}
