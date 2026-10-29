package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private fun wireOf(json: String): WireValue =
    WireValue.fromJsonElement(kotlinx.serialization.json.Json.parseToJsonElement(json))

/** The chapter-70 minimized push chain over the live events stream. */
class CompanionPushTest {
    @Test
    fun watchesForwardsIntoMinimizedPushesOverTheWire() = runTest {
        val wire = FakeWire()
        val model = PushModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.startWatching()
        // The frame carries title and text; the push must not carry them.
        wire.emit(wireOf("""{"event":"approval/requested","eventId":"e1","sessionId":"s1","title":"Run rm -rf","text":"prompt text"}"""))
        wire.emit(wireOf("""{"event":"question/requested","eventId":"e2","sessionId":"s1","text":"Which file?"}"""))
        // A re-forward of the same event deduplicates by kind and event id.
        wire.emit(wireOf("""{"event":"approval/requested","eventId":"e1","sessionId":"s1"}"""))
        // Frames without push-worthy events project nothing.
        wire.emit(wireOf("""{"event":"session/updated","sessionId":"s1"}"""))
        wire.emit(wireOf("""{"event":"approval/requested","eventId":"e3"}"""))
        advanceUntilIdle()

        assertEquals(
            listOf(
                CompanionPush.ApprovalWaiting(sessionId = "s1", eventId = "e1"),
                CompanionPush.QuestionWaiting(sessionId = "s1", eventId = "e2"),
            ),
            model.pushes.value,
        )
        assertEquals("宿主等待审批", pushTitle(model.pushes.value[0]))
        assertEquals("宿主等待答复", pushTitle(model.pushes.value[1]))
        assertEquals("打开应用，经安全连接查看详情。", pushBody())
    }

    @Test
    fun parsesCompletedTurnEndsOnly() {
        val record = wireOf("""{"type":"event","event":{"type":"turn/end","seq":7,"data":{"turn":2,"reason":{"kind":"completed"}}}}""")
        assertEquals(CompanionPush.TaskCompleted(sessionId = "s1", turn = 2), pushFromTurnEnd(record, "s1"))
        assertEquals("任务完成", pushTitle(CompanionPush.TaskCompleted("s1", 2)))

        val aborted = wireOf("""{"type":"event","event":{"type":"turn/end","seq":8,"data":{"turn":3,"reason":{"kind":"aborted"}}}}""")
        assertNull(pushFromTurnEnd(aborted, "s1"))

        val other = wireOf("""{"type":"event","event":{"type":"turn/start","seq":9,"data":{"turn":4}}}""")
        assertNull(pushFromTurnEnd(other, "s1"))
    }
}
