package ai.deepseek.dsh.companion

/**
 * The construction-time facts of one assembled Lite session (§31): the
 * runtime mode word, the source each catalog came from, and the preset
 * actually in effect. Every source field reuses the selection enum its
 * catalog already carries, so the snapshot stays observable rather than a
 * second narration; the defaults state the APK-bundled assembly this
 * generation runs — save [presetId], whose resolved value is catalog data,
 * never a constant, so its default stays null for the projection-less
 * construction faces. No Host capability set is mirrored here — the facts
 * name sources, never the Host's inventory.
 */
data class LiteSessionFacts(
    /** The runtime mode word; `lite` is the literal this mode is known by. */
    val runtimeMode: String = "lite",
    /** Which judgment source produced the dispatch catalog. */
    val toolCatalogSource: LiteToolSource = LiteToolSource.BUNDLED_FALLBACK,
    /** Which source produced the model-face tool schemas. */
    val toolSchemasSource: LiteToolSchemaSource = LiteToolSchemaSource.BUNDLED,
    /** Which source produced the preset selection. */
    val presetSource: LitePresetSource = LitePresetSource.BUNDLED,
    /** The id of the preset actually in effect (§33) — an explicitly selected id or the default a projection resolved; null only when no projection declared one. */
    val presetId: String? = null,
    /** The bundled tools without a handoff fallback capability — the ones Lite serves on-device. */
    val bundledLocalToolNames: List<String> = LiteToolRegistry.localToolNames,
)
