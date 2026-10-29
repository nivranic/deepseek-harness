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
