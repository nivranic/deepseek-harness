package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptor
import ai.deepseek.dsh.contract.LitePresetPersona
import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolDescriptors
import ai.deepseek.dsh.contract.ToolRisk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assumptions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The fact snapshot one assembled session publishes: the literal runtime-mode
 * word, the three catalog sources as the bundled assembly runs them, the
 * preset actually in effect, and the registry-derived local tool names —
 * never a handoff name, never a Host capability mirror.
 */
class LiteSessionFactsTest {

    @Test
    fun theDefaultFactsStateTheBundledAssemblySources() {
        val facts = LiteSessionFacts()
        assertEquals("lite", facts.runtimeMode)
        assertEquals(LiteToolSource.BUNDLED_FALLBACK, facts.toolCatalogSource)
        assertEquals(LiteToolSchemaSource.BUNDLED, facts.toolSchemasSource)
        assertEquals(LitePresetSource.BUNDLED, facts.presetSource)
    }

    @Test
    fun presetIdStaysNullUntilASelectionResolves() {
        assertNull(LiteSessionFacts().presetId, "the construction face names no preset; a resolved id is catalog data, never a constant")
    }

    @Test
    fun theViewModelFactsNameTheCatalogDefaultOnceOneExists() = runTest {
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "facts-default-preset",
            provider = ScriptedLiteProvider(emptyMap()),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            presetCatalog = LitePresetCatalog.fromHostProjection(
                listOf(LitePresetDescriptor(
                    id = "default-one",
                    order = 1,
                    persona = LitePresetPersona(prefix = "sample-prefix", suffix = null, complete = true),
                    includeRuntimeContext = false,
                    assembledSystemPrompt = "sample-assembled-default-one",
                )),
            ),
        )
        assertEquals("default-one", model.facts.presetId, "the default selection resolves to the lowest order and its id is observable")
    }

    @Test
    fun bundledLocalToolNamesMirrorTheRegistryWithoutHandoffTools() {
        val facts = LiteSessionFacts()
        assertEquals(LiteToolRegistry.localToolNames, facts.bundledLocalToolNames)
        assertEquals(
            listOf("web_search", "url_fetch", "image_inspect", "attachment_read", "artifact_create", "calculator"),
            facts.bundledLocalToolNames,
        )
        val handingOff = LiteToolRegistry.bundled.filter { it.fallbackCapability != null }.map { it.name }
        assertTrue(handingOff.isNotEmpty(), "the registry must keep at least one handoff tool for the exclusion to mean anything")
        assertTrue(facts.bundledLocalToolNames.none { it in handingOff })
    }

    @Test
    fun theViewModelCarriesTheDefaultFactsWithoutExplicitConstruction() = runTest {
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "facts-default",
            provider = ScriptedLiteProvider(emptyMap()),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
        )
        assertEquals(LiteSessionFacts(), model.facts)
    }

    /**
     * The union path the app assembler wires (parsed documents fed directly;
     * no asset IO): a session constructed over the APK-frozen union catalog
     * discloses the BUNDLED tool-catalog source, never the fallback default.
     */
    @Test
    fun theUnionAssembledFactsNameTheBundledToolCatalogSource() = runTest {
        val device = javaClass.classLoader.getResource("lite-tool-declarations.json")
        val host = javaClass.classLoader.getResource("tool-descriptors.json")
        Assumptions.assumeTrue(
            device != null && host != null,
            "the bundled tool-declaration documents have not been copied into test resources yet; the integration stage reruns this mirror",
        )
        val toolCatalog = LiteToolCatalog.fromBundledDocuments(
            ToolDescriptors.parseDocument(device!!.readText(Charsets.UTF_8)),
            ToolDescriptors.parseDocument(host!!.readText(Charsets.UTF_8)),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "facts-bundled-union",
            provider = ScriptedLiteProvider(emptyMap()),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            toolCatalog = toolCatalog,
            facts = LiteSessionFacts(toolCatalogSource = toolCatalog.source),
        )
        assertEquals(LiteToolSource.BUNDLED, model.facts.toolCatalogSource)
    }

    /**
     * The live-union path the paired shell assembles: a session constructed
     * over the device declarations union the Host's live-served declaration
     * discloses the HOST_DECLARED tool-catalog source — the live Host arm of
     * the enum, never a fourth value.
     */
    @Test
    fun theLiveUnionAssembledFactsNameTheHostDeclaredToolCatalogSource() = runTest {
        val toolCatalog = LiteToolCatalog.fromDeviceAndLiveHostDeclarations(
            listOf(ToolDescriptor("calculator", 1, ToolRisk.LOW, emptyList(), supportsLite = true, supportsRemote = true)),
            listOf(ToolDescriptor("web_search", 1, ToolRisk.LOW, listOf("net.search"), supportsLite = true, supportsRemote = true)),
        )
        val model = LiteChatViewModel(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            sessionId = "facts-live-union",
            provider = ScriptedLiteProvider(emptyMap()),
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            toolCatalog = toolCatalog,
            facts = LiteSessionFacts(toolCatalogSource = toolCatalog.source),
        )
        assertEquals(LiteToolSource.HOST_DECLARED, model.facts.toolCatalogSource)
    }
}
