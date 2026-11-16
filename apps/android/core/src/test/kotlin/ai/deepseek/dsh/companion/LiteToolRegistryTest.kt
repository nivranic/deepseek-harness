package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolDescriptors
import ai.deepseek.dsh.contract.ToolRisk
import org.junit.jupiter.api.Assumptions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The chapter-36 bundled tool set, its refusal of dynamic dispatch, and the
 * §32 dispatch catalogs: Host declarations drive the judgments when served,
 * the bundled table answers in fallback mode, and the generated Host
 * projection covers the bundled set without drift.
 */
class LiteToolRegistryTest {

    /** The frozen Android-local name set the projection mirror and the union twin below share. */
    private val frozenLocalOnly =
        setOf("url_fetch", "image_inspect", "attachment_read", "artifact_create", "calculator", "run_tests")

    @Test
    fun bundlesTheChapterThirtySixToolSet() {
        assertEquals(
            listOf(
                "web_search",
                "url_fetch",
                "image_inspect",
                "attachment_read",
                "artifact_create",
                "calculator",
                "run_tests",
            ),
            LiteToolRegistry.bundled.map { it.name },
        )
        assertTrue(LiteToolRegistry.bundled.all { it.description.isNotEmpty() }, "every descriptor carries a description")
    }

    @Test
    fun looksUpBundledToolsByName() {
        val tool = LiteToolRegistry.tool("web_search")
        assertEquals("web_search", tool?.name)
        assertEquals("搜索网络并返回结果列表。", tool?.description)
        assertEquals(LiteToolDescriptor(name = "calculator", description = "求值一个算术表达式。"), LiteToolRegistry.tool("calculator"))
    }

