package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptor
import ai.deepseek.dsh.contract.LitePresetPersona
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
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
}
