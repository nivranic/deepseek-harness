package ai.deepseek.dsh.companion

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowCollector
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The Lite loop driver over a scripted provider, asserted through the fold. */
class LiteLoopDriverTest {
    @Test
    fun streamsThePromptToACompletedTurn() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("总结" to listOf(LiteStreamChunk.Reasoning("先想"), LiteStreamChunk.Text("你好"), LiteStreamChunk.Text("，世界"))),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
        ) { _, _, _ -> LiteToolOutcome(ok = true, text = "不应执行") }
        driver.submit("总结")
        advanceUntilIdle()

        val state = driver.fold.state
        assertEquals(
            listOf(LiteMessage(role = "user", text = "总结"), LiteMessage(role = "assistant", text = "你好，世界")),
            state.conversation,
        )
        assertEquals(LiteStreaming(), state.streaming)
        assertEquals("completed", state.lastTurnEnd)
        assertTrue(state.errors.isEmpty())
        assertEquals(listOf("总结"), provider.submitted)
        assertFalse(driver.running)
    }

    @Test
    fun dispatchesBundledToolsThroughTheRegistry() = runTest {
        val executed = mutableListOf<Triple<String, String, String>>()
        val provider = ScriptedLiteProvider(
            mapOf("搜索" to listOf(LiteStreamChunk.Text("查一下"), LiteStreamChunk.ToolCall("c1", "web_search", "{}"))),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
        ) { id, name, arguments ->
            executed.add(Triple(id, name, arguments))
            LiteToolOutcome(ok = true, text = "找到 3 篇。")
        }
        driver.submit("搜索")
        advanceUntilIdle()

        assertEquals(listOf(Triple("c1", "web_search", "{}")), executed)
        val tool = driver.fold.state.toolCalls.single()
        assertEquals("completed", tool.phase)
        assertEquals("找到 3 篇。", tool.resultText)
        assertEquals("completed", driver.fold.state.lastTurnEnd)
    }

    @Test
    fun aHandoffNameStopsAtTheMarkerWithoutExecuting() = runTest {
        var executed = 0
        val provider = ScriptedLiteProvider(
            mapOf("跑测试" to listOf(LiteStreamChunk.ToolCall("c3", "run_tests", "{}"))),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
        ) { _, _, _ ->
            executed += 1
            LiteToolOutcome(ok = true, text = "")
        }
        driver.submit("跑测试")
        advanceUntilIdle()

        assertEquals(0, executed)
        val state = driver.fold.state
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, state.pendingHandoff)
        assertEquals(null, state.lastTurnEnd)
        assertEquals("running", state.toolCalls.single().phase)
        assertFalse(driver.running)
    }

    @Test
    fun unknownNamesFoldButNeverDispatch() = runTest {
        var executed = 0
        val provider = ScriptedLiteProvider(
            mapOf("随便" to listOf(LiteStreamChunk.ToolCall("c9", "bash", "{}"), LiteStreamChunk.Text("收尾"))),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
        ) { _, _, _ ->
            executed += 1
            LiteToolOutcome(ok = true, text = "")
        }
        driver.submit("随便")
        advanceUntilIdle()

        assertEquals(0, executed)
        val state = driver.fold.state
        assertEquals("running", state.toolCalls.single().phase)
        assertEquals("completed", state.lastTurnEnd)
    }

    @Test
    fun cancellationFinalizesTheDeliveredPrefix() = runTest {
        val provider = object : LiteProviding {
            override suspend fun stream(prompt: String): Flow<LiteStreamChunk> = flow {
                emit(LiteStreamChunk.Text("部分"))
                awaitCancellation()
            }
        }
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
        ) { _, _, _ -> LiteToolOutcome(ok = true, text = "") }
        driver.submit("停止我")
        advanceUntilIdle()
        assertTrue(driver.running)

        driver.cancel()
        advanceUntilIdle()

        val state = driver.fold.state
        assertEquals(
            listOf(LiteMessage(role = "user", text = "停止我"), LiteMessage(role = "assistant", text = "部分", interrupted = true)),
            state.conversation,
        )
        assertTrue(state.interrupted)
        assertEquals("cancelled", state.lastTurnEnd)
        assertFalse(driver.running)
    }

    @Test
    fun transportFailuresFoldIntoTheirVocabulary() = runTest {
        fun driver(script: suspend FlowCollector<LiteStreamChunk>.() -> Unit): LiteLoopDriver {
            val provider = object : LiteProviding {
                override suspend fun stream(prompt: String): Flow<LiteStreamChunk> = flow { script() }
            }
            return LiteLoopDriver(CoroutineScope(UnconfinedTestDispatcher(testScheduler)), provider) { _, _, _ ->
                LiteToolOutcome(ok = true, text = "")
            }
        }

        val dropped = driver {
            emit(LiteStreamChunk.Text("部分"))
            throw LiteTransportError.Network("dropped")
        }
        dropped.submit("重试")
        advanceUntilIdle()
        assertEquals(listOf(LiteFailure(kind = "network", code = "dropped", message = "dropped")), dropped.fold.state.errors)
        assertEquals("network-error", dropped.fold.state.lastTurnEnd)
        // A dropped transport keeps the delivered prefix for resume.
        assertEquals(LiteStreaming(active = false, partialText = "部分", partialReasoning = ""), dropped.fold.state.streaming)

        val refused = driver { throw LiteTransportError.Provider("RATE_LIMITED", "并发超限") }
        refused.submit("再来")
        advanceUntilIdle()
        assertEquals(listOf(LiteFailure(kind = "provider", code = "RATE_LIMITED", message = "并发超限")), refused.fold.state.errors)
        assertEquals("provider-error", refused.fold.state.lastTurnEnd)
        assertEquals(LiteStreaming(), refused.fold.state.streaming)

        val exploded = driver { throw IllegalStateException("boom") }
        exploded.submit("炸了")
        advanceUntilIdle()
        val failure = exploded.fold.state.errors.single()
        assertEquals("provider", failure.kind)
        assertEquals("PROVIDER_FAILED", failure.code)
        assertTrue(failure.message.contains("boom"))
    }
}
