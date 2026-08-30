package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A scriptable wire double: recorded calls, preset stream frames. */
class FakeWire : WireDriving {
    val calls = mutableListOf<Pair<String, Map<String, WireValue>>>()
    val answers = mutableMapOf<String, suspend () -> WireValue>()
    // Unlimited replay: a late collector still sees every frame the test
    // emitted before the follow job subscribed.
    private val frames = MutableSharedFlow<WireValue>(replay = Int.MAX_VALUE)

    fun stub(method: String, answer: suspend () -> WireValue) {
        answers[method] = answer
    }

    suspend fun emit(frame: WireValue) {
        frames.emit(frame)
    }

    override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
        calls.add(method to args)
        return answers[method]?.invoke() ?: WireValue.NullValue
    }

    override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = frames
}

/** Parse JSON text into the pass-through wire value. */
private fun wire(json: String): WireValue = WireValue.fromJsonElement(Json.parseToJsonElement(json))

private fun event(seq: Int, type: String, data: String): WireValue = wire(
    """{"type":"event","event":{"type":"$type","seq":$seq,"time":1759017600000,"data":$data}}""",
)

class CompanionModelTest {
    @Test
    fun loadsAndProjectsSessionRows() = runTest {
        val wire = FakeWire()
        wire.stub("session/list") {
            wire("""{"items":[{"sessionId":"s1","title":"Refactor","updatedAt":100},{"sessionId":"s2","title":"Notes"}]}""")
        }
        val model = SessionModel(wire, TestScope())
        model.loadSessions()
        assertEquals("ready", model.listState)
        assertEquals(listOf(SessionRow("s1", "Refactor", 100.0), SessionRow("s2", "Notes", null)), model.sessions)
    }

    @Test
    fun openFoldsSnapshotAndEventsIntoTheDomainState() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope)
        model.openSession("s1")
        wire.emit(wire("""{"type":"snapshot","cursor":0,"records":[]}"""))
        wire.emit(event(1, "user/message", """{"id":"m1","role":"user","content":[{"type":"text","text":"你好"}],"source":{"kind":"user"}}"""))
        wire.emit(event(2, "assistant/message", """{"turn":1,"step":1,"message":{"id":"m2","role":"assistant","content":[{"type":"text","text":"已处理。"}],"source":{"kind":"model","provider":"deepseek","model":"deepseek-chat"}},"usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}"""))
        wire.emit(event(3, "turn/end", """{"turn":1,"reason":{"kind":"completed"}}"""))
        val state = model.state
        assertEquals(3, state.items.size)
        assertEquals("第 1 轮完成", state.items.last().text)
        assertEquals(2, state.conversationSizeForTest())
    }

    @Test
    fun sendCarriesTheRequestEnvelopeAndImages() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope)
        model.openSession("s9")
        wire.emit(wire("""{"type":"snapshot","cursor":0,"records":[]}"""))
        model.send(text = "看这张截图", images = listOf("iVBORw0KGgo=" to "image/png"))
        val call = wire.calls.first { it.first == "session/prompt" }
        val request = (call.second["request"] as WireValue.ObjectValue).entries
        assertEquals("s9", (request["sessionId"] as WireValue.StringValue).value)
        val content = (request["content"] as WireValue.ArrayValue).items
        assertEquals(2, content.size)
        val image = (content[1] as WireValue.ObjectValue).entries
        assertEquals("image", (image["type"] as WireValue.StringValue).value)
        assertEquals("image/png", (image["mediaType"] as WireValue.StringValue).value)
    }

    @Test
    fun inboxCollectsDeduplicatesAndAnswers() = runTest {
        val wire = FakeWire()
        val model = InteractionModel(wire, TestScope())
        model.collect(wire("""{"event":"approval/requested","eventId":"e1","sessionId":"s1","title":"Run command"}"""))
        model.collect(wire("""{"event":"question/requested","eventId":"e2","sessionId":"s1","text":"Pick one"}"""))
        model.collect(wire("""{"event":"approval/requested","eventId":"e1"}"""))
        assertEquals(2, model.inbox.size)
        assertEquals("Run command", model.inbox[0].title)
        assertEquals("Pick one", model.inbox[1].detail)

        val pending = model.inbox[0]
        model.answer(pending, allowedOnce = true)
        val call = wire.calls.first { it.first == "\$events/result" }
        val result = (call.second["result"] as WireValue.ObjectValue).entries
        assertEquals("allowed-once", (result["value"] as WireValue.StringValue).value)
        assertEquals(1, model.inbox.size)
    }

    @Test
    fun filesFollowTheRegistryAndListDirectoryLevels() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/list") {
            wire("""{"path":"src","entries":[{"name":"app.ts","type":"file","size":24},{"name":"lib","type":"directory"}]}""")
        }
        val model = FilesModel(wire, backgroundScope)
        model.start()
        wire.emit(wire("""{"type":"snapshot","records":[{"id":"w1","title":"Harness"}]}"""))
        assertEquals(listOf(WorkspaceRow("w1", "Harness")), model.workspaces)
        assertEquals("w1", model.selectedWorkspace)

        model.openEntry("src")
        model.list()
        val call = wire.calls.first { it.first == "workspaceFiles/list" }
        assertEquals("w1", (call.second["workspaceId"] as WireValue.StringValue).value)
        assertEquals("src", (call.second["path"] as WireValue.StringValue).value)
        assertEquals(2, model.entries.size)
        assertTrue(model.entries[1].isDirectory)
    }

    @Test
    fun subagentsListFlatAndChildrenOpenByAddress() = runTest {
        val wire = FakeWire()
        wire.stub("subagents/list") {
            wire("""{"entries":[{"kind":"child","id":"sa-1","activity":"running","hasChildren":false,"mode":"continuable","label":"检索"},{"kind":"diagnostic","id":"sa-2","reason":"corrupt"}],"parentAvailable":true}""")
        }
        val model = SubagentsModel(wire, backgroundScope)
        model.load("p1")
        assertEquals("ready", model.listState)
        assertEquals(2, model.rows.size)
        assertEquals("continuable", model.rows[0].mode)
        assertEquals("corrupt", model.rows[1].reason)

        model.openChild("p1", model.rows[1])
        assertNull(model.childTimeline, "a diagnostic row opens nothing")
        model.openChild("p1", model.rows[0])
        val child = model.childTimeline
        assertNotNull(child)
        child!!.close()
        model.closeChild()
        assertNull(model.childTimeline)
    }
}

/** Conversation rows the fold's items carry, exposed for the test. */
private fun DomainState.conversationSizeForTest(): Int =
    items.count { it.kind == "user/message" || it.kind == "assistant/message" }
