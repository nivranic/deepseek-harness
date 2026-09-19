package ai.deepseek.dsh.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Kotlin half of the Lite Behavior-Spec conformance: every golden
 * scenario under `src/test/resources/lite-conformance` — the same bytes the
 * TypeScript reference fold produced and the Swift Lite fold replays — must
 * fold to the identical domain state here.
 */
class LiteConformanceTest {
    private fun scenarios(): List<Pair<String, String>> {
        val dir = javaClass.getResource("/lite-conformance") ?: return emptyList()
        val path = java.nio.file.Paths.get(dir.toURI())
        return java.nio.file.Files.list(path).use { stream ->
            stream
                .filter { it.fileName.toString().endsWith(".json") }
                .sorted()
                .map { it.fileName.toString() to java.nio.file.Files.readString(it) }
                .toList()
        }
    }

    @Test
    fun everyScenarioFoldsToTheReferenceState() {
        val found = scenarios()
        assertTrue(found.isNotEmpty(), "no lite conformance scenarios found on the classpath")
        for ((name, text) in found) {
            val (events, expected) = parseLiteScenario(text)
            assertEquals(expected, foldLiteDomain(events).toJson(), "scenario $name diverged from the reference fold")
        }
    }
}

/** The fold semantics the fixtures pin, exercised one behavior at a time. */
class LiteFoldTest {
    private fun events(json: String): JsonArray = Json.parseToJsonElement(json) as JsonArray

    @Test
    fun cancelFinalizesTheDeliveredPrefixAsAnInterruptedRow() {
        val state = foldLiteDomain(
            events(
                """[
                    {"type":"prompt/accepted","requestId":"r1","content":"重构成 SwiftUI"},
                    {"type":"stream/delta","text":"第一步"},
                    {"type":"stream/delta","text":"：拆分视图。"},
                    {"type":"turn/cancelled","reason":"user"}
                ]""",
            ),
        )
        assertEquals(
            listOf(
                LiteMessage(role = "user", text = "重构成 SwiftUI"),
                LiteMessage(role = "assistant", text = "第一步：拆分视图。", interrupted = true),
            ),
            state.conversation,
        )
        assertEquals(true, state.interrupted)
        assertEquals(LiteStreaming(), state.streaming)
        assertEquals("cancelled", state.lastTurnEnd)
    }

    @Test
    fun aCancelWithoutDeliveredTextPushesNoRow() {
        val state = foldLiteDomain(
            events(
                """[
                    {"type":"prompt/accepted","requestId":"r1","content":"你好"},
                    {"type":"turn/cancelled","reason":"user"}
                ]""",
            ),
        )
        assertEquals(1, state.conversation.size)
        assertEquals(false, state.interrupted)
    }

    @Test
    fun networkDropKeepsThePrefixWhileProviderErrorClearsIt() {
        val dropped = foldLiteDomain(
            events(
                """[
                    {"type":"stream/delta","text":"好的"},
                    {"type":"network/error","kind":"dropped"}
                ]""",
            ),
        )
        assertEquals(LiteStreaming(active = false, partialText = "好的", partialReasoning = ""), dropped.streaming)
        assertEquals(listOf(LiteFailure(kind = "network", code = "dropped", message = "dropped")), dropped.errors)
        assertEquals("network-error", dropped.lastTurnEnd)

        val provider = foldLiteDomain(
            events(
                """[
                    {"type":"stream/delta","text":"好的"},
                    {"type":"provider/error","code":"RATE_LIMITED","message":"并发超限"}
                ]""",
            ),
        )
        assertEquals(LiteStreaming(), provider.streaming)
        assertEquals(listOf(LiteFailure(kind = "provider", code = "RATE_LIMITED", message = "并发超限")), provider.errors)
        assertEquals("provider-error", provider.lastTurnEnd)
    }

    @Test
    fun promptRejectionRecordsTheProviderError() {
        val state = foldLiteDomain(
            events("""[{"type":"prompt/rejected","requestId":"r6","reason":"运行中不可插入"}]"""),
        )
        assertEquals(listOf(LiteFailure(kind = "provider", code = "PROMPT_REJECTED", message = "运行中不可插入")), state.errors)
    }

    @Test
    fun toolResultsPairByIdAndOrphansAreNoOps() {
        val state = foldLiteDomain(
            events(
                """[
                    {"type":"tool/call","id":"c1","name":"web_search","arguments":"{}"},
                    {"type":"tool/result","id":"c1","ok":true,"text":"找到 3 篇。"},
                    {"type":"tool/result","id":"ghost","ok":false,"text":"孤儿"}
                ]""",
            ),
        )
        assertEquals(listOf("completed"), state.toolCalls.map { it.phase })
        assertEquals("找到 3 篇。", state.toolCalls[0].resultText)
    }

    @Test
    fun reasoningStreamsIntoItsOwnPartial() {
        val state = foldLiteDomain(
            events(
                """[
                    {"type":"stream/reasoning","text":"先找"},
                    {"type":"stream/reasoning","text":"要点…"}
                ]""",
            ),
        )
        assertEquals(LiteStreaming(active = true, partialText = "", partialReasoning = "先找要点…"), state.streaming)
    }
}
