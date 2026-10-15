package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolRisk
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The §31 permission policy ladder: Host-declared names walk the
 * declaration gates in order — lite support, risk tier, permissions —
 * while the bundled fallback (and the bare default catalog built on it)
 * keeps the bundled capability judgments with no risk gate.
 */
class LiteToolPermissionPolicyTest {
    @Test
    fun declaredNotLiteToolsHandOffBeforeAnyLaterGate() {
        val policy = LiteToolPermissionPolicies.defaultPolicy(
            LiteToolCatalog.fromHostDescriptors(
                listOf(declared("web_search", supportsLite = false, risk = ToolRisk.CRITICAL)),
            ),
        )
        assertEquals(LiteToolDecision.Handoff("declared-not-lite"), policy.decide("web_search"))
    }

    @Test
    fun declaredHighAndCriticalRiskToolsHandOff() {
        val policy = LiteToolPermissionPolicies.defaultPolicy(
            LiteToolCatalog.fromHostDescriptors(
                listOf(
                    declared("web_search", supportsLite = true, risk = ToolRisk.HIGH, permissions = listOf("web:fetch")),
                    declared("attachment_read", supportsLite = true, risk = ToolRisk.CRITICAL),
                ),
            ),
        )
        assertEquals(LiteToolDecision.Handoff("risk-high"), policy.decide("web_search"))
        assertEquals(LiteToolDecision.Handoff("risk-critical"), policy.decide("attachment_read"))
    }

    @Test
    fun declaredToolsWithPermissionsHandOffBelowTheRiskGate() {
        val policy = LiteToolPermissionPolicies.defaultPolicy(
            LiteToolCatalog.fromHostDescriptors(
                listOf(declared("url_fetch", supportsLite = true, risk = ToolRisk.MODERATE, permissions = listOf("fs:read"))),
            ),
        )
        assertEquals(LiteToolDecision.Handoff("requires-remote-permissions"), policy.decide("url_fetch"))
    }

    @Test
    fun declaredLowAndModerateToolsWithoutPermissionsExecuteLocally() {
        val policy = LiteToolPermissionPolicies.defaultPolicy(
            LiteToolCatalog.fromHostDescriptors(
                listOf(
                    declared("web_search", supportsLite = true, risk = ToolRisk.LOW),
                    declared("calculator", supportsLite = true, risk = ToolRisk.MODERATE),
                ),
            ),
        )
        assertEquals(LiteToolDecision.AllowLocal, policy.decide("web_search"))
        assertEquals(LiteToolDecision.AllowLocal, policy.decide("calculator"))
    }

    @Test
    fun declaredLiteToolsWithoutABundledExecutorHandOff() {
        val policy = LiteToolPermissionPolicies.defaultPolicy(
            LiteToolCatalog.fromHostDescriptors(
                listOf(declared("host_only_search", supportsLite = true, risk = ToolRisk.LOW)),
            ),
        )
        assertEquals(LiteToolDecision.Handoff("no-bundled-executor"), policy.decide("host_only_search"))
    }

    @Test
    fun namesAbsentFromTheDeclarationAreUnknownNeverGuessed() {
        val policy = LiteToolPermissionPolicies.defaultPolicy(
            LiteToolCatalog.fromHostDescriptors(listOf(declared("web_search", supportsLite = true))),
        )
        assertEquals(LiteToolDecision.Unknown, policy.decide("bash"))
        assertEquals(LiteToolDecision.Unknown, policy.decide("run_tests"))
    }

    @Test
    fun theBareFallbackCatalogAnswersInBundledSemantics() {
        val policy = LiteToolPermissionPolicies.defaultPolicy(LiteToolCatalog.FALLBACK)
        assertEquals(LiteToolSource.BUNDLED_FALLBACK, LiteToolCatalog.FALLBACK.source)
        assertEquals(LiteToolDecision.AllowLocal, policy.decide("web_search"))
        assertEquals(LiteToolDecision.AllowLocal, policy.decide("calculator"))
        assertEquals(LiteToolDecision.Handoff(LITE_REQUIRES_FULL_RUNTIME), policy.decide("run_tests"))
        assertEquals(LiteToolDecision.Unknown, policy.decide("bash"))
    }

    private fun declared(
        id: String,
        supportsLite: Boolean,
        risk: ToolRisk = ToolRisk.LOW,
        permissions: List<String> = emptyList(),
    ): ToolDescriptor = ToolDescriptor(
        id = id,
        version = 1,
        risk = risk,
        permissions = permissions,
        supportsLite = supportsLite,
        supportsRemote = true,
    )
}
