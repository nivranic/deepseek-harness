package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptor
import ai.deepseek.dsh.contract.LitePresetPersona
import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolRisk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
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
        assertNull(model.state.pendingHandoff)

        // A relaunch through the journal replays the same conversation.
        val restored = store.load("ui1")!!
        assertEquals(2, restored.state.conversation.size)
        assertEquals("你好，这里是 Lite。", restored.state.conversation[1].text)
    }

    @Test
    fun aRelaunchedSessionFeedsItsReplayedToolRowsIntoTheNextRequest() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val first = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "resume-tools",
            provider = ScriptedLiteProvider(
                mapOf("算一下" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"(1 + 2) * 3"}"""))),
            ),
            execute = { _, _, arguments -> LiteToolExecutors.calculator(arguments) },
            store = store,
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(ToolDescriptor("calculator", 1, ToolRisk.LOW, emptyList(), supportsLite = true, supportsRemote = true)),
            ),
        )
        first.send("算一下")
        advanceUntilIdle()

        // The relaunch: the stored journal — its tool rows riding it since
        // the chapter-64 write face — replays into the new driver, so the
        // next request carries the prior turn (its calculator call and the
        // result text 9) as history.
        var relaunchedProvider: ScriptedLiteProvider? = null
        val relaunched = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "resume-tools",
            provider = ScriptedLiteProvider(mapOf("总结" to listOf(LiteStreamChunk.Text("已记录")))).also { relaunchedProvider = it },
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(ToolDescriptor("calculator", 1, ToolRisk.LOW, emptyList(), supportsLite = true, supportsRemote = true)),
            ),
        )
        relaunched.send("总结")
        advanceUntilIdle()

        val history = relaunchedProvider!!.submittedHistories.single()
        assertEquals(1, history.size)
        assertEquals("算一下", history[0].userText)
        val round = history[0].rounds.single()
        assertEquals(1, round.toolCalls.size)
        assertEquals("calculator", round.toolCalls[0].name)
        assertEquals("9", round.toolResults[round.toolCalls[0].id])
    }
    @Test
    fun aRelaunchedViewModelSeedsTheStoredJournalIntoItsFirstCut() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val first = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "relaunch",
            provider = ScriptedLiteProvider(mapOf("你好" to listOf(LiteStreamChunk.Text("你好，这里是 Lite。")))),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        first.send("你好")
        advanceUntilIdle()

        // The relaunch constructor replays the stored journal in: the restored
        // conversation reaches the UI through the same construction-time cut,
        // before any new turn runs.
        val relaunched = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "relaunch",
            provider = ScriptedLiteProvider(emptyMap()),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        assertEquals(
            listOf(LiteMessage(role = "user", text = "你好"), LiteMessage(role = "assistant", text = "你好，这里是 Lite。")),
            relaunched.state.conversation,
        )
    }

    @Test
    fun aTurnAfterRelaunchSavesTheWholeRestoredJournal() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val first = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "resume",
            provider = ScriptedLiteProvider(
                mapOf(
                    "第一轮" to listOf(LiteStreamChunk.Text("第一答")),
                    "第二轮" to listOf(LiteStreamChunk.Text("第二答")),
                ),
            ),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        first.send("第一轮")
        advanceUntilIdle()
        first.send("第二轮")
        advanceUntilIdle()
        assertEquals(4, first.state.conversation.size)

        val relaunched = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "resume",
            provider = ScriptedLiteProvider(mapOf("第三轮" to listOf(LiteStreamChunk.Text("第三答")))),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        relaunched.send("第三轮")
        advanceUntilIdle()

        // The post-relaunch save writes the whole journal — the restored turns
        // ride along, so the new turn never replaces the file with itself.
        assertEquals(6, store.load("resume")!!.state.conversation.size)
        assertEquals(6, relaunched.state.conversation.size)
        assertEquals("第三答", relaunched.state.conversation.last().text)
    }

    @Test
    fun aProviderErrorTurnJournalsTheFailureInsteadOfAnEchoRow() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = failingProvider { throw LiteTransportError.Provider("HTTP_401", "provider refused the request") }
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "provider-failed",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        model.send("你好")
        advanceUntilIdle()

        // The failed turn keeps the user row only; the failure lands as its
        // own event, never as an assistant row echoing the prompt back.
        assertEquals(listOf(LiteMessage(role = "user", text = "你好")), model.state.conversation)
        assertEquals(
            listOf(LiteFailure(kind = "provider", code = "HTTP_401", message = "provider refused the request")),
            model.state.errors,
        )
        assertEquals(
            listOf("prompt/accepted", "provider/error", "turn/completed"),
            store.load("provider-failed")!!.events.map { it["type"]!!.jsonPrimitive.content },
        )
    }

    @Test
    fun aNetworkErrorTurnJournalsTheFailureKindInsteadOfAnEchoRow() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = failingProvider { throw LiteTransportError.Network("unreachable") }
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "network-failed",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        model.send("你好")
        advanceUntilIdle()

        assertEquals(listOf(LiteMessage(role = "user", text = "你好")), model.state.conversation)
        assertEquals(
            listOf(LiteFailure(kind = "network", code = "unreachable", message = "unreachable")),
            model.state.errors,
        )
        assertEquals(
            listOf("prompt/accepted", "network/error", "turn/completed"),
            store.load("network-failed")!!.events.map { it["type"]!!.jsonPrimitive.content },
        )
    }

    @Test
    fun anUnreadableJournalQuarantinesToAnEmptyColdOpen() = runTest {
        val directory = tempDir()
        val store = LiteFileSessionStore(directory)
        val corrupt = "不是 JSON\n"
        java.io.File(directory, "corrupt.litejournal").writeText(corrupt)

        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "corrupt",
            provider = ScriptedLiteProvider(mapOf("你好" to listOf(LiteStreamChunk.Text("好")))),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        assertEquals(emptyList(), model.state.conversation)

        // The unreadable bytes survive beside the journal, and the next turn
        // writes a fresh journal under the original name.
        val quarantined = directory.listFiles { file -> file.name.startsWith("corrupt.litejournal.unavailable-") }!!.single()
        assertEquals(corrupt, quarantined.readText())
        assertNull(store.load("corrupt"))

        model.send("你好")
        advanceUntilIdle()
        assertEquals(2, store.load("corrupt")!!.state.conversation.size)
        assertEquals(1, directory.listFiles { file -> file.name.startsWith("corrupt.litejournal.unavailable-") }!!.size)
    }

    /** One provider whose stream script throws before any chunk is delivered. */
    private fun failingProvider(script: suspend FlowCollector<LiteStreamChunk>.() -> Unit): LiteProviding =
        object : LiteProviding {
            override suspend fun stream(prompt: String, system: String?, history: List<LiteTurnRecord>): Flow<LiteStreamChunk> = flow { script() }
        }

    @Test
    fun aHandoffTurnSurfacesTheBannerState() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf("跑测试" to listOf(LiteStreamChunk.ToolCall("c", "run_tests", "{}"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui2",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        model.send("跑测试")
        advanceUntilIdle()

        assertEquals(LITE_REQUIRES_FULL_RUNTIME, model.state.pendingHandoff)
        // The handoff turn keeps the user row only; the journal records the
        // call row in its interrupted state and the marker, never an
        // assistant row echoing the prompt back.
        assertEquals(listOf(LiteMessage(role = "user", text = "跑测试")), model.state.conversation)
        assertEquals(
            listOf("prompt/accepted", "tool/call", "handoff/requested"),
            store.load("ui2")!!.events.map { it["type"]!!.jsonPrimitive.content },
        )
    }

    @Test
    fun aDeclaredCatalogDrivesTheSurfaceHandoff() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf("算一下" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", "1+1"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui5",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = true, text = "2") },
            store = store,
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(
                    ToolDescriptor("calculator", 1, ToolRisk.LOW, emptyList(), supportsLite = false, supportsRemote = true),
                ),
            ),
        )
        model.send("算一下")
        advanceUntilIdle()

        assertEquals(LITE_REQUIRES_FULL_RUNTIME, model.state.pendingHandoff)
        // The declared-not-lite-capable tool hands off like the fallback
        // table does: the user row only, the marker as the terminal event.
        assertEquals(listOf(LiteMessage(role = "user", text = "算一下")), model.state.conversation)
        assertEquals(
            listOf("prompt/accepted", "tool/call", "handoff/requested"),
            store.load("ui5")!!.events.map { it["type"]!!.jsonPrimitive.content },
        )
    }

    @Test
    fun aDeclaredCatalogExecutesTheRealCalculatorThroughTheAssembledChain() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf("算一下" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"(1 + 2) * 3"}"""))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui-exec",
            provider = provider,
            execute = { _, name, arguments ->
                when (name) {
                    "calculator" -> LiteToolExecutors.calculator(arguments)
                    else -> LiteToolOutcome(ok = false, text = "no on-device executor mounted: $name")
                }
            },
            store = store,
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(
                    ToolDescriptor("calculator", 1, ToolRisk.LOW, emptyList(), supportsLite = true, supportsRemote = true),
                ),
            ),
        )
        model.send("算一下")
        advanceUntilIdle()

        // The assembled chain executes the declared calculator on-device; the
        // live fold carries the real evaluator's row, while the journal keeps
        // the re-adjudicated journal face: the call and result rows ride it.
        val tool = model.driver.fold.state.toolCalls.single()
        assertEquals("completed", tool.phase)
        assertEquals("9", tool.resultText)
        assertEquals(
            listOf("prompt/accepted", "tool/call", "tool/result", "message/completed", "turn/completed"),
            store.load("ui-exec")!!.events.map { it["type"]!!.jsonPrimitive.content },
        )
    }

    @Test
    fun aModerateRiskCallSuspendsOnTheApprovalSeamUntilGranted() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf("算一下" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"(1 + 2) * 3"}"""))),
        )
        val grant = CompletableDeferred<Boolean>()
        val asked = mutableListOf<Triple<String, String, String>>()
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui-ask-grant",
            provider = provider,
            execute = { _, _, arguments -> LiteToolExecutors.calculator(arguments) },
            ask = { name, arguments, risk -> asked.add(Triple(name, arguments, risk)); grant.await() },
            store = store,
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(
                    ToolDescriptor("calculator", 1, ToolRisk.MODERATE, emptyList(), supportsLite = true, supportsRemote = true),
                ),
            ),
        )
        val sending = launch { model.send("算一下") }
        advanceUntilIdle()

        // The turn suspends on the seam with the dialog's facts — name,
        // arguments, risk wire word — and nothing has executed yet.
        assertEquals(listOf(Triple("calculator", """{"expression":"(1 + 2) * 3"}""", "moderate")), asked)
        assertTrue(model.driver.running)
        // The call row already landed (tool/call precedes the seam); the
        // suspension point is exactly between it and the execution — the
        // row waits running with no result.
        val waiting = model.driver.fold.state.toolCalls.single()
        assertEquals("running", waiting.phase)
        assertEquals("", waiting.resultText)

        grant.complete(true)
        advanceUntilIdle()
        sending.join()
        val tool = model.driver.fold.state.toolCalls.single()
        assertEquals("completed", tool.phase)
        assertEquals("9", tool.resultText)
    }

    @Test
    fun aDeniedModerateRiskCallFoldsTheFailedResultVocabulary() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf("算一下" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", "1+1"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui-ask-deny",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = true, text = "2") },
            ask = { _, _, _ -> false },
            store = store,
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(
                    ToolDescriptor("calculator", 1, ToolRisk.MODERATE, emptyList(), supportsLite = true, supportsRemote = true),
                ),
            ),
        )
        model.send("算一下")
        advanceUntilIdle()

        // A denial folds the established failed-result vocabulary — zero new
        // tags — and the executor never runs.
        val tool = model.driver.fold.state.toolCalls.single()
        assertEquals("failed", tool.phase)
        assertEquals("user denied on this device: calculator", tool.resultText)
        assertEquals(
            listOf("prompt/accepted", "tool/call", "tool/result", "message/completed", "turn/completed"),
            store.load("ui-ask-deny")!!.events.map { it["type"]!!.jsonPrimitive.content },
        )
    }

    @Test
    fun anAskWithoutAnApprovalSeamDeniesExplicitly() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("算一下" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", "1+1"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui-ask-bare",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = true, text = "2") },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(
                    ToolDescriptor("calculator", 1, ToolRisk.MODERATE, emptyList(), supportsLite = true, supportsRemote = true),
                ),
            ),
        )
        model.send("算一下")
        advanceUntilIdle()

        // No seam mounted means no approval surface: the call denies
        // explicitly rather than executing unconfirmed.
        val tool = model.driver.fold.state.toolCalls.single()
        assertEquals("failed", tool.phase)
        assertEquals("approval unavailable on this device: calculator", tool.resultText)
    }

    @Test
    fun aSecondTurnFeedsTheFirstTurnsToolResultWhileTheJournalKeepsTurnOutcomes() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf(
                "算一下" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", """{"expression":"(1 + 2) * 3"}""")),
                "总结" to listOf(LiteStreamChunk.Text("已记录")),
            ),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui-history",
            provider = provider,
            execute = { _, name, arguments ->
                when (name) {
                    "calculator" -> LiteToolExecutors.calculator(arguments)
                    else -> LiteToolOutcome(ok = false, text = "no on-device executor mounted: $name")
                }
            },
            store = store,
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(
                    ToolDescriptor("calculator", 1, ToolRisk.LOW, emptyList(), supportsLite = true, supportsRemote = true),
                ),
            ),
        )
        model.send("算一下")
        advanceUntilIdle()
        model.send("总结")
        advanceUntilIdle()

        // The second turn's request carries the executed turn as history —
        // the model sees its own call and the evaluator's answer — while
        // the journal keeps the turn outcome beside the call and result rows:
        // rows enter the durable events.
        assertEquals(
            listOf(
                LiteTurnRecord(
                    userText = "算一下",
                    rounds = listOf(
                        LiteTurnRound(
                            assistantText = "",
                            toolCalls = listOf(LiteTurnToolCall(id = "c1", name = "calculator", arguments = """{"expression":"(1 + 2) * 3"}""")),
                            toolResults = mapOf("c1" to "9"),
                        ),
                    ),
                ),
            ),
            provider.submittedHistories[1],
        )
        assertEquals(
            listOf(
                "prompt/accepted", "tool/call", "tool/result", "message/completed", "turn/completed",
                "prompt/accepted", "message/completed", "turn/completed",
            ),
            store.load("ui-history")!!.events.map { it["type"]!!.jsonPrimitive.content },
        )
    }

    @Test
    fun aNormalTurnAfterAHandoffTurnJournalsACompletedTurnNotARepeatedHandoff() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val provider = ScriptedLiteProvider(
            mapOf(
                "跑测试" to listOf(LiteStreamChunk.ToolCall("c", "run_tests", "{}")),
                "总结" to listOf(LiteStreamChunk.Text("已记录")),
            ),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "handoff-then-normal",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        model.send("跑测试")
        advanceUntilIdle()
        model.send("总结")
        advanceUntilIdle()

        // The second turn supersedes the handoff: the banner state cleared
        // with its prompt, and the journal ends in the normal terminal pair,
        // not a second handoff/requested.
        assertEquals(null, model.state.pendingHandoff)
        assertEquals("completed", model.state.lastTurnEnd)
        assertEquals(
            listOf(
                LiteMessage(role = "user", text = "跑测试"),
                LiteMessage(role = "user", text = "总结"),
                LiteMessage(role = "assistant", text = "已记录"),
            ),
            model.state.conversation,
        )
        assertEquals(
            listOf(
                "prompt/accepted", "tool/call", "handoff/requested",
                "prompt/accepted", "message/completed", "turn/completed",
            ),
            store.load("handoff-then-normal")!!.events.map { it["type"]!!.jsonPrimitive.content },
        )
    }

    @Test
    fun aRelaunchEndingAtTheHandoffMarkerSeedsTheBannerState() = runTest {
        val store = LiteFileSessionStore(tempDir())
        val first = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "handoff-relaunch",
            provider = ScriptedLiteProvider(mapOf("跑测试" to listOf(LiteStreamChunk.ToolCall("c", "run_tests", "{}")))),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        first.send("跑测试")
        advanceUntilIdle()

        // The journal ends in handoff/requested, so the relaunch's
        // construction-time cut exposes the banner state before any new turn.
        val relaunched = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "handoff-relaunch",
            provider = ScriptedLiteProvider(emptyMap()),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, relaunched.state.pendingHandoff)
        assertEquals(listOf(LiteMessage(role = "user", text = "跑测试")), relaunched.state.conversation)
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
        // An unconfined collector receives each set synchronously, so every
        // intermediate cut lands before the next overwrites it.
        val emissions = mutableListOf<LiteDomainState>()
        val collector = launch(UnconfinedTestDispatcher(testScheduler)) {
            model.liveState.toList(emissions)
        }
        model.send("算一下")
        advanceUntilIdle()
        collector.cancel()

        assertEquals(
            listOf(
                // The initial cut is the empty journal.
                listOf(false, "", emptyList<String>(), 0, null),
                // prompt/accepted — the user row lands, the stream not yet live.
                listOf(false, "", emptyList<String>(), 1, null),
                // stream/delta 你, then 好 — the partial grows.
                listOf(true, "你", emptyList<String>(), 1, null),
                listOf(true, "你好", emptyList<String>(), 1, null),
                // tool/call folds running; tool/result completes the row.
                listOf(true, "你好", listOf("running"), 1, null),
                listOf(true, "你好", listOf("completed"), 1, null),
                // message/completed — the assistant row lands, the stream resets.
                listOf(false, "", listOf("completed"), 2, null),
                // turn/completed — only the turn end moves.
                listOf(false, "", listOf("completed"), 2, "completed"),
                // The persisted journal replay — chapter 64 re-adjudicated,
                // the turn's tool rows ride the journal, so the replayed
                // state carries the completed call row.
                listOf(false, "", listOf("completed"), 2, "completed"),
            ),
            emissions.map { cut(it) },
        )
    }

    /** One emission compressed to what the sequence pins. */
    private fun cut(state: LiteDomainState) = listOf(
        state.streaming.active,
        state.streaming.partialText,
        state.toolCalls.map { it.phase },
        state.conversation.size,
        state.lastTurnEnd,
    )

    @Test
    fun aPresetCatalogDrivesTheDefaultPresetSystemToTheDriver() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("你好" to listOf(LiteStreamChunk.Text("早"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui6",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            presetCatalog = LitePresetCatalog.fromHostProjection(
                listOf(preset(id = "later", order = 5), preset(id = "default-one", order = 1)),
            ),
        )
        model.send("你好")
        advanceUntilIdle()

        // The lowest-order preset's assembled system prompt reaches the
        // provider; the journal keeps user/assistant rows only.
        assertEquals(listOf<String?>("sample-assembled-default-one"), provider.submittedSystems)
        assertEquals(
            listOf(LiteMessage(role = "user", text = "你好"), LiteMessage(role = "assistant", text = "早")),
            model.state.conversation,
        )
        assertEquals("completed", model.state.lastTurnEnd)
    }

    @Test
    fun anExplicitPresetSelectionDrivesThatPresetsSystemToTheDriver() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("你好" to listOf(LiteStreamChunk.Text("早"))),
        )
        val catalog = LitePresetCatalog.fromHostProjection(
            listOf(preset(id = "later", order = 5), preset(id = "default-one", order = 1)),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui8",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            presetCatalog = catalog,
            selectedPreset = catalog.resolve("later"),
        )
        model.send("你好")
        advanceUntilIdle()

        // The explicitly selected preset wins over the lower-order default;
        // its prompt is the selected entry's own assembled text.
        assertEquals(listOf<String?>("sample-assembled-later"), provider.submittedSystems)
        assertEquals("later", model.facts.presetId)
    }

    @Test
    fun withoutAProjectionTheTurnStaysBare() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("你好" to listOf(LiteStreamChunk.Text("早"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui7",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
        )
        model.send("你好")
        advanceUntilIdle()

        assertEquals(listOf<String?>(null), provider.submittedSystems)
        assertEquals(2, model.state.conversation.size)
    }

    /** One synthetic descriptor; preset prose belongs to the Host projection, never here. */
    private fun preset(id: String, order: Long): LitePresetDescriptor =
        LitePresetDescriptor(
            id = id,
            order = order,
            persona = LitePresetPersona(prefix = "sample-prefix-$id", suffix = null, complete = true),
            includeRuntimeContext = false,
            assembledSystemPrompt = "sample-assembled-$id",
        )
}