    @Test
    fun onlyRunTestsHandsOffToTheFullRuntime() {
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, LiteToolRegistry.handoffCapability("run_tests"))
        assertNull(LiteToolRegistry.handoffCapability("web_search"))
        assertNull(LiteToolRegistry.handoffCapability("calculator"))
    }

    @Test
    fun unknownNamesResolveToNothingNeverDynamically() {
        assertNull(LiteToolRegistry.tool("bash"))
        assertNull(LiteToolRegistry.tool("web_search_exec"))
        assertNull(LiteToolRegistry.handoffCapability("nonexistent"))
    }

    @Test
    fun theFallbackCatalogCarriesItsSourceAndTheBundledJudgments() {
        assertEquals(LiteToolSource.BUNDLED_FALLBACK, LiteToolCatalog.FALLBACK.source)
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, LiteToolCatalog.FALLBACK.handoffCapability("run_tests"))
        assertNull(LiteToolCatalog.FALLBACK.handoffCapability("web_search"))
        // The fallback path keeps the current unknown-name behavior: fold only.
        assertNull(LiteToolCatalog.FALLBACK.handoffCapability("bash"))
    }

    @Test
    fun hostDeclarationsDriveTheDispatchDecisions() {
        val catalog = LiteToolCatalog.fromHostDescriptors(
            LiteToolRegistry.bundled.map { declared(it.name, supportsLite = it.name != "calculator") } +
                declared("apply_patch", supportsLite = false),
        )
        assertEquals(LiteToolSource.HOST_DECLARED, catalog.source)
        // Declared lite-capable: run_tests executes on-device even though the
        // bundled fallback table hands it off.
        assertNull(catalog.handoffCapability("run_tests"))
        // Declared not lite-capable: calculator hands off even though the
        // bundled fallback table serves it.
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, catalog.handoffCapability("calculator"))
        assertNull(catalog.handoffCapability("web_search"))
        // Unknown to the declaration: not executable here, never guessed, the
        // handoff path stays.
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, catalog.handoffCapability("bash"))
        assertNull(catalog.tool("bash"))
        // Declared lite-capable but not bundled: no execution face exists, so
        // it hands off instead of executing.
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, catalog.handoffCapability("apply_patch"))
        assertNull(catalog.tool("apply_patch"))
    }

    @Test
    fun anEmptyDeclarationHandsEverythingOff() {
        val catalog = LiteToolCatalog.fromHostDescriptors(emptyList())
        assertEquals(LiteToolSource.HOST_DECLARED, catalog.source)
        assertTrue(LiteToolRegistry.bundled.all { catalog.handoffCapability(it.name) == LITE_REQUIRES_FULL_RUNTIME })
    }

    /**
     * The bundled tool set mirrors the generated Host projection at
     * `packages/core/tools/tool-descriptors.json` (copied into test resources
     * by copyToolDescriptors): shared ids must agree on supportsLite, and the
     * bundled ids absent from the projection must exactly equal the frozen
     * local-only vocabulary below (Android-local Lite names with no Host
     * counterpart; a future Host tool named like one of them breaks the frozen
     * set and reopens adjudication). The sample fixture
     * `fixtures/tool-descriptors.sample.json` keeps the same schema
     * for behavior tests and is regenerated by rerunning that projection.
     */
    @Test
    fun theHostProjectionCoversTheBundledToolSetWithoutDrift() {
        val resource = javaClass.classLoader.getResource("tool-descriptors.json")
        Assumptions.assumeTrue(
            resource != null,
            "packages/core/tools/tool-descriptors.json has not been generated yet; the integration stage reruns this mirror",
        )
        val projection = ToolDescriptors.parseDocument(resource!!.readText(Charsets.UTF_8)).associateBy { it.id }
        val drift = LiteToolRegistry.bundled.mapNotNull { bundled ->
            val declared = projection[bundled.name]
            val locallyExecutable = bundled.fallbackCapability == null
            when {
                declared == null && bundled.name !in frozenLocalOnly ->
                    "${bundled.name}: bundled tool missing from the Host projection and not on the frozen local-only list"
                declared == null -> null
                declared.supportsLite != locallyExecutable ->
                    "${bundled.name}: projection supportsLite=${declared.supportsLite} but the bundled fallback table treats it as " +
                        (if (locallyExecutable) "locally executable" else "requiring the full runtime")
                else -> null
            }
        } +
            (frozenLocalOnly - LiteToolRegistry.bundled.map { it.name }.toSet()).map {
                "$it: on the frozen local-only list but no longer bundled"
            } +
            frozenLocalOnly.filter { projection.containsKey(it) }.map {
                "$it: frozen as local-only but the Host projection now declares it; reopen adjudication"
            }
        assertTrue(
            drift.isEmpty(),
            "the bundled tool set drifted from the Host projection — lane A or the main session adjudicates, not this mirror:\n" +
                drift.joinToString("\n"),
        )
    }

    /** The same-schema sample projection parses and drives one catalog end to end. */
    @Test
    fun theSampleFixtureDrivesOneCatalog() {
        val sample = javaClass.classLoader.getResource("fixtures/tool-descriptors.sample.json")!!
        val catalog = LiteToolCatalog.fromHostDescriptors(ToolDescriptors.parseDocument(sample.readText(Charsets.UTF_8)))
        assertEquals(LiteToolSource.HOST_DECLARED, catalog.source)
        assertNull(catalog.handoffCapability("web_search"))
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, catalog.handoffCapability("run_tests"))
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, catalog.handoffCapability("apply_patch"))
    }

    /**
     * The union twin of the projection mirror: the app-owned device
     * declaration document (`apps/android/app/lite/lite-tool-declarations.json`,
     * copied beside the Host projection by copyToolDescriptors) declares
     * exactly the frozen local-only six, holds no name the Host projection
     * declares, mirrors each name's bundled fallback capability judgment in
     * its `supportsLite`, and leaves web_search to the Host side — so the
     * APK-frozen union holds every bundled name exactly once.
     */
    @Test
    fun theBundledDeclarationUnionHoldsEveryBundledNameExactlyOnce() {
        val device = javaClass.classLoader.getResource("lite-tool-declarations.json")
        val host = javaClass.classLoader.getResource("tool-descriptors.json")
        Assumptions.assumeTrue(
            device != null && host != null,
            "the bundled tool-declaration documents have not been copied into test resources yet; the integration stage reruns this mirror",
        )
        val deviceDeclarations = ToolDescriptors.parseDocument(device!!.readText(Charsets.UTF_8))
        val hostIds = ToolDescriptors.parseDocument(host!!.readText(Charsets.UTF_8)).map { it.id }.toSet()
        assertEquals(frozenLocalOnly, deviceDeclarations.map { it.id }.toSet(), "the device document declares exactly the frozen local-only six")
        assertTrue(deviceDeclarations.none { it.id in hostIds }, "a name declared by both bundled documents has no honest arbitration")
        assertTrue("web_search" in hostIds, "web_search arrives through the Host projection, never the device document")
        for (declared in deviceDeclarations) {
            val locallyExecutable = LiteToolRegistry.tool(declared.id)?.fallbackCapability == null
            assertEquals(
                locallyExecutable,
                declared.supportsLite,
                "${declared.id}: supportsLite must mirror the bundled fallback capability judgment (run_tests authored not-lite)",
            )
        }
        val union = LiteToolCatalog.fromBundledDocuments(deviceDeclarations, ToolDescriptors.parseDocument(host!!.readText(Charsets.UTF_8)))
        assertEquals(LiteToolSource.BUNDLED, union.source)
        for (bundled in LiteToolRegistry.bundled) {
            assertEquals(bundled.fallbackCapability, union.handoffCapability(bundled.name))
        }
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, union.handoffCapability("bash"))
    }

    /**
     * The union the app assembler composes keeps the bundled fallback table's
     * dispatch outcome name for name (both documents from test resources; no
     * asset IO): local tools stay local, run_tests keeps its handoff — only
     * the policy-facing Handoff reason differs, the emitted capability stays
     * the fixed literal — and a name outside both documents stays Unknown.
     */
    @Test
    fun theBundledUnionResolvesEachBundledNameThroughThePolicyLadder() {
        val device = javaClass.classLoader.getResource("lite-tool-declarations.json")
        val host = javaClass.classLoader.getResource("tool-descriptors.json")
        Assumptions.assumeTrue(
            device != null && host != null,
            "the bundled tool-declaration documents have not been copied into test resources yet; the integration stage reruns this mirror",
        )
        val policy = LiteToolPermissionPolicies.defaultPolicy(
            LiteToolCatalog.fromBundledDocuments(
                ToolDescriptors.parseDocument(device!!.readText(Charsets.UTF_8)),
                ToolDescriptors.parseDocument(host!!.readText(Charsets.UTF_8)),
            ),
        )
        for (name in LiteToolRegistry.localToolNames) {
            // The moderate names — web_search on the Host projection,
            // url_fetch and artifact_create on the device declaration —
            // ask before executing on-device; the low names (pure
            // computation and local reads) stay direct-execution names.
            val expected = if (name in setOf("web_search", "url_fetch", "artifact_create")) {
                LiteToolDecision.Ask("moderate")
            } else {
                LiteToolDecision.AllowLocal
            }
            assertEquals(expected, policy.decide(name), "$name resolves through the union ladder")
        }
        assertEquals(LiteToolDecision.Handoff("declared-not-lite"), policy.decide("run_tests"))
        // Every Host-declared non-lite name (bash among them) hands off — the
        // projection's vocabulary is declared data under the union.
        assertEquals(LiteToolDecision.Handoff("declared-not-lite"), policy.decide("bash"))
        assertEquals(LiteToolDecision.Unknown, policy.decide("nonexistent"))
    }

    @Test
    fun aNameInBothBundledDocumentsFailsLoudNamingTheCollision() {
        val failure = assertFailsWith<IllegalArgumentException> {
            LiteToolCatalog.fromBundledDocuments(
                listOf(declared("url_fetch", supportsLite = true)),
                listOf(declared("url_fetch", supportsLite = false)),
            )
        }
        assertTrue("url_fetch" in failure.message.orEmpty(), "the collision message must name the colliding id")
    }

    /**
     * The live union the paired shell assembles: the device declarations
     * stay the app-owned side and the Host's live-served declaration
     * replaces the bundled Host projection wholesale; the union keeps the
     * declared gates and names its HOST_DECLARED source.
     */
    @Test
    fun theLiveHostUnionReplacesTheProjectionSideAndKeepsTheDeclaredGates() {
        val catalog = LiteToolCatalog.fromDeviceAndLiveHostDeclarations(
            listOf(declared("calculator", supportsLite = true)),
            listOf(
                declared("web_search", supportsLite = true),
                declared("run_tests", supportsLite = false),
            ),
        )
        assertEquals(LiteToolSource.HOST_DECLARED, catalog.source)
        assertNull(catalog.handoffCapability("calculator"))
        assertNull(catalog.handoffCapability("web_search"))
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, catalog.handoffCapability("run_tests"))
        // A name absent from both documents stays Unknown, never guessed.
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, catalog.handoffCapability("bash"))
    }

    @Test
    fun aNameInBothTheDeviceDocumentAndTheLiveHostDeclarationFailsLoudNamingTheCollision() {
        val failure = assertFailsWith<IllegalArgumentException> {
            LiteToolCatalog.fromDeviceAndLiveHostDeclarations(
                listOf(declared("calculator", supportsLite = true)),
                listOf(declared("calculator", supportsLite = false)),
            )
        }
        assertTrue("calculator" in failure.message.orEmpty(), "the collision message must name the colliding id")
    }

    private fun declared(id: String, supportsLite: Boolean): ToolDescriptor =
        ToolDescriptor(id = id, version = 1, risk = ToolRisk.LOW, permissions = emptyList(), supportsLite = supportsLite, supportsRemote = true)
}
