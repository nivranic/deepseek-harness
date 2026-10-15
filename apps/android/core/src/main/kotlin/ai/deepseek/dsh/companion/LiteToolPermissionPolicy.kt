package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.ToolRisk

/**
 * The dispatch decision for one model-requested tool call — §31 permission
 * policy: the loop driver acts on exactly one of these per call and owns no
 * dispatch judgment of its own.
 */
sealed interface LiteToolDecision {
    /** Execute the call on-device through the bundled executor. */
    data object AllowLocal : LiteToolDecision

    /**
     * Hand the call to the full runtime instead of executing on-device.
     * @param reason which gate refused local execution; policy-facing documentation only — it never enters an event field, whose capability vocabulary stays [LITE_REQUIRES_FULL_RUNTIME].
     */
    data class Handoff(val reason: String) : LiteToolDecision

    /** No catalog knows the name: fold an explicit failed result, never dispatch. */
    data object Unknown : LiteToolDecision
}

/**
 * The permission gate every Lite tool call passes before the loop driver
 * dispatches or hands off — the §31 decision point, consulted once per call.
 */
fun interface LiteToolPermissionPolicy {
    /**
     * Decide one tool call's dispatch path.
     * @param name the model-requested tool name.
     * @return the decision the loop driver acts on.
     */
    fun decide(name: String): LiteToolDecision
}

/**
 * The shipped [LiteToolPermissionPolicy] factories. The default policy reads
 * Host-declared facts when the catalog carries them and answers in bundled
 * fallback semantics otherwise; risk facts come only from the Host's output
 * and are never guessed for the bundled name domain (§37), and the gates
 * reuse the contract vocabulary — [ToolRisk] tiers and
 * `ToolDescriptor.permissions` — instead of a parallel one (§72).
 */
object LiteToolPermissionPolicies {
    /**
     * Build the default policy for one catalog. Host-declared names walk the
     * declaration gates in order — lite support, an on-device executor in the
     * bundled table, risk tier, permissions; bundled fallback names keep the
     * bundled capability judgments with no risk gate, because that name
     * domain carries no Host risk facts.
     * @param catalog the live session's dispatch catalog.
     * @returns the policy answering `decide` for that catalog.
     */
    fun defaultPolicy(catalog: LiteToolCatalog): LiteToolPermissionPolicy = LiteToolPermissionPolicy { name ->
        when (catalog.source) {
            LiteToolSource.BUNDLED_FALLBACK -> when (val bundled = catalog.tool(name)) {
                null -> LiteToolDecision.Unknown
                else -> {
                    val fallback = bundled.fallbackCapability
                    if (fallback != null) LiteToolDecision.Handoff(fallback) else LiteToolDecision.AllowLocal
                }
            }
            LiteToolSource.HOST_DECLARED -> when (val declared = catalog.declaration(name)) {
                null -> LiteToolDecision.Unknown
                else -> when {
                    !declared.supportsLite -> LiteToolDecision.Handoff("declared-not-lite")
                    catalog.tool(name) == null -> LiteToolDecision.Handoff("no-bundled-executor")
                    declared.risk == ToolRisk.HIGH || declared.risk == ToolRisk.CRITICAL ->
                        LiteToolDecision.Handoff("risk-" + declared.risk.WIRE)
                    declared.permissions.isNotEmpty() -> LiteToolDecision.Handoff("requires-remote-permissions")
                    else -> LiteToolDecision.AllowLocal
                }
            }
        }
    }
}
