package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptors
import ai.deepseek.dsh.contract.LiteToolSchemas
import ai.deepseek.dsh.contract.ToolDescriptors
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Lite documents the build copies into assets/lite/: under
 * instrumentation every asset path opens, the bytes parse through the shared
 * contract parsers, the device declarations union with the Host projection
 * into the BUNDLED dispatch catalog while the device schemas union with the
 * Host projection into the provider's BUNDLED tool schemas, and the
 * assembled session chain builds without touching the network.
 */
class LiteBundledAssetsTest {

    private fun targetContext() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun everyBundledAssetPathOpensAndItsBytesParse() {
        val schemas = targetContext().assets.open("lite/lite-tool-schemas.json").use { stream ->
            stream.readBytes().decodeToString()
        }
        val deviceSchemas = targetContext().assets.open("lite/lite-device-tool-schemas.json").use { stream ->
            stream.readBytes().decodeToString()
        }
        val presets = targetContext().assets.open("lite/lite-preset-descriptors.json").use { stream ->
            stream.readBytes().decodeToString()
        }
        val deviceDeclarations = targetContext().assets.open("lite/lite-tool-declarations.json").use { stream ->
            stream.readBytes().decodeToString()
        }
        val hostToolDescriptors = targetContext().assets.open("lite/tool-descriptors.json").use { stream ->
            stream.readBytes().decodeToString()
        }
        assertTrue(LiteToolSchemas.parseDocument(schemas).isNotEmpty())
        assertTrue(LiteToolSchemas.parseDocument(deviceSchemas).isNotEmpty())
        assertTrue(LitePresetDescriptors.parseDocument(presets).isNotEmpty())
        assertTrue(ToolDescriptors.parseDocument(deviceDeclarations).isNotEmpty())
        assertTrue(ToolDescriptors.parseDocument(hostToolDescriptors).isNotEmpty())
    }

    @Test
    fun liteAssetsLoadsBundledCatalogsAndTheAssemblerBuildsTheUnionChain() {
        val bundled = LiteAssets.load(targetContext())
        assertEquals(LiteToolSchemaSource.BUNDLED, bundled.toolSchemas.source)
        assertEquals(LitePresetSource.BUNDLED, bundled.presets.source)
        assertTrue(bundled.toolSchemas.tools.isNotEmpty())
        assertTrue(bundled.deviceToolSchemas.isNotEmpty())
        assertTrue(bundled.presets.presets.isNotEmpty())
        assertTrue(bundled.deviceToolDeclarations.isNotEmpty())
        assertTrue(bundled.hostToolDescriptors.isNotEmpty())

        // The schema union the assembler mounts on the provider: the Host
        // projection's web_search once, plus each device schema once.
        assertEquals(
            listOf("web_search", "calculator", "artifact_create"),
            LiteToolSchemaCatalog.fromBundledDocuments(bundled.toolSchemas.tools, bundled.deviceToolSchemas).tools.map { it.name },
        )

        val union = LiteToolCatalog.fromBundledDocuments(bundled.deviceToolDeclarations, bundled.hostToolDescriptors)
        assertEquals(LiteToolSource.BUNDLED, union.source)
        assertTrue(
            "web_search resolves through the Host side of the union",
            union.declaration("web_search")?.supportsLite == true,
        )

        val model = LiteSessionAssembler.assemble(
            context = targetContext(),
            scope = CoroutineScope(Dispatchers.Unconfined),
            sessionId = "lite-bundled-assets-test",
            endpoint = "https://lite-bundle.invalid/chat/completions",
            apiKey = "unused",
            model = "unused",
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
        )
        assertEquals(LiteToolSource.BUNDLED, model.facts.toolCatalogSource)
        assertTrue(model.state.conversation.isEmpty())
    }
}
