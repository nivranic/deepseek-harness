package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkChunkRowKind
import ai.deepseek.dsh.link.LinkDeviceRole
import ai.deepseek.dsh.link.LinkImageMediaType
import ai.deepseek.dsh.link.LinkSubagentDiagnosticReason
import ai.deepseek.dsh.link.LinkTodoStatus
import ai.deepseek.dsh.link.LinkTurnEndReasonKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Kotlin half of the chapter-62 trilingual conformance: every golden
 * scenario under `src/test/resources/conformance` — the same bytes the
 * TypeScript reference fold produced and the Swift fold replays — must fold
 * to the identical domain state here.
 */
class ConformanceTest {
    private fun scenarios(): List<Pair<String, String>> {
        val dir = javaClass.getResource("/conformance") ?: return emptyList()
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
        assertTrue(found.isNotEmpty(), "no conformance scenarios found on the classpath")
        for ((name, text) in found) {
            val (records, expected) = parseScenario(text)
            assertEquals(expected, foldDomain(records).toJson(), "scenario $name diverged from the reference fold")
        }
    }

    @Test
    fun imageBlocksRenderTheSharedInlineSummary() {
        val record = Json.parseToJsonElement(
            """
            {"type":"event","event":{"type":"user/message","seq":1,"data":{
              "id":"m1","role":"user",
              "content":[
                {"type":"text","text":"这张截图有问题"},
                {"type":"image","attachment":{"attachmentId":"att-1","mediaType":"image/png","bytes":52444,"width":800,"height":600,"name":"screenshot.png"}}
              ],
              "source":{"kind":"user"}}}}
            """.trimIndent(),
        ).jsonObject
        val state = foldDomain(kotlinx.serialization.json.JsonArray(listOf(record)))
        assertEquals(1, state.images.size)
        assertEquals("att-1", state.images[0].attachmentId)
        assertEquals(
            "这张截图有问题\n图片 screenshot.png（image/png，800×600）",
            state.items.last().text,
        )
    }

    @Test
    fun toolResultsPairByMessageToolCallIdWithFlatContent() {
        val (records, _) = parseScenario(
            """
            {"records":[
              {"type":"event","event":{"type":"tool/call","seq":1,"data":{
                "turn":1,"step":1,"callId":"call-1","name":"write","arguments":"{}"}}},
              {"type":"event","event":{"type":"tool/call","seq":2,"data":{
                "turn":1,"step":1,"callId":"call-2","name":"test","arguments":"{}"}}},
              {"type":"event","event":{"type":"tool/result","seq":3,"data":{
                "turn":1,"step":1,"message":{"id":"m-2","role":"tool","toolCallId":"call-2",
                  "content":[{"type":"text","text":"failed"}],"source":{"kind":"tool","callId":"call-2"}},
                "error":{"name":"ToolError","code":"EXIT_1"}}}},
              {"type":"event","event":{"type":"tool/result","seq":4,"data":{
                "turn":1,"step":1,"message":{"id":"m-x","role":"tool","toolCallId":"call-x",
                  "content":[{"type":"text","text":"orphan"}],"source":{"kind":"tool","callId":"call-x"}}}}},
              {"type":"event","event":{"type":"tool/result","seq":5,"data":{
                "turn":1,"step":1,"message":{"id":"m-1","role":"tool","toolCallId":"call-1",
                  "content":[{"type":"text","text":"done"}],"source":{"kind":"tool","callId":"call-1"}}}}}
            ]}
            """.trimIndent(),
        )
        val state = foldDomain(records)
        assertEquals(listOf("call-1", "call-2"), state.toolCalls.map { it.id })
        assertEquals(listOf("completed", "failed"), state.toolCalls.map { it.phase })
        assertEquals(listOf("done", "failed"), state.toolCalls.map { it.resultText })
        assertEquals("done", state.items.last().text)
    }

    @Test
    fun assistantAttemptsRenderPackedAndRawTextWithoutReasoningOrToolChunks() {
        val (records, _) = parseScenario(
            """
            {"records":[
              {"type":"event","event":{"type":"assistant/attempt","seq":1,"data":{
                "turn":1,"step":1,"stream":[
                  {"type":"text-chunks","time0":1000,"index":0,"dt":[1],"texts":["Hello"," "]},
                  {"type":"reasoning-chunks","time0":1002,"index":0,"dt":[],"texts":["hidden reasoning"]},
                  {"type":"chunk","time":1003,"chunk":{"type":"text-delta","text":"world"}},
                  {"type":"chunk","time":1004,"chunk":{"type":"reasoning-delta","text":"hidden reasoning"}},
                  {"type":"tool-call-chunks","time0":1005,"index":0,"dt":[],"id":"call-1","args":["{}"]},
                  {"type":"chunk","time":1006,"chunk":{"type":"tool-call-delta","text":"hidden tool"}},
                  {"type":"text-chunks","time0":1007,"index":0,"dt":[],"texts":["!"]}
                ]}}},
              {"type":"event","event":{"type":"assistant/chunk","seq":2,"data":{
                "turn":1,"step":1,"chunk":{"type":"text-delta","text":"removed event"}}}}
            ]}
            """.trimIndent(),
        )
        val state = foldDomain(records)
        assertEquals(listOf("Hello world!", ""), state.items.map { it.text })
    }
}

/** The generated vocabulary carries the wire tags verbatim; a drift here
 * fails the contract gate before it reaches a device. */
class VocabularyTest {
    @Test
    fun enumsCarryTheWireTags() {
        assertEquals("observer", LinkDeviceRole.OBSERVER.wire)
        assertEquals("administrator", LinkDeviceRole.ADMINISTRATOR.wire)
        assertEquals("chunkrow/tool-call-chunks", LinkChunkRowKind.CHUNKROW_TOOL_CALL_CHUNKS.wire)
        assertEquals("in_progress", LinkTodoStatus.IN_PROGRESS.wire)
        assertEquals("max-tokens", LinkTurnEndReasonKind.MAX_TOKENS.wire)
        assertEquals("image/webp", LinkImageMediaType.IMAGE_WEBP.wire)
        assertEquals("corrupt", LinkSubagentDiagnosticReason.CORRUPT.wire)
    }
}

/** Chapter 60's baseline: Android ships Minimal Neumorphic only, so the
 * tokens must actually describe a raised dual-tone surface. */
class NeumorphicTokensTest {
    @Test
    fun baselineDescribesARaisedDualToneSurface() {
        assertTrue(NeumorphicTokens.shadowLight != NeumorphicTokens.shadowDark, "the shadow pair must be two tones")
        assertTrue(NeumorphicTokens.cornerRadius > 0 && NeumorphicTokens.shadowBlur > 0)
        assertTrue(NeumorphicTokens.spacing == 8.0, "the spacing step stays on the eight-point grid")
    }
}
