package ai.deepseek.dsh.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** The §43 same-candidate collector lane: the sealed candidate fixture the Node
 * producer emitted (packages/api/host-diagnostics/tests/fixtures) validates
 * here through the independent Kotlin port, and the port re-derives the same
 * chained checksum — the two-platform same-candidate proof. Every tamper shape
 * the Node collector refuses fails here too. */
class SupportBundleCollectorTest {

    private val candidate: JsonObject =
        javaClass.getResourceAsStream("/support-bundle-candidate.json")!!
            .readBytes().decodeToString()
            .let { Json.parseToJsonElement(it) as JsonObject }

    /** The chain checksum the Node producer sealed for this candidate; agreement
     * here is derived, never copied from the artifact's own field. */
    private val expectedChainChecksum = "b0919adec35e7dbb5807c88fe3f2a032da5b5c182f72574de08c9f6210af35f4"

    @Test
    fun validatesTheSealedCandidateAndDerivesTheSameChainChecksum() {
        SupportBundleCollector.validate(candidate)
        assertEquals(expectedChainChecksum, deriveChainChecksum(candidate))
    }

    @Test
    fun refusesATamperedEntryValue() {
        val tampered = deepMutate(candidate, "entries", 0, "productVersion", "9.9.9")
        assertFailsWith<IllegalArgumentException> { SupportBundleCollector.validate(tampered) }
    }

    @Test
    fun refusesATamperedChainChecksum() {
        val tampered = shallowCopy(candidate, "checksum", Json.parseToJsonElement("\"" + "0".repeat(64) + "\""))
        assertFailsWith<IllegalArgumentException> { SupportBundleCollector.validate(tampered) }
    }

    @Test
    fun refusesADroppedManifestRow() {
        val manifest = candidate["manifest"] as JsonArray
        val root = candidate.toMutableMap()
        root["manifest"] = JsonArray(manifest.drop(1))
        assertFailsWith<IllegalArgumentException> { SupportBundleCollector.validate(JsonObject(root)) }
    }

    @Test
    fun refusesAnUnsortedManifest() {
        val manifest = candidate["manifest"] as JsonArray
        val root = candidate.toMutableMap()
        root["manifest"] = JsonArray(manifest.reversed())
        assertFailsWith<IllegalArgumentException> { SupportBundleCollector.validate(JsonObject(root)) }
    }

    /** Re-derive the chained checksum exactly as the collector computes it: the
     * ordered `path:sha256` rows joined by newline, hashed once. */
    private fun deriveChainChecksum(root: JsonObject): String {
        val manifest = root["manifest"] as JsonArray
        val entries = root["entries"] as JsonArray
        val byPath = entries.associate { entry ->
            val obj = entry as JsonObject
            (obj["path"] as JsonPrimitive).content to obj
        }
        val rows = manifest.map { row ->
            val obj = row as JsonObject
            val path = (obj["path"] as JsonPrimitive).content
            val expected = (obj["sha256"] as JsonPrimitive).content
            val digest = sha256Hex(SupportBundleCollector.serializeEntry(byPath.getValue(path)))
            assertEquals(expected, digest, "entry digest must re-derive for $path")
            "$path:$expected"
        }
        return sha256Hex(rows.joinToString("\n"))
    }

    private fun sha256Hex(text: String): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte) }

    private fun shallowCopy(root: JsonObject, field: String, value: kotlinx.serialization.json.JsonElement): JsonObject {
        val copy = root.toMutableMap()
        copy[field] = value
        return JsonObject(copy)
    }

    private fun deepMutate(root: JsonObject, arrayField: String, index: Int, contentField: String, value: String): JsonObject {
        val array = root[arrayField] as JsonArray
        val entry = array[index] as JsonObject
        val content = entry["content"] as JsonObject
        val mutatedContent = content.toMutableMap()
        mutatedContent[contentField] = Json.parseToJsonElement("\"$value\"")
        val mutatedEntry = entry.toMutableMap()
        mutatedEntry["content"] = JsonObject(mutatedContent)
        val mutatedArray = array.toMutableList()
        mutatedArray[index] = JsonObject(mutatedEntry)
        val mutatedRoot = root.toMutableMap()
        mutatedRoot[arrayField] = JsonArray(mutatedArray)
        return JsonObject(mutatedRoot)
    }
}
