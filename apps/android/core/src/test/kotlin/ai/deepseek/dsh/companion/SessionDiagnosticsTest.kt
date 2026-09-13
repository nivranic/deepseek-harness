package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SessionDiagnosticsTest {
    @Test fun distinguishesMissingModelUnselectedAndSelectedEmptyProjection() {
        val cases = listOf(
            SessionDiagnostics.Unavailable to """{"producer":"SessionModel","activityScope":"retained-local-projection","observation":"unavailable"}""",
            SessionDiagnostics.Unselected to """{"producer":"SessionModel","activityScope":"retained-local-projection","observation":"current","selected":false}""",
            SessionDiagnostics.Selected(SessionProjectionCounts(0, 0, 0, 0, 0, 0)) to
                """{"producer":"SessionModel","activityScope":"retained-local-projection","observation":"current","selected":true,"snapshot":{"timelineRows":0,"toolCalls":0,"artifacts":0,"images":0,"todos":0,"goals":0,"countsSaturated":false}}""",
        )
        for ((value, expected) in cases) assertEquals(Json.parseToJsonElement(expected), value.toJson())
    }

    @Test fun copiesAllSixCountsWithoutRetainingPayloadsOrCursor() {
        val rows = mutableListOf(FoldItem(99, "user/message", "private-message"))
        val state = DomainState(cursor = 99, items = rows,
            toolCalls = listOf(FoldToolCall("private-call-id", 99, "private-tool", "private-arguments", "completed", "private-result")),
            artifacts = listOf(FoldArtifact("private-artifact-id", "private-kind", "private-title", "ready")),
            images = listOf(FoldImageRef("private-attachment-id", "private-media-type", 123.0, 456.0, "private-filename")),
            todos = listOf(FoldTodo("private-todo", "pending")), goals = listOf(FoldGoal("private-goal-id", "private-goal", "active")))
        val counts = SessionProjectionCounts.capture(state)
        rows.clear()
        assertEquals(SessionProjectionCounts(1, 1, 1, 1, 1, 1), counts)
        val serialized = SessionDiagnostics.Selected(counts).toJson().toString()
        assertFalse(serialized.contains("private"))
        assertFalse(serialized.contains("cursor"))
        assertFalse(serialized.contains("99"))
    }

    private fun <T> sized(size: Int): List<T> = object : AbstractList<T>() {
        override val size = size
        override fun get(index: Int): T = error("projection capture must read collection sizes only")
    }

    @Test fun disclosesTheJvmCollectionSizeLimitForEveryCounterWithoutReadingEntries() {
        for (index in 0..5) {
            val sizes = List(6) { if (it == index) Int.MAX_VALUE else it + 1 }
            val state = DomainState(items = sized(sizes[0]), toolCalls = sized(sizes[1]), artifacts = sized(sizes[2]),
                images = sized(sizes[3]), todos = sized(sizes[4]), goals = sized(sizes[5]))
            val counts = SessionProjectionCounts.capture(state)
            assertEquals(sizes, listOf(counts.timelineRows, counts.toolCalls, counts.artifacts, counts.images, counts.todos, counts.goals))
            assertTrue(counts.countsSaturated)
        }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test fun readsTheCurrentFoldAndDoesNotRepublishCountsAfterCloseOrReplacement() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope)
        assertEquals(SessionDiagnostics.Unselected, model.sessionDiagnostics)
        assertTrue(wire.calls.isEmpty())
        model.openSession("private-session-id")
        runCurrent()
        wire.emit(WireValue.fromJsonElement(Json.parseToJsonElement("""{"type":"snapshot","records":[{"kind":"event","event":{"seq":1,"type":"user/message","data":{"id":"private-message-id","role":"user","content":[{"type":"text","text":"private-text"}],"source":{"kind":"user"}}}}]}""")))
        runCurrent()
        val captured = model.sessionDiagnostics
        assertEquals(SessionDiagnostics.Selected(SessionProjectionCounts(1, 0, 0, 0, 0, 0)), captured)
        model.closeAndAwait()
        assertEquals(SessionDiagnostics.Unselected, model.sessionDiagnostics)
        assertFalse(captured.toJson().toString().contains("private"))
        assertTrue(wire.calls.isEmpty())
        model.openSession("replacement-session")
        assertEquals(SessionDiagnostics.Selected(SessionProjectionCounts(0, 0, 0, 0, 0, 0)), model.sessionDiagnostics)
        model.closeAndAwait()
        assertEquals(SessionDiagnostics.Selected(SessionProjectionCounts(1, 0, 0, 0, 0, 0)), captured)
    }
}
