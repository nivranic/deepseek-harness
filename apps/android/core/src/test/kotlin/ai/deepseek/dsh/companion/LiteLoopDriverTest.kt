package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolRisk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
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
    fun aDeclaredCalculatorCallExecutesThroughTheRealExecutor() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("算" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"2 + 3 * 4"}"""))),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, name, arguments ->
                when (name) {
                    "calculator" -> LiteToolExecutors.calculator(arguments)
                    else -> LiteToolOutcome(ok = false, text = "no on-device executor mounted: $name")
                }
            },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(listOf(declaredLite("calculator"))),
        )
        driver.submit("算")
        advanceUntilIdle()

        // The policy ladder admits the declared calculator and the real
        // evaluator's answer rides the tool/result row.
        val tool = driver.fold.state.toolCalls.single()
        assertEquals("completed", tool.phase)
        assertEquals("14", tool.resultText)
        assertEquals("completed", driver.fold.state.lastTurnEnd)
    }

    @Test
    fun aSuccessfulArtifactCreateFoldsTheArtifactPairAfterTheToolResult() = runTest {
        val store = LiteFileArtifactStore(java.nio.file.Files.createTempDirectory("lite-loop-artifacts").toFile())
        val provider = ScriptedLiteProvider(
            mapOf(
                "写" to listOf(
                    LiteStreamChunk.ToolCall("call-1", "artifact_create", """{"id":"spec","kind":"markdown","content":"# 报告"}"""),
                    LiteStreamChunk.Text("已写入"),
                ),
            ),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, name, arguments ->
                when (name) {
                    "artifact_create" -> LiteToolExecutors.artifactCreate(store, arguments)
                    else -> LiteToolOutcome(ok = false, text = "no on-device executor mounted: $name")
                }
            },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(listOf(declaredLite("artifact_create"))),
        )
        driver.submit("写")
        advanceUntilIdle()

        val state = driver.fold.state
        assertEquals("completed", state.toolCalls.single().phase)
        // The fold's pair: artifact/created appends the pending row, then
        // artifact/status flips it to ready by id.
        assertEquals(
            listOf(LiteArtifact(id = "spec", kind = "markdown", title = "spec", status = "ready")),
            state.artifacts,
        )
        assertEquals("# 报告", store.get("spec")!!.decodeToString())
        assertEquals("completed", state.lastTurnEnd)
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
    fun unknownNamesFailExplicitlyInsteadOfHanging() = runTest {
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
        val tool = state.toolCalls.single()
        assertEquals("failed", tool.phase)
        assertEquals("unknown tool on this device: bash", tool.resultText)
        assertEquals("completed", state.lastTurnEnd)
    }

    @Test
    fun aHostDeclarationMovesTheHandoffLine() = runTest {
        val catalog = LiteToolCatalog.fromHostDescriptors(
            LiteToolRegistry.bundled.map {
                ToolDescriptor(it.name, 1, ToolRisk.LOW, emptyList(), supportsLite = it.name != "web_search", supportsRemote = true)
            },
        )
        var executed = 0
        val provider = ScriptedLiteProvider(
            mapOf(
                "跑测试" to listOf(LiteStreamChunk.ToolCall("c3", "run_tests", "{}")),
                "搜索" to listOf(LiteStreamChunk.ToolCall("c1", "web_search", "{}")),
            ),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, name, _ ->
                executed += 1
                LiteToolOutcome(ok = true, text = "$name 完成")
            },
            toolCatalog = catalog,
        )
        // Declared lite-capable: run_tests executes on-device instead of
        // handing off like the bundled fallback table does.
        driver.submit("跑测试")
        advanceUntilIdle()
        assertEquals(1, executed)
        assertEquals("completed", driver.fold.state.toolCalls.single().phase)
        assertEquals("completed", driver.fold.state.lastTurnEnd)
        assertEquals(null, driver.fold.state.pendingHandoff)

        // Declared not lite-capable: web_search hands off instead of
        // executing like the bundled fallback table does.
        driver.submit("搜索")
        advanceUntilIdle()
        assertEquals(1, executed)
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, driver.fold.state.pendingHandoff)
    }

    @Test
    fun aDeclaredUnknownToolFailsExplicitlyWithoutHandingOff() = runTest {
        var executed = 0
        val provider = ScriptedLiteProvider(
            mapOf("随便" to listOf(LiteStreamChunk.ToolCall("c9", "bash", "{}"))),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, _, _ ->
                executed += 1
                LiteToolOutcome(ok = true, text = "")
            },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(emptyList()),
        )
        driver.submit("随便")
        advanceUntilIdle()

        assertEquals(0, executed)
        val state = driver.fold.state
        val tool = state.toolCalls.single()
        assertEquals("failed", tool.phase)
        assertEquals("unknown tool on this device: bash", tool.resultText)
        assertEquals(null, state.pendingHandoff)
        assertEquals("completed", state.lastTurnEnd)
    }

    @Test
    fun aSecondTurnCarriesTheFirstTurnsExecutedCallAndResultAsHistory() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf(
                "算" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"2 + 3 * 4"}"""), LiteStreamChunk.Text("十四")),
                "再算" to listOf(LiteStreamChunk.Text("好的")),
            ),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, name, arguments ->
                when (name) {
                    "calculator" -> LiteToolExecutors.calculator(arguments)
                    else -> LiteToolOutcome(ok = false, text = "no on-device executor mounted: $name")
                }
            },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(listOf(declaredLite("calculator"))),
        )
        driver.submit("算")
        advanceUntilIdle()
        driver.submit("再算")
        advanceUntilIdle()

        // The first turn starts with no history; the second submission's
        // history carries the first turn whole — its prompt, its reply, the
        // executed call, and the real evaluator's answer under the call id.
        assertEquals(emptyList<LiteTurnRecord>(), provider.submittedHistories.first())
        assertEquals(
            listOf(
                LiteTurnRecord(
                    userText = "算",
                    rounds = listOf(
                        LiteTurnRound(
                            assistantText = "十四",
                            toolCalls = listOf(LiteTurnToolCall(id = "c1", name = "calculator", arguments = """{"expression":"2 + 3 * 4"}""")),
                            toolResults = mapOf("c1" to "14"),
                        ),
                    ),
                ),
            ),
            provider.submittedHistories[1],
        )
    }

    @Test
    fun aFailedToolResultRidesTheNextTurnsHistoryLikeASuccessfulOne() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf(
                "写" to listOf(LiteStreamChunk.ToolCall("c1", "artifact_create", """{"id":"spec","kind":"markdown"}""")),
                "再试" to listOf(LiteStreamChunk.Text("好")),
            ),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "sandbox denied the write") },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(listOf(declaredLite("artifact_create"))),
        )
        driver.submit("写")
        advanceUntilIdle()
        driver.submit("再试")
        advanceUntilIdle()

        // The refused execution's reason rides the history map under its
        // call id: every issued call keeps a result the protocol can answer
        // the next turn with.
        val record = provider.submittedHistories[1].single()
        assertEquals(
            listOf(LiteTurnRound(assistantText = "", toolCalls = listOf(LiteTurnToolCall(id = "c1", name = "artifact_create", arguments = """{"id":"spec","kind":"markdown"}""")), toolResults = mapOf("c1" to "sandbox denied the write"))),
            record.rounds,
        )
    }

    @Test
    fun aToolCallsFinishContinuesTheTurnWithTheCompletedRoundAsHistory() = runTest {
        val provider = ScriptedLiteProvider(
            scripts = mapOf(
                "算" to listOf(
                    LiteStreamChunk.Text("先算"),
                    LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"2 + 3 * 4"}"""),
                    LiteStreamChunk.Finish("tool_calls"),
                ),
            ),
            followUps = mapOf(
                "算" to listOf(listOf(LiteStreamChunk.Text("结果是 14"))),
            ),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, name, arguments ->
                when (name) {
                    "calculator" -> LiteToolExecutors.calculator(arguments)
                    else -> LiteToolOutcome(ok = false, text = "no on-device executor mounted: $name")
                }
            },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(listOf(declaredLite("calculator"))),
        )
        driver.submit("算")
        advanceUntilIdle()

        // One prompt, two requests: the continuation carries the live turn's
        // completed round — its reply text, the executed call, and the real
        // evaluator's answer under the call id.
        assertEquals(listOf("算", "算"), provider.submitted)
        assertEquals(emptyList<LiteTurnRecord>(), provider.submittedHistories.first())
        assertEquals(
            listOf(
                LiteTurnRecord(
                    userText = "算",
                    rounds = listOf(
                        LiteTurnRound(
                            assistantText = "先算",
                            toolCalls = listOf(LiteTurnToolCall(id = "c1", name = "calculator", arguments = """{"expression":"2 + 3 * 4"}""")),
                            toolResults = mapOf("c1" to "14"),
                        ),
                    ),
                ),
            ),
            provider.submittedHistories[1],
        )
        val state = driver.fold.state
        assertEquals(
            listOf(
                LiteMessage(role = "user", text = "算"),
                LiteMessage(role = "assistant", text = "先算"),
                LiteMessage(role = "assistant", text = "结果是 14"),
            ),
            state.conversation,
        )
        assertEquals("completed", state.lastTurnEnd)
        assertTrue(state.errors.isEmpty())
        assertFalse(driver.running)
    }

    @Test
    fun aRunawayToolLoopClosesFailSoftAtTheRoundCap() = runTest {
        var executed = 0
        val provider = ScriptedLiteProvider(
            scripts = mapOf(
                "循环" to listOf(
                    LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"1"}"""),
                    LiteStreamChunk.Finish("tool_calls"),
                ),
            ),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, name, arguments ->
                executed += 1
                when (name) {
                    "calculator" -> LiteToolExecutors.calculator(arguments)
                    else -> LiteToolOutcome(ok = false, text = "no on-device executor mounted: $name")
                }
            },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(listOf(declaredLite("calculator"))),
        )
        driver.submit("循环")
        advanceUntilIdle()

        // Every round answers tool_calls again; the cap closes the turn
        // fail-soft — the last round's empty assistant row and the terminal
        // event still land, the event stream is never truncated.
        assertEquals(MAX_LITE_ROUNDS_PER_TURN, provider.submitted.size)
        assertEquals(MAX_LITE_ROUNDS_PER_TURN, executed)
        assertEquals(MAX_LITE_ROUNDS_PER_TURN, driver.fold.state.toolCalls.size)
        assertEquals(MAX_LITE_ROUNDS_PER_TURN + 1, driver.fold.state.conversation.size)
        assertEquals("completed", driver.fold.state.lastTurnEnd)
        assertTrue(driver.fold.state.errors.isEmpty())
        // The last request's history carried every earlier round of the
        // live turn, one round per completed request before it.
        assertEquals(MAX_LITE_ROUNDS_PER_TURN - 1, provider.submittedHistories.last().single().rounds.size)
    }

    @Test
    fun aHandoffInTheSecondRoundStopsAtTheMarker() = runTest {
        var executed = 0
        val provider = ScriptedLiteProvider(
            scripts = mapOf(
                "查" to listOf(
                    LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"1"}"""),
                    LiteStreamChunk.Finish("tool_calls"),
                ),
            ),
            followUps = mapOf(
                "查" to listOf(listOf(LiteStreamChunk.ToolCall("c2", "run_tests", "{}"), LiteStreamChunk.Finish("tool_calls"))),
            ),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
            execute = { _, _, _ ->
                executed += 1
                LiteToolOutcome(ok = true, text = "1")
            },
        )
        driver.submit("查")
        advanceUntilIdle()

        // The continuation request went out with the first round as
        // history; its gated call hands off, and the turn stops at the
        // marker — the first round's assistant row stands, the handoff
        // round adds none.
        assertEquals(listOf("查", "查"), provider.submitted)
        assertEquals(1, executed)
        val state = driver.fold.state
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, state.pendingHandoff)
        assertEquals(null, state.lastTurnEnd)
        assertEquals(listOf(LiteMessage(role = "user", text = "查"), LiteMessage(role = "assistant", text = "")), state.conversation)
        assertFalse(driver.running)
    }

    @Test
    fun cancellationFinalizesTheDeliveredPrefix() = runTest {
        val provider = object : LiteProviding {
            override suspend fun stream(prompt: String, system: String?, history: List<LiteTurnRecord>): Flow<LiteStreamChunk> = flow {
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
                override suspend fun stream(prompt: String, system: String?, history: List<LiteTurnRecord>): Flow<LiteStreamChunk> = flow { script() }
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

    @Test
    fun aSystemPromptPassesThroughWithoutJournaling() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("总结" to listOf(LiteStreamChunk.Text("好"))),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
        ) { _, _, _ -> LiteToolOutcome(ok = true, text = "") }
        driver.submit("总结", "sample-system")
        advanceUntilIdle()

        assertEquals(listOf("总结"), provider.submitted)
        assertEquals(listOf<String?>("sample-system"), provider.submittedSystems)
        // The system prompt is request-face context: the conversation rows
        // stay user/assistant only, exactly as a bare turn folds them.
        assertEquals(
            listOf(LiteMessage(role = "user", text = "总结"), LiteMessage(role = "assistant", text = "好")),
            driver.fold.state.conversation,
        )
        assertEquals("completed", driver.fold.state.lastTurnEnd)
    }

    @Test
    fun aSubmissionWithoutASystemRunsBare() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("总结" to listOf(LiteStreamChunk.Text("好"))),
        )
        val driver = LiteLoopDriver(
            CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider,
        ) { _, _, _ -> LiteToolOutcome(ok = true, text = "") }
        driver.submit("总结")
        advanceUntilIdle()

        assertEquals(listOf<String?>(null), provider.submittedSystems)
        assertEquals(
            listOf(LiteMessage(role = "user", text = "总结"), LiteMessage(role = "assistant", text = "好")),
            driver.fold.state.conversation,
        )
    }

    /** One declared low-risk lite-capable tool the real executors can serve. */
    private fun declaredLite(id: String): ToolDescriptor =
        ToolDescriptor(id = id, version = 1, risk = ToolRisk.LOW, permissions = emptyList(), supportsLite = true, supportsRemote = true)
}
