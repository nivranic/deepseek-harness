package ai.deepseek.dsh.contract

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/**
 * One preset's persona declaration, mirroring the persona plugin's config
 * (§33): `prefix` is the persona prose, `complete` marks that prefix as the
 * complete system prompt — suppressing every other assembly section — and
 * `suffix` rides after the first-party guidance when the preset carries one.
 */
data class LitePresetPersona(
    val prefix: String,
    val suffix: String?,
    val complete: Boolean,
)

/**
 * One Host-projected lite preset (§33): Lite owns no prompt text, so the Host
 * projection carries each selectable preset with its already-assembled system
 * prompt. One entry of
 * `packages/preset/agent-presets/lite-preset-descriptors.json`; unknown future
 * fields stay tolerated.
 */
data class LitePresetDescriptor(
    val id: String,
    val order: Long,
    val persona: LitePresetPersona,
    val includeRuntimeContext: Boolean,
    val assembledSystemPrompt: String,
) {
    companion object {
        /**
         * Parse one descriptor from a raw JSON tree.
         * @param element one `{id, order, persona, includeRuntimeContext, assembledSystemPrompt}` object.
         * @returns the descriptor.
         * @throws IllegalArgumentException when a field is missing or mistyped, or the id or assembled system prompt is blank.
         */
        fun parse(element: JsonElement): LitePresetDescriptor {
            val fields = element as? JsonObject ?: invalid("lite preset descriptor")
            return LitePresetDescriptor(
                id = fields.requiredNonBlank("id"),
                order = fields.requiredOrder(),
                persona = fields.requiredPersona(),
                includeRuntimeContext = fields.requiredBoolean("includeRuntimeContext"),
                assembledSystemPrompt = fields.requiredNonBlank("assembledSystemPrompt"),
            )
        }
    }
}

/**
 * Parse the lite-preset documents a Host serves: the generated projection
 * `packages/preset/agent-presets/lite-preset-descriptors.json` and a live
 * preset listing share one schema. The runtime-variable presets (standard,
 * ptc) stay on the generator's exclusion list and never appear in a parsed
 * document.
 */
object LitePresetDescriptors {

    /**
     * Parse one preset document from JSON text.
     * @param text the `{"presets":[...]}` document bytes.
     * @returns the descriptors in document order; empty when the Host projects none.
     * @throws IllegalArgumentException when the text or any entry is malformed.
     */
    fun parseDocument(text: String): List<LitePresetDescriptor> = parseList(Json.parseToJsonElement(text))

    /**
     * Parse one preset document from a raw JSON tree.
     * @param element the `{"presets":[...]}` document value.
     * @returns the descriptors in document order; empty when the Host projects none.
     * @throws IllegalArgumentException when the document, any entry, or id uniqueness is malformed.
     */
    fun parseList(element: JsonElement): List<LitePresetDescriptor> {
        val presets = (element as? JsonObject)?.get("presets") as? JsonArray ?: invalid("presets")
        val descriptors = presets.map { LitePresetDescriptor.parse(it) }
        if (descriptors.map { it.id }.toSet().size != descriptors.size) invalid("duplicate preset id")
        return descriptors
    }
}

private fun invalid(field: String): Nothing = throw IllegalArgumentException("missing or invalid $field")

private fun JsonObject.requiredText(field: String): String =
    (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: invalid(field)

private fun JsonObject.requiredNonBlank(field: String): String =
    requiredText(field).takeIf { it.isNotBlank() } ?: invalid(field)

private fun JsonObject.requiredOrder(): Long =
    (this["order"] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull
        ?.takeIf { it in 1..9_007_199_254_740_991L } ?: invalid("order")

private fun JsonObject.requiredBoolean(field: String): Boolean =
    (this[field] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull ?: invalid(field)

/**
 * Parse the persona object; `suffix` is the one optional field — absent and
 * JSON-null both read as no suffix, any non-string value fails loud. `prefix`
 * and `complete` are required; an empty prefix stays legal because the
 * assembled system prompt is what Lite consumes.
 */
private fun JsonObject.requiredPersona(): LitePresetPersona {
    val persona = this["persona"] as? JsonObject ?: invalid("persona")
    val suffix = when (val raw = persona["suffix"]) {
        null, is JsonNull -> null
        is JsonPrimitive -> raw.takeIf { it.isString }?.content ?: invalid("persona.suffix")
        else -> invalid("persona.suffix")
    }
    return LitePresetPersona(
        prefix = persona.requiredText("prefix"),
        suffix = suffix,
        complete = persona.requiredBoolean("complete"),
    )
}
