package ai.deepseek.dsh.companion

import java.security.MessageDigest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** §43 same-candidate collector: the companion-side validation of a Host
 * support-bundle artifact. The canonical per-entry serialization (kind first,
 * content keys sorted), every per-entry SHA-256 and the chained checksum are
 * re-derived here independently of the Node producer — byte-identical
 * agreement over the same candidate artifact is the §43 same-candidate proof.
 * A bundle tampered in transit fails loud instead of diagnosing a lie.
 *
 * The canonical writer covers the wire vocabulary the §43 candidate uses
 * (strings, integers, booleans, null, arrays, objects); number literals ride
 * their source text, matching the producer's minimal integer form. */
object SupportBundleCollector {

    /** Validate one bundle artifact: strict shape, per-entry checksums, manifest
     * order, and the chained checksum; the first inconsistency names itself.
     * @throws IllegalArgumentException naming the violated rule. */
    fun validate(root: JsonObject) {
        val manifest = root.strictArray("manifest")
        val entries = root.strictArray("entries")
        if (entries.size != manifest.size) {
            throw IllegalArgumentException("support bundle manifest and entries disagree in count")
        }
        val byPath = entries.associate { entry ->
            val obj = entry.strictObject()
            obj.strictString("path") to obj
        }
        var previousPath: String? = null
        val rows = manifest.map { row ->
            val obj = row.strictObject()
            val path = obj.strictString("path")
            val expected = obj.strictString("sha256")
            if (previousPath != null && path < previousPath!!) {
                throw IllegalArgumentException("support bundle manifest is not sorted by path")
            }
            previousPath = path
            val entry = byPath[path]
                ?: throw IllegalArgumentException("support bundle manifest names missing entry '$path'")
            val digest = sha256Hex(serializeEntry(entry))
            if (digest != expected) {
                throw IllegalArgumentException("support bundle entry '$path' fails its checksum")
            }
            path to expected
        }
        val checksum = sha256Hex(rows.joinToString("\n") { "${it.first}:${it.second}" })
        if (checksum != root.strictString("checksum")) {
            throw IllegalArgumentException("support bundle chained checksum fails")
        }
    }

    /** Canonical per-entry serialization exactly as the Node producer defines
     * it: `kind` first, then the content's top-level keys in code-unit order —
     * nested objects keep their insertion order, which the producer's
     * serializer preserves verbatim. */
    internal fun serializeEntry(entry: JsonObject): String {
        val kind = entry.strictString("kind")
        val content = entry.strictObjectField("content")
        val builder = StringBuilder()
        builder.append("{\"kind\":").append(jsString(kind))
        for (key in content.keys.sorted()) {
            builder.append(',').append(jsString(key)).append(':').append(writeElement(content[key]!!))
        }
        builder.append('}')
        return builder.toString()
    }

    private fun writeElement(element: JsonElement): String = when (element) {
        is JsonNull -> "null"
        is JsonPrimitive ->
            if (element.isString) jsString(element.content) else element.content
        is JsonArray ->
            element.joinToString(",", "[", "]") { writeElement(it) }
        is JsonObject ->
            element.entries.joinToString(",", "{", "}") { (key, value) ->
                jsString(key) + ":" + writeElement(value)
            }
    }

    /** JSON string escaping exactly as the producer's serializer writes it:
     * the two mandatory escapes, the four short control escapes, and
     * `\u00xx` for the remaining control range. */
    private fun jsString(text: String): String {
        val builder = StringBuilder("\"")
        for (char in text) {
            when (char) {
                '"' -> builder.append("\\\"")
                '\\' -> builder.append("\\\\")
                '\n' -> builder.append("\\n")
                '\r' -> builder.append("\\r")
                '\t' -> builder.append("\\t")
                '\b' -> builder.append("\\b")
                '\u000C' -> builder.append("\\f")
                else ->
                    if (char.code < 0x20) builder.append("\\u%04x".format(char.code))
                    else builder.append(char)
            }
        }
        return builder.append('"').toString()
    }

    private fun sha256Hex(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte) }

    private fun JsonElement.strictObject(): JsonObject =
        this as? JsonObject ?: throw IllegalArgumentException("expected a JSON object")

    private fun JsonObject.strictObjectField(field: String): JsonObject =
        (this[field] as? JsonObject) ?: throw IllegalArgumentException("expected object field '$field'")

    private fun JsonObject.strictArray(field: String): JsonArray =
        (this[field] as? JsonArray) ?: throw IllegalArgumentException("expected array field '$field'")

    private fun JsonObject.strictString(field: String): String =
        (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw IllegalArgumentException("expected string field '$field'")
}
