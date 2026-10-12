package ai.deepseek.dsh.contract

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/**
 * The risk tier a Host assigns one tool; [WIRE] keeps the cross-transport
 * spelling stable. The tier travels with the descriptor for presentation and
 * policy and never admits or refuses an execution by itself.
 */
enum class ToolRisk(val WIRE: String) {
    LOW("low"),
    MODERATE("moderate"),
    HIGH("high"),
    CRITICAL("critical"),
}

/**
 * One Host-declared tool (§32): whether a tool may run in the Lite runtime is
 * the Host's declaration, never the Client's guess. One entry of
 * `packages/core/tools/tool-descriptors.json`, served whole by the Host's
 * `tools/list` operation; unknown future fields stay tolerated.
 */
data class ToolDescriptor(
    val id: String,
    val version: Long,
    val risk: ToolRisk,
    val permissions: List<String>,
    val supportsLite: Boolean,
    val supportsRemote: Boolean,
) {
    companion object {
        /**
         * Parse one descriptor from a raw JSON tree.
         * @param element one `{id, version, risk, permissions, supportsLite, supportsRemote}` object.
         * @returns the descriptor.
         * @throws IllegalArgumentException when a field is missing, mistyped, blank, or outside the vocabulary.
         */
        fun parse(element: JsonElement): ToolDescriptor {
            val fields = element as? JsonObject ?: invalid("tool descriptor")
            val riskWire = fields.requiredString("risk")
            val risk = ToolRisk.entries.find { it.WIRE == riskWire }
                ?: throw IllegalArgumentException("unknown tool risk: $riskWire")
            return ToolDescriptor(
                id = fields.requiredString("id"),
                version = fields.requiredVersion(),
                risk = risk,
                permissions = (fields["permissions"] as? JsonArray)?.map { entry ->
                    (entry as? JsonPrimitive)?.takeIf { it.isString }?.content ?: invalid("permissions")
                } ?: invalid("permissions"),
                supportsLite = fields.requiredBoolean("supportsLite"),
                supportsRemote = fields.requiredBoolean("supportsRemote"),
            )
        }
    }
}

/**
 * Parse the tool-catalog documents a Host serves: the generated projection
 * `packages/core/tools/tool-descriptors.json` and the live `tools/list` RPC
 * reply share one schema.
 */
object ToolDescriptors {

    /**
     * Parse one catalog document from JSON text.
     * @param text the `{"tools":[...]}` document bytes.
     * @returns the descriptors in document order; empty when the Host declares none.
     * @throws IllegalArgumentException when the text or any entry is malformed.
     */
    fun parseDocument(text: String): List<ToolDescriptor> = parseList(Json.parseToJsonElement(text))

    /**
     * Parse one catalog document from a raw JSON tree.
     * @param element the `{"tools":[...]}` document value.
     * @returns the descriptors in document order; empty when the Host declares none.
     * @throws IllegalArgumentException when the document, any entry, or id uniqueness is malformed.
     */
    fun parseList(element: JsonElement): List<ToolDescriptor> {
        val tools = (element as? JsonObject)?.get("tools") as? JsonArray ?: invalid("tools")
        val descriptors = tools.map { ToolDescriptor.parse(it) }
        if (descriptors.map { it.id }.toSet().size != descriptors.size) invalid("duplicate tool id")
        return descriptors
    }
}

private fun invalid(field: String): Nothing = throw IllegalArgumentException("missing or invalid $field")

private fun JsonObject.requiredString(field: String): String =
    (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
        ?: invalid(field)

private fun JsonObject.requiredVersion(): Long =
    (this["version"] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull
        ?.takeIf { it in 1..9_007_199_254_740_991L } ?: invalid("version")

private fun JsonObject.requiredBoolean(field: String): Boolean =
    (this[field] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull ?: invalid(field)
