package ai.deepseek.dsh.companion

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
}
