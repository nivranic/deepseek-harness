package ai.deepseek.dsh.contract

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * One Host-projected model-face tool schema (§32): the `{name, description,
 * parameters}` payload an OpenAI-compatible `tools` array carries per
 * function tool. Lite owns no schema text of its own — one entry of the
 * generated `packages/core/tools/lite-tool-schemas.json`; unknown future
 * fields stay tolerated.
 */
data class LiteToolSchema(
    val name: String,
    val description: String,
    val parameters: JsonObject,
) {
    companion object {
        /**
         * Parse one schema from a raw JSON tree.
         * @param element one `{name, description, parameters}` object.
         * @returns the schema.
         * @throws IllegalArgumentException when a field is missing or mistyped, the name or description is blank, or parameters is not an object.
         */
        fun parse(element: JsonElement): LiteToolSchema {
            val fields = element as? JsonObject ?: invalid("lite tool schema")
            return LiteToolSchema(
                name = fields.requiredNonBlank("name"),
                description = fields.requiredNonBlank("description"),
                parameters = fields["parameters"] as? JsonObject ?: invalid("parameters"),
            )
        }
    }
}

/**
 * Parse the lite tool-schema documents a Host serves: the generated
 * projection `packages/core/tools/lite-tool-schemas.json` and a live schema
 * listing share one schema. The projection covers exactly the tools the
 * tool-descriptor catalog declares with `supportsLite`.
 */
object LiteToolSchemas {

    /**
     * Parse one schema document from JSON text.
     * @param text the `{"tools":[...]}` document bytes.
     * @returns the schemas in document order; empty when the Host projects none.
     * @throws IllegalArgumentException when the text or any entry is malformed.
     */
    fun parseDocument(text: String): List<LiteToolSchema> = parseList(Json.parseToJsonElement(text))

    /**
     * Parse one schema document from a raw JSON tree.
     * @param element the `{"tools":[...]}` document value.
     * @returns the schemas in document order; empty when the Host projects none.
     * @throws IllegalArgumentException when the document, any entry, or name uniqueness is malformed.
     */
    fun parseList(element: JsonElement): List<LiteToolSchema> {
        val tools = (element as? JsonObject)?.get("tools") as? JsonArray ?: invalid("tools")
        val schemas = tools.map { LiteToolSchema.parse(it) }
        if (schemas.map { it.name }.toSet().size != schemas.size) invalid("duplicate tool name")
        return schemas
    }
}

private fun invalid(field: String): Nothing = throw IllegalArgumentException("missing or invalid $field")

private fun JsonObject.requiredText(field: String): String =
    (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: invalid(field)

private fun JsonObject.requiredNonBlank(field: String): String =
    requiredText(field).takeIf { it.isNotBlank() } ?: invalid(field)
