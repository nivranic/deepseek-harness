package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import app.cash.turbine.test
import kotlin.test.assertTrue

/** A scriptable wire double: recorded calls, preset stream frames. */
class FakeWire : WireDriving {
    val calls = mutableListOf<Pair<String, Map<String, WireValue>>>()
    val answers = mutableMapOf<String, suspend () -> WireValue>()

    /** Sequential answers per method: each call pops the next; the queue
     * retires when drained. */
    private val queues = mutableMapOf<String, MutableList<suspend () -> WireValue>>()

    fun stubSequence(method: String, sequential: List<suspend () -> WireValue>) {
        queues[method] = sequential.toMutableList()
    }

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
        queues[method]?.let { queue ->
            val next = queue.removeAt(0)
            if (queue.isEmpty()) queues.remove(method)
            return next()
        }
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
        assertEquals("ready", model.listState.value)
        assertEquals(listOf(SessionRow("s1", "Refactor", 100.0), SessionRow("s2", "Notes", null)), model.sessions.value)
    }

    @Test
    fun openFoldsSnapshotAndEventsIntoTheDomainState() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.openSession("s1")
        wire.emit(wire("""{"type":"snapshot","cursor":0,"records":[]}"""))
        wire.emit(event(1, "user/message", """{"id":"m1","role":"user","content":[{"type":"text","text":"你好"}],"source":{"kind":"user"}}"""))
        wire.emit(event(2, "assistant/message", """{"turn":1,"step":1,"message":{"id":"m2","role":"assistant","content":[{"type":"text","text":"已处理。"}],"source":{"kind":"model","provider":"deepseek","model":"deepseek-chat"}},"usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}"""))
        wire.emit(event(3, "turn/end", """{"turn":1,"reason":{"kind":"completed"}}"""))
        advanceUntilIdle()
        val state = model.state
        assertEquals(3, state.items.size)
        assertEquals("第 1 轮完成", state.items.last().text)
        assertEquals(2, state.conversationSizeForTest())
    }

    @Test
    fun sendCarriesTheRequestEnvelopeAndImages() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
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
        assertEquals(2, model.inbox.value.size)
        assertEquals("Run command", model.inbox.value[0].title)
        assertEquals("Pick one", model.inbox.value[1].detail)

        val pending = model.inbox.value[0]
        model.answer(pending, allowedOnce = true)
        val call = wire.calls.first { it.first == "\$events/result" }
        val result = (call.second["result"] as WireValue.ObjectValue).entries
        assertEquals("allowed-once", (result["value"] as WireValue.StringValue).value)
        assertEquals(1, model.inbox.value.size)
    }

    @Test
    fun filesFollowTheRegistryAndListDirectoryLevels() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/list") {
            wire("""{"path":"src","entries":[{"name":"app.ts","type":"file","size":24},{"name":"lib","type":"directory"}]}""")
        }
        val model = FilesModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.start()
        wire.emit(wire("""{"type":"snapshot","records":[{"id":"w1","title":"Harness"}]}"""))
        advanceUntilIdle()
        assertEquals(listOf(WorkspaceRow("w1", "Harness")), model.workspaces.value)
        assertEquals("w1", model.selectedWorkspace.value)

        model.list()
        model.openEntry("lib")
        model.list()
        val call = wire.calls.last { it.first == "workspaceFiles/list" }
        assertEquals("w1", (call.second["workspaceId"] as WireValue.StringValue).value)
        assertEquals("lib", (call.second["path"] as WireValue.StringValue).value)
        assertEquals(2, model.entries.value.size)
        assertTrue(model.entries.value[1].isDirectory)
    }

    @Test
    fun subagentsListFlatAndChildrenOpenByAddress() = runTest {
        val wire = FakeWire()
        wire.stub("subagents/list") {
            wire("""{"entries":[{"kind":"child","id":"sa-1","activity":"running","hasChildren":false,"mode":"continuable","label":"检索"},{"kind":"diagnostic","id":"sa-2","reason":"corrupt"}],"parentAvailable":true}""")
        }
        val model = SubagentsModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.load("p1")
        assertEquals("ready", model.listState.value)
        assertEquals(2, model.rows.value.size)
        assertEquals("continuable", model.rows.value[0].mode)
        assertEquals("corrupt", model.rows.value[1].reason)

        model.openChild("p1", model.rows.value[1])
        assertNull(model.childTimeline.value, "a diagnostic row opens nothing")
        model.openChild("p1", model.rows.value[0])
        val child = model.childTimeline.value
        assertNotNull(child)
        child!!.close()
        model.closeChild()
        assertNull(model.childTimeline.value)
    }
}

