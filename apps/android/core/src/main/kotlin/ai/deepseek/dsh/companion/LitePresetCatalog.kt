package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptor

/**
 * Which source produced a preset selection: the Host's lite-preset
 * projection, that projection's bytes bundled with the APK, or no projection
 * at all. The source is carried explicitly so the offline fallback stays
 * observable, never silent.
 */
enum class LitePresetSource { HOST_PROJECTED, BUNDLED, BARE }

/**
 * The persona/system-prompt selection for one Lite runtime (§33): Lite owns
 * no prompt text — a Host projection carries each preset's
 * assembledSystemPrompt, a session picks one preset by id (the projection's
 * lowest order when unnamed), and a session without a projection sends bare
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

    /**
     * Find one preset by id.
     * @param id the preset identity as the projection declares it.
     * @returns the descriptor, or null when the catalog carries no preset with this id.
     */
    fun preset(id: String): LitePresetDescriptor? = presets.firstOrNull { it.id == id }

    /**
     * Resolve one session's effective preset (§33): a null [id] takes the
     * catalog default, and a named id must be one of [presets] — Lite never
     * guesses a substitute selection, so an unknown id fails loud naming
     * both the id and the ids this catalog carries.
     * @param id the requested preset id, or null to take the default.
     * @returns the effective descriptor; null only when the catalog carries no preset at all.
     * @throws IllegalArgumentException when [id] names a preset this catalog does not carry.
     */
    fun resolve(id: String?): LitePresetDescriptor? {
        if (id == null) return default
        return preset(id) ?: throw IllegalArgumentException(
            "lite preset '$id' is not in the ${source.name} catalog; carried preset ids: ${presets.map { it.id }}",
        )
    }

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

        /**
         * Build the bundled catalog from the Host projection's bytes shipped inside
         * the APK: the descriptors themselves are a Host projection, parsed by the
         * caller through the shared document parser — identical selection rules
         * to [fromHostProjection], observed under the bundle's own source.
         * @param descriptors the parsed projection descriptors, in projection order.
         * @returns the catalog; the default preset is the lowest order among them, and an empty projection leaves no default.
         */
        fun fromBundledProjection(descriptors: List<LitePresetDescriptor>): LitePresetCatalog =
            LitePresetCatalog(LitePresetSource.BUNDLED, descriptors)
    }
}
