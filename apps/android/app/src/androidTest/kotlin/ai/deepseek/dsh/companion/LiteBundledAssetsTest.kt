package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptors
import ai.deepseek.dsh.contract.LiteToolSchemas
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Lite projection pair the build copies into assets/lite/: under
 * instrumentation both asset paths open, their bytes parse through the shared
 * contract parsers, and the assembled session chain builds over the BUNDLED
 * catalogs without touching the network.
 */
class LiteBundledAssetsTest {

    private fun targetContext() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun bothBundledAssetPathsOpenAndTheirBytesParse() {
        val schemas = targetContext().assets.open("lite/lite-tool-schemas.json").use { stream ->
            stream.readBytes().decodeToString()
        }
        val presets = targetContext().assets.open("lite/lite-preset-descriptors.json").use { stream ->
            stream.readBytes().decodeToString()
        }
        assertTrue(LiteToolSchemas.parseDocument(schemas).isNotEmpty())
        assertTrue(LitePresetDescriptors.parseDocument(presets).isNotEmpty())
    }

    @Test
    fun liteAssetsLoadsBundledCatalogsAndTheAssemblerBuildsTheChain() {
        val bundled = LiteAssets.load(targetContext())
        assertEquals(LiteToolSchemaSource.BUNDLED, bundled.toolSchemas.source)
        assertEquals(LitePresetSource.BUNDLED, bundled.presets.source)
        assertTrue(bundled.toolSchemas.tools.isNotEmpty())
        assertTrue(bundled.presets.presets.isNotEmpty())

        val model = LiteSessionAssembler.assemble(
            context = targetContext(),
            scope = CoroutineScope(Dispatchers.Unconfined),
            sessionId = "lite-bundled-assets-test",
            endpoint = "https://lite-bundle.invalid/chat/completions",
            apiKey = "unused",
            model = "unused",
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
        )
        assertTrue(model.state.conversation.isEmpty())
    }
}
