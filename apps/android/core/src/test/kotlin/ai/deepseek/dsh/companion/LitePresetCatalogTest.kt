package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptor
import ai.deepseek.dsh.contract.LitePresetDescriptors
import ai.deepseek.dsh.contract.LitePresetPersona
import org.junit.jupiter.api.Assumptions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The §33 preset selection: the Host projection drives the default preset,
 * the lowest order wins, and a session without a projection runs bare. The
 * generated Host projection cross-checks the fixed-prompt preset class for
 * assembled, template-free system prompts once lane A's generator lands.
 */
class LitePresetCatalogTest {

    @Test
    fun theDefaultPresetIsTheLowestOrder() {
        val catalog = LitePresetCatalog.fromHostProjection(
            listOf(preset(id = "later", order = 5), preset(id = "default-one", order = 1)),
        )
        assertEquals(LitePresetSource.HOST_PROJECTED, catalog.source)
        assertEquals(listOf("later", "default-one"), catalog.presets.map { it.id })
        assertEquals("default-one", catalog.default?.id)
        assertEquals("sample-assembled-default-one", catalog.defaultSystemPrompt)
    }

    @Test
    fun bareModeSendsNoSystem() {
        assertEquals(LitePresetSource.BARE, LitePresetCatalog.BARE.source)
        assertTrue(LitePresetCatalog.BARE.presets.isEmpty())
        assertNull(LitePresetCatalog.BARE.default)
        assertNull(LitePresetCatalog.BARE.defaultSystemPrompt)
    }

    @Test
    fun lookupByIdHitsCarriedPresetsAndMissesTheRest() {
        val catalog = LitePresetCatalog.fromHostProjection(
            listOf(preset(id = "later", order = 5), preset(id = "default-one", order = 1)),
        )
        assertEquals("later", catalog.preset("later")?.id)
        assertEquals("default-one", catalog.preset("default-one")?.id)
        assertNull(catalog.preset("ghost"), "an id the catalog does not carry reads as absent, not as the default")
    }

    @Test
    fun resolveTakesExplicitIdsAndDefaultsAndFailsLoudOnUnknownOnes() {
        val catalog = LitePresetCatalog.fromHostProjection(
            listOf(preset(id = "later", order = 5), preset(id = "default-one", order = 1)),
        )
        assertEquals("later", catalog.resolve("later")?.id, "an explicit id wins over the lower-order default")
        assertEquals("default-one", catalog.resolve(null)?.id, "a null id is the default selection, byte-identical to the unnamed behavior")
        val failure = assertFailsWith<IllegalArgumentException> { catalog.resolve("ghost") }
        // §32/§33 forbid guessing a substitute: the refusal names the requested id and the catalog's carried ids.
        assertTrue("ghost" in failure.message!!, "the refusal must name the unknown id")
        assertTrue("later" in failure.message!! && "default-one" in failure.message!!, "the refusal must name the catalog")
    }

    @Test
    fun resolveOnABareCatalogStaysNullForDefaultsAndFailsLoudForIds() {
        assertNull(LitePresetCatalog.BARE.resolve(null), "no projection leaves no default to resolve")
        assertFailsWith<IllegalArgumentException> { LitePresetCatalog.BARE.resolve("minimal") }
    }

    @Test
    fun anEmptyProjectionKeepsTheExplicitSourceWithoutADefault() {
        val catalog = LitePresetCatalog.fromHostProjection(emptyList())
        assertEquals(LitePresetSource.HOST_PROJECTED, catalog.source)
        assertNull(catalog.default)
        assertNull(catalog.defaultSystemPrompt)
    }

    @Test
    fun theSampleFixtureDrivesOneCatalog() {
        val sample = javaClass.classLoader.getResource("fixtures/lite-presets.sample.json")!!
        val catalog = LitePresetCatalog.fromHostProjection(LitePresetDescriptors.parseDocument(sample.readText(Charsets.UTF_8)))
        assertEquals(LitePresetSource.HOST_PROJECTED, catalog.source)
        // The fixture mirrors the projection's shape: minimal (order 3) is the
        // fixed-prompt default against future-preset (order 7).
        assertEquals("minimal", catalog.default?.id)
        assertEquals("sample-assembled-minimal", catalog.defaultSystemPrompt)
    }

    /**
     * The real projection at
     * `packages/preset/agent-presets/lite-preset-descriptors.json` (copied
     * into test resources by copyLitePresets): the runtime-variable presets
     * (standard, ptc) stay on the exclusion list, the fixed-prompt class
     * (minimal) is present, and its already-assembled system prompts carry no
     * un-interpolated `{{…}}` template residue. The sample fixture
     * `fixtures/lite-presets.sample.json` keeps the same schema for behavior
     * tests and is refreshed by rerunning that projection.
     */
    @Test
    fun theHostProjectionCarriesAssembledFixedPromptPresets() {
        val resource = javaClass.classLoader.getResource("lite-preset-descriptors.json")
        Assumptions.assumeTrue(
            resource != null,
            "packages/preset/agent-presets/lite-preset-descriptors.json has not been generated yet; the integration stage reruns this cross-check",
        )
        val descriptors = LitePresetDescriptors.parseDocument(resource!!.readText(Charsets.UTF_8))
        val ids = descriptors.map { it.id }
        assertTrue("standard" !in ids, "standard is runtime-variable and stays on the exclusion list")
        assertTrue("ptc" !in ids, "ptc is runtime-variable and stays on the exclusion list")
        assertTrue("minimal" in ids, "the projection must carry the minimal fixed-prompt preset")

        val fixed = descriptors.filter { it.persona.complete }
        assertTrue(fixed.isNotEmpty(), "the fixed-prompt preset class (persona.complete) must be present")
        for (preset in fixed) {
            assertTrue(preset.assembledSystemPrompt.isNotBlank(), "${preset.id}: the assembled system prompt cannot be blank")
            assertTrue(
                "{{" !in preset.assembledSystemPrompt,
                "${preset.id}: the assembled system prompt carries un-interpolated template residue",
            )
        }

        val catalog = LitePresetCatalog.fromHostProjection(descriptors)
        assertTrue(catalog.defaultSystemPrompt != null, "the projection must yield one default system prompt")
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
