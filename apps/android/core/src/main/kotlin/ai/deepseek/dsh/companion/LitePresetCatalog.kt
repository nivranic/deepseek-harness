package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptor

/**
 * Which source produced a preset selection: the Host's lite-preset
 * projection, or no projection at all. The source is carried explicitly so
 * the offline fallback stays observable, never silent.
 */
enum class LitePresetSource { HOST_PROJECTED, BARE }

/**
 * The persona/system-prompt selection for one Lite runtime (§33): Lite owns
 * no prompt text — a Host projection carries each preset's
 * assembledSystemPrompt, the default preset is the lowest order the
 * projection declares, and a session without a projection sends bare
 * prompts, byte-identical to the projection-free behavior. The selected
 * system prompt is request-face context: it rides the provider stream and
 * never the event journal.
 */
class LitePresetCatalog private constructor(
    /** Which selection source produced this catalog. */
    val source: LitePresetSource,
    /** The selectable presets in projection order; empty in bare mode. */
    val presets: List<LitePresetDescriptor>,
) {
    /** The default preset: the lowest order among [presets], or null when the source declares none. */
    val default: LitePresetDescriptor? = presets.minByOrNull { it.order }

    /** The default preset's assembled system prompt, or null when no default preset exists — the session then runs bare. */
    val defaultSystemPrompt: String? get() = default?.assembledSystemPrompt

    companion object {
        /** The bare catalog for offline sessions and Hosts without a projection: prompts send unchanged. */
        val BARE: LitePresetCatalog = LitePresetCatalog(LitePresetSource.BARE, emptyList())

        /**
         * Build the Host-projected catalog from the lite-preset projection.
         * @param descriptors the Host's preset descriptors, in projection order.
         * @returns the catalog; the default preset is the lowest order among them, and an empty projection leaves no default.
         */
        fun fromHostProjection(descriptors: List<LitePresetDescriptor>): LitePresetCatalog =
            LitePresetCatalog(LitePresetSource.HOST_PROJECTED, descriptors)
    }
}
