package ai.deepseek.dsh.contract

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.Assumptions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Kotlin consumption evidence for the §32 lite tool-schema contract: the
 * parser accepts the agreed schema, refuses missing, mistyped, or blank
 * values loudly, and the generated Host projection stays within the ids the
 * tool-descriptor catalog declares for Lite.
 */
class LiteToolSchemaTest {

    /** One entry's raw fields, with per-test overrides and one omission. */
    private fun entry(vararg overrides: Pair<String, String>, omit: String? = null): String {
        val fields = linkedMapOf(
            "name" to "\"sample_web_search\"",
            "description" to "\"sample-description\"",
            "parameters" to "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}}",
        )
        overrides.forEach { (key, value) -> fields[key] = value }
        fields.remove(omit)
        return fields.entries.joinToString(",") { "\"${it.key}\":${it.value}" }
    }

    private fun document(vararg entries: String): String = "{\"tools\":[${entries.joinToString(",") { "{$it}" }}]}"

    @Test
    fun parsesEveryFieldOfOneEntry() {
        val schema = LiteToolSchemas.parseDocument(
            document(
                entry(
                    "name" to "\"sample_url_fetch\"",
                    "description" to "\"sample-description-url-fetch\"",
                    "parameters" to "{\"type\":\"object\",\"properties\":{\"url\":{\"type\":\"string\"}}}",
                ),
            ),
        ).single()
        assertEquals(
            LiteToolSchema(
                name = "sample_url_fetch",
                description = "sample-description-url-fetch",
                parameters = Json.parseToJsonElement("""{"type":"object","properties":{"url":{"type":"string"}}}""") as JsonObject,
            ),
            schema,
        )
    }

    @Test
    fun everyMissingFieldFailsLoud() {
        for (field in listOf("name", "description", "parameters")) {
            val failure = assertFailsWith<IllegalArgumentException>("omitting $field parsed") {
                LiteToolSchemas.parseDocument(document(entry(omit = field)))
            }
            assertTrue(failure.message!!.contains(field), "omitting $field: ${failure.message}")
        }
    }

    @Test
    fun mistypedFieldsFailLoud() {
        assertFailsWith<IllegalArgumentException> { LiteToolSchemas.parseDocument(document(entry("name" to "3"))) }
        assertFailsWith<IllegalArgumentException> { LiteToolSchemas.parseDocument(document(entry("description" to "null"))) }
        for (parameters in listOf("\"object\"", "[{\"type\":\"object\"}]", "null", "\"\"")) {
            assertFailsWith<IllegalArgumentException>("parameters $parameters parsed") {
                LiteToolSchemas.parseDocument(document(entry("parameters" to parameters)))
            }
        }
    }

    @Test
    fun blankNamesAndDescriptionsFailLoud() {
        for (name in listOf("\"\"", "\"  \"")) {
            val failure = assertFailsWith<IllegalArgumentException>("name $name parsed") {
                LiteToolSchemas.parseDocument(document(entry("name" to name)))
            }
            assertTrue(failure.message!!.contains("name"), failure.message)
        }
        for (description in listOf("\"\"", "\"  \"")) {
            val failure = assertFailsWith<IllegalArgumentException>("description $description parsed") {
                LiteToolSchemas.parseDocument(document(entry("description" to description)))
            }
            assertTrue(failure.message!!.contains("description"), failure.message)
        }
    }

    @Test
    fun malformedDocumentsFailLoud() {
        for (text in listOf("{}", "{\"tools\":{}}", "[{\"name\":\"sample_web_search\"}]", "null", "not json", "{\"tools\":[null]}", "{\"tools\":[3]}")) {
            assertFailsWith<IllegalArgumentException>("document $text parsed") { LiteToolSchemas.parseDocument(text) }
        }
    }

    @Test
    fun anEmptyProjectionAndUnknownFutureFieldsParse() {
        assertEquals(emptyList(), LiteToolSchemas.parseDocument("{\"tools\":[]}"))
        val schema = LiteToolSchemas.parseDocument(
            "{\"tools\":[{\"name\":\"sample_web_search\",\"description\":\"sample-description\"," +
                "\"parameters\":{\"type\":\"object\",\"properties\":{}},\"futureField\":{\"x\":1}}]}",
        ).single()
        assertEquals("sample_web_search", schema.name)
    }

    @Test
    fun repeatedNamesFailLoud() {
        assertFailsWith<IllegalArgumentException> {
            LiteToolSchemas.parseDocument(document(entry(), entry("description" to "\"sample-description-2\"")))
        }
    }

    /**
     * The cross-file consistency check against the real documents (the Host
     * projections copied from `packages/core/tools/` and the app-owned device
     * documents copied beside them): every name the two schema documents
     * carry — the Host's model-face projection and the app-owned device
     * schemas — names a tool the declared union (the descriptor catalog plus
     * the device declarations) declares with `supportsLite`.
     */
    @Test
    fun theSchemaProjectionStaysWithinTheLiteDeclaredToolIds() {
        val descriptorsResource = javaClass.classLoader.getResource("tool-descriptors.json")
        val schemasResource = javaClass.classLoader.getResource("lite-tool-schemas.json")
        val deviceDeclarationsResource = javaClass.classLoader.getResource("lite-tool-declarations.json")
        val deviceSchemasResource = javaClass.classLoader.getResource("lite-device-tool-schemas.json")
        Assumptions.assumeTrue(
            descriptorsResource != null && schemasResource != null &&
                deviceDeclarationsResource != null && deviceSchemasResource != null,
            "the tool projections or the app-owned device documents are absent; the integration stage reruns this cross-check",
        )
        val liteIds = (
            ToolDescriptors.parseDocument(descriptorsResource!!.readText(Charsets.UTF_8)) +
                ToolDescriptors.parseDocument(deviceDeclarationsResource!!.readText(Charsets.UTF_8))
            ).filter { it.supportsLite }.map { it.id }.toSet()
        val names = LiteToolSchemas.parseDocument(schemasResource!!.readText(Charsets.UTF_8)).map { it.name } +
            LiteToolSchemas.parseDocument(deviceSchemasResource!!.readText(Charsets.UTF_8)).map { it.name }
        for (name in names) {
            assertTrue(name in liteIds, "schema $name is not a supportsLite tool id in the declared union")
        }
    }
}
