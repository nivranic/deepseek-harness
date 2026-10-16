package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptors
import ai.deepseek.dsh.contract.LiteToolSchemas
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The BUNDLED source: the APK's carried Host-projection bytes parse through
 * the shared document parsers under the same rules as a live Host projection,
 * and stay observable as their own source — never a disguised
 * HOST_PROJECTED or BARE selection.
 */
class LiteBundledCatalogTest {

    @Test
    fun bundledToolSchemasMatchTheHostProjectedCatalogUnderTheirOwnSource() {
        val sample = javaClass.classLoader.getResource("fixtures/lite-tool-schemas.sample.json")!!
        val text = sample.readText(Charsets.UTF_8)
        val bundled = LiteToolSchemaCatalog.fromBundledProjection(LiteToolSchemas.parseDocument(text))
        assertEquals(LiteToolSchemaSource.BUNDLED, bundled.source)
        // The same document through the Host-projected factory yields the same
        // entries — the bundle changes observability, never parsing.
        assertEquals(LiteToolSchemaCatalog.fromProjectedDocument(Json.parseToJsonElement(text)).tools, bundled.tools)
        assertFalse(bundled.tools.isEmpty())
    }

    @Test
    fun bundledPresetsMatchTheHostProjectedSelectionUnderTheirOwnSource() {
        val sample = javaClass.classLoader.getResource("fixtures/lite-presets.sample.json")!!
        val descriptors = LitePresetDescriptors.parseDocument(sample.readText(Charsets.UTF_8))
        val bundled = LitePresetCatalog.fromBundledProjection(descriptors)
        assertEquals(LitePresetSource.BUNDLED, bundled.source)
        val projected = LitePresetCatalog.fromHostProjection(descriptors)
        assertEquals(projected.presets, bundled.presets)
        assertEquals(projected.default, bundled.default)
        assertEquals(projected.defaultSystemPrompt, bundled.defaultSystemPrompt)
        assertEquals("minimal", bundled.default?.id)
    }

    @Test
    fun anEmptyBundledProjectionKeepsTheExplicitSource() {
        assertEquals(LiteToolSchemaSource.BUNDLED, LiteToolSchemaCatalog.fromBundledProjection(emptyList()).source)
        assertTrue(LiteToolSchemaCatalog.fromBundledProjection(emptyList()).tools.isEmpty())
        val presets = LitePresetCatalog.fromBundledProjection(emptyList())
        assertEquals(LitePresetSource.BUNDLED, presets.source)
        assertNull(presets.default)
    }

    @Test
    fun malformedBundledDocumentsFailLoudThroughTheSharedParser() {
        assertFailsWith<IllegalArgumentException> {
            LiteToolSchemaCatalog.fromBundledProjection(LiteToolSchemas.parseDocument("null"))
        }
        assertFailsWith<IllegalArgumentException> {
            LitePresetCatalog.fromBundledProjection(LitePresetDescriptors.parseDocument("{}"))
        }
    }
}
