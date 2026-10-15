package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LiteToolSchema
import ai.deepseek.dsh.contract.LiteToolSchemas
import kotlinx.serialization.json.JsonElement

/**
 * Which source produced a tool-schema selection: the Host's model-face
 * projection, or no projection at all. The source is carried explicitly so
 * the offline fallback stays observable, never silent.
 */
enum class LiteToolSchemaSource { HOST_PROJECTED, BARE }

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
    }
}
