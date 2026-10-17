package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptor
import ai.deepseek.dsh.contract.LitePresetPersona
import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolRisk
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
            override suspend fun stream(prompt: String, system: String?): Flow<LiteStreamChunk> = flow { script() }
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
    fun aDeclaredCatalogDrivesTheSurfaceHandoff() = runTest {
        val provider = ScriptedLiteProvider(
            mapOf("算一下" to listOf(LiteStreamChunk.ToolCall("c1", "calculator", "1+1"))),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "ui5",
            provider = provider,
            execute = { _, _, _ -> LiteToolOutcome(ok = true, text = "2") },
            toolCatalog = LiteToolCatalog.fromHostDescriptors(
                listOf(
                    ToolDescriptor("calculator", 1, ToolRisk.LOW, emptyList(), supportsLite = false, supportsRemote = true),
                ),
            ),
        )
        model.send("算一下")
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
                // The persisted journal replay — the turn-outcome events carry
                // no tool rows, by the chapter-64 fidelity rule.
                listOf(false, "", emptyList<String>(), 2, "completed"),
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
