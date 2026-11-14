package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LiteToolSchema
import ai.deepseek.dsh.contract.LiteToolSchemas
import kotlinx.serialization.json.JsonElement

/**
 * Which source produced a tool-schema selection: the Host's model-face
 * projection, that projection's bytes bundled with the APK, or no projection
 * at all. The source is carried explicitly so the offline fallback stays
 * observable, never silent.
 */
enum class LiteToolSchemaSource { HOST_PROJECTED, BUNDLED, BARE }

/**
 * The model-face tool schemas for one Lite runtime (§32): a
 * construction-state catalog — the schemas are provider construction input,
 * not per-call state. Like the system prompt, the schemas ride the provider
 * request face and never the event journal.
 */
class LiteToolSchemaCatalog private constructor(
    /** Which selection source produced this catalog. */
    val source: LiteToolSchemaSource,
    /** The projected schemas in projection order; empty in bare mode. */
    val tools: List<LiteToolSchema>,
) {
    companion object {
        /** The bare catalog for offline sessions and Hosts without a projection: requests carry no tools key. */
        val BARE: LiteToolSchemaCatalog = LiteToolSchemaCatalog(LiteToolSchemaSource.BARE, emptyList())

        /**
         * Build the Host-projected catalog from the lite tool-schema projection document.
         * @param element the Host's `{"tools":[...]}` projection value.
         * @returns the catalog with the parsed schemas in projection order.
         * @throws IllegalArgumentException when the document or any entry is malformed.
         */
        fun fromProjectedDocument(element: JsonElement): LiteToolSchemaCatalog =
            LiteToolSchemaCatalog(LiteToolSchemaSource.HOST_PROJECTED, LiteToolSchemas.parseList(element))

        /**
         * Build the bundled catalog from the Host projection's bytes shipped inside
         * the APK: the schemas themselves are a Host projection, parsed by the
         * caller through the shared document parser — identical entries to
         * [fromProjectedDocument], observed under the bundle's own source.
         * @param schemas the parsed projection entries, in projection order.
         * @returns the catalog with those schemas.
         */
        fun fromBundledProjection(schemas: List<LiteToolSchema>): LiteToolSchemaCatalog =
            LiteToolSchemaCatalog(LiteToolSchemaSource.BUNDLED, schemas)

        /**
         * Build the APK-frozen schema union: the bundled Host projection's
         * schemas plus the app-owned device schemas. Each document rejects
         * duplicate names at parse; the union adds the cross-document guard
         * because a name carried by both documents has no honest arbitration.
         * @param hostSchemas the bundled Host projection's schemas, in projection order.
         * @param deviceSchemas the app-owned device schemas, in document order.
         * @returns the [LiteToolSchemaSource.BUNDLED] catalog; projection entries keep their order ahead of the device document's.
         * @throws IllegalArgumentException when a tool name appears in both documents.
         */
        fun fromBundledDocuments(
            hostSchemas: List<LiteToolSchema>,
            deviceSchemas: List<LiteToolSchema>,
        ): LiteToolSchemaCatalog {
            val hostNames = hostSchemas.map { it.name }.toSet()
            val collisions = deviceSchemas.map { it.name }.filter { it in hostNames }
            if (collisions.isNotEmpty()) {
                throw IllegalArgumentException("tool schema name carried by both bundled documents: ${collisions.joinToString()}")
            }
            return LiteToolSchemaCatalog(LiteToolSchemaSource.BUNDLED, hostSchemas + deviceSchemas)
        }
    }
}
