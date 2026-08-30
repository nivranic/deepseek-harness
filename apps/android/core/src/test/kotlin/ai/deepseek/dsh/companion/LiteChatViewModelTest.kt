package ai.deepseek.dsh.companion

import app.cash.turbine.test
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private fun tempDir(): java.io.File =
    java.nio.file.Files.createTempDirectory("lite-chat").toFile()

/** The chat surface over the scripted provider and the file stores. */
class LiteChatViewModelTest {
    @Test
    fun submitsPersistsAndRestoresAcrossARelaunch() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf("你好" to listOf(LiteStreamChunk.Text("你好，这里是 Lite。"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui1",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        model.send("你好")
        advanceUntilIdle()

        assertEquals(
            listOf(LiteMessage(role = "user", text = "你好"), LiteMessage(role = "assistant", text = "你好，这里是 Lite。")),
            model.state.conversation,
        )
        assertEquals("completed", model.state.lastTurnEnd)
        assertNull(model.lastHandoff)

        // A relaunch through the journal replays the same conversation.
        val restored = store.load("ui1")!!
        assertEquals(2, restored.state.conversation.size)
        assertEquals("你好，这里是 Lite。", restored.state.conversation[1].text)
    }

    @Test
    fun aHandoffTurnSurfacesTheBannerState() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("跑测试" to listOf(LiteStreamChunk.ToolCall("c", "run_tests", "{}"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui2",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
        )
        model.send("跑测试")
        advanceUntilIdle()

        assertEquals(LITE_REQUIRES_FULL_RUNTIME, model.lastHandoff)
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, model.state.pendingHandoff)
    }

    @Test
    fun theLiveTurnShowsThroughWhileTheJournalRestsBehindIt() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf("第一轮" to listOf(LiteStreamChunk.Text("第一答"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui3",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        model.send("第一轮")
        advanceUntilIdle()
        assertEquals(2, model.state.conversation.size)

        // A second turn over the same session: the journal grows behind it.
        model.send("第一轮")
        advanceUntilIdle()
        assertEquals(4, model.state.conversation.size)
        assertEquals(4, store.load("ui3")!!.state.conversation.size)
    }

    @Test
    fun liveStateEmitsEachCutOfTheTurn() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf(
                "算一下" to listOf(
                    LiteStreamChunk.Text("你"),
                    LiteStreamChunk.Text("好"),
                    LiteStreamChunk.ToolCall("c1", "calculator", "1+1"),
                ),
            ),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui4",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = true, text = "2") },
        )
        model.liveState.test {
            // The initial cut is the empty journal.
            assertEquals(cut(awaitItem()), listOf(false, "", emptyList<String>(), 0, null))
            model.send("算一下")
            // prompt/accepted — the user row lands, the stream not yet live.
            assertEquals(cut(awaitItem()), listOf(false, "", emptyList<String>(), 1, null))
            // stream/delta 你, then 好 — the partial grows.
            assertEquals(cut(awaitItem()), listOf(true, "你", emptyList<String>(), 1, null))
            assertEquals(cut(awaitItem()), listOf(true, "你好", emptyList<String>(), 1, null))
            // tool/call folds running; tool/result completes the row.
            assertEquals(cut(awaitItem()), listOf(true, "你好", listOf("running"), 1, null))
            assertEquals(cut(awaitItem()), listOf(true, "你好", listOf("completed"), 1, null))
            // message/completed — the assistant row lands, the stream resets.
            assertEquals(cut(awaitItem()), listOf(false, "", listOf("completed"), 2, null))
            // turn/completed — only the turn end moves.
            assertEquals(cut(awaitItem()), listOf(false, "", listOf("completed"), 2, "completed"))
            // The persisted journal replay — the turn-outcome events carry
            // no tool rows, by the chapter-64 fidelity rule.
            assertEquals(cut(awaitItem()), listOf(false, "", emptyList<String>(), 2, "completed"))
            cancelAndIgnoreRemainingEvents()
        }
    }

    /** One emission compressed to what the sequence pins. */
    private fun cut(state: LiteDomainState) = listOf(
        state.streaming.active,
        state.streaming.partialText,
        state.toolCalls.map { it.phase },
        state.conversation.size,
        state.lastTurnEnd,
    )
}