class StateFlowProjectionTest {
    @Test
    fun listStateEmitsItsSequence() = runTest {
        val wire = FakeWire()
        wire.stub("session/list") {
            wire("""{"items":[{"sessionId":"s1","title":"Refactor"}]}""")
        }
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.listState.test {
            assertEquals("idle", awaitItem())
            model.loadSessions()
            assertEquals("loading", awaitItem())
            assertEquals("ready", awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
        assertEquals(1, model.sessions.value.size)
    }

    @Test
    fun openEmitsEachFoldedCut() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.open.test {
            assertEquals(null, awaitItem())
            model.openSession("s1")
            awaitItem().also { assertEquals(0, it?.state?.items?.size) }
            wire.emit(wire("""{"type":"snapshot","cursor":0,"records":[]}"""))
            wire.emit(event(1, "user/message", """{"id":"m1","role":"user","content":[{"type":"text","text":"你好"}],"source":{"kind":"user"}}"""))
            awaitItem().also { assertEquals(1, it?.state?.items?.size) }
            wire.emit(event(2, "turn/end", """{"turn":1,"reason":{"kind":"completed"}}"""))
            awaitItem().also { assertEquals(2, it?.state?.items?.size) }
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun inboxEmitsAppendsAndRetirements() = runTest {
        val wire = FakeWire()
        val model = InteractionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.inbox.test {
            assertEquals(0, awaitItem().size)
            model.collect(wire("""{"event":"approval/requested","eventId":"e1","sessionId":"s1","title":"Run command"}"""))
            awaitItem().also { assertEquals(1, it.size) }
            model.collect(wire("""{"event":"approval/requested","eventId":"e1"}"""))
            expectNoEvents()
            val pending = model.inbox.value[0]
            model.answer(pending, allowedOnce = true)
            awaitItem().also { assertEquals(0, it.size) }
            cancelAndIgnoreRemainingEvents()
        }
    }
}

/** The artifact read consumer: wire shape, byte cache, loud-failure null. */
class ArtifactReadTest {
    @Test
    fun readsArtifactsOverTheWireAndCachesBytes() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.openSession("s9")
        wire.emit(wire("""{"type":"snapshot","cursor":0,"records":[]}"""))
        val bytes = java.util.Base64.getEncoder().encodeToString("# 报告".toByteArray())
        wire.stub("session/artifact") { wire("""{"id":"art-1","kind":"report","title":"迁移报告","data":"$bytes"}""") }
        val read = model.readArtifact("art-1")
        assertEquals("art-1", read?.id)
        assertEquals("report", read?.kind)
        assertEquals("迁移报告", read?.title)
        assertEquals("# 报告", model.artifactBytes["art-1"]?.decodeToString())
        val call = wire.calls.first { it.first == "session/artifact" }
        val request = call.second["request"] as WireValue.ObjectValue
        assertEquals("s9", (request.entries["sessionId"] as WireValue.StringValue).value)
        assertEquals("art-1", (request.entries["artifactId"] as WireValue.StringValue).value)
    }

    @Test
    fun pagedReadsCarryOffsetAndLimitAndSkipTheCache() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.openSession("s9")
        wire.emit(wire("""{"type":"snapshot","cursor":0,"records":[]}"""))
        wire.stub("session/artifact") { wire("""{"id":"art-1","kind":"report","title":"R","data":"MjM0NQ==","truncated":true,"size":10}""") }
        val read = model.readArtifact("art-1", offset = 2, limit = 4)
        assertEquals(true, read?.truncated)
        assertEquals(10.0, read?.size)
        assertEquals(null, model.artifactBytes["art-1"])
        val call = wire.calls.first { it.first == "session/artifact" }
        val request = call.second["request"] as WireValue.ObjectValue
        assertEquals(2.0, (request.entries["offset"] as WireValue.NumberValue).value)
        assertEquals(4.0, (request.entries["limit"] as WireValue.NumberValue).value)
    }

    @Test
    fun nullsWhenTheRefusalOrAMissingSessionLeavesNothingToRead() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        assertEquals(null, model.readArtifact("art-1"))
        model.openSession("s9")
        wire.emit(wire("""{"type":"snapshot","cursor":0,"records":[]}"""))
        wire.stub("session/artifact") { throw ai.deepseek.dsh.link.LinkClientException.Refused("artifact-error", "Artifact is not referenced by this session.") }
        assertEquals(null, model.readArtifact("art-2"))
        assertEquals(true, model.artifactBytes.isEmpty())
    }
}

class PagedReadTest {
    @Test
    fun readsPagesWhenTheHostReportsTooLarge() = runTest {
        val wire = FakeWire()
        val page = "x".repeat(65536)
        wire.stubSequence(
            "workspaceFiles/read",
            listOf(
                { throw ai.deepseek.dsh.link.LinkClientException.Refused("file-too-large", "256 KiB cap") },
                { wire("""{"content":"$page","truncated":true,"size":65537,"mediaType":"text/plain"}""") },
                { wire("""{"content":"尾","truncated":false,"size":65537,"mediaType":"text/plain"}""") },
            ),
        )
        val model = FilesModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.start()
        wire.emit(wire("""{"type":"snapshot","records":[{"id":"w1","title":"Harness"}]}"""))
        model.readFile("big.log")

        val first = model.openFile.value!!
        assertEquals(65536, first.loadedUnits)
        assertEquals(65537, first.totalUnits)
        assertTrue(first.hasMore)

        model.loadMore()
        val second = model.openFile.value!!
        assertEquals(65537, second.loadedUnits)
        assertEquals("尾", second.text.takeLast(1))
        assertEquals(false, second.hasMore)

        val reads = wire.calls.filter { it.first == "workspaceFiles/read" }
        assertEquals(3, reads.size)
        assertEquals(null, reads[0].second["offset"])
        assertEquals(0.0, (reads[1].second["offset"] as WireValue.NumberValue).value)
        assertEquals(65536.0, (reads[1].second["limit"] as WireValue.NumberValue).value)
        assertEquals(65536.0, (reads[2].second["offset"] as WireValue.NumberValue).value)
        assertEquals("big.log", (reads[0].second["path"] as WireValue.StringValue).value)
    }

    @Test
    fun binaryRefusalSurfacesTheChineseMessage() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/read") {
            throw ai.deepseek.dsh.link.LinkClientException.Refused("file-binary", "not text")
        }
        val model = FilesModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.start()
        wire.emit(wire("""{"type":"snapshot","records":[{"id":"w1","title":"Harness"}]}"""))
        model.readFile("logo.png")
        assertEquals("二进制文件，无法文本预览", model.openFileError.value)
        assertEquals(null, model.openFile.value)
    }
}

/** Conversation rows the fold's items carry, exposed for the test. */
private fun DomainState.conversationSizeForTest(): Int =
    items.count { it.kind == "user/message" || it.kind == "assistant/message" }
