package ai.deepseek.dsh.contract

import org.junit.jupiter.api.Assumptions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Kotlin consumption evidence for the §33 lite-preset contract: the parser
 * accepts the agreed schema, refuses missing, mistyped, or blank values
 * loudly, and the generated Host projection parses in its stable sorted
 * order.
 */
class LitePresetDescriptorTest {

    /** One entry's raw fields, with per-test overrides and one omission. */
    private fun entry(vararg overrides: Pair<String, String>, omit: String? = null): String {
        val fields = linkedMapOf(
            "id" to "\"minimal\"",
            "order" to "3",
            "persona" to "{\"prefix\":\"sample-prefix\",\"complete\":true}",
            "includeRuntimeContext" to "false",
            "assembledSystemPrompt" to "\"sample-assembled\"",
        )
        overrides.forEach { (key, value) -> fields[key] = value }
        fields.remove(omit)
        return fields.entries.joinToString(",") { "\"${it.key}\":${it.value}" }
    }

    private fun document(vararg entries: String): String = "{\"presets\":[${entries.joinToString(",") { "{$it}" }}]}"

    @Test
    fun parsesEveryFieldOfOneEntry() {
        val descriptor = LitePresetDescriptors.parseDocument(
            document(
                entry(
                    "id" to "\"future\"",
                    "order" to "7",
                    "persona" to "{\"prefix\":\"sample-prefix\",\"suffix\":\"sample-suffix\",\"complete\":false}",
                    "includeRuntimeContext" to "true",
                    "assembledSystemPrompt" to "\"sample-assembled-future\"",
                ),
            ),
        ).single()
        assertEquals(
            LitePresetDescriptor(
                id = "future",
                order = 7,
                persona = LitePresetPersona(prefix = "sample-prefix", suffix = "sample-suffix", complete = false),
                includeRuntimeContext = true,
                assembledSystemPrompt = "sample-assembled-future",
            ),
            descriptor,
        )
    }

    @Test
    fun anAbsentOrNullSuffixParsesAsNoSuffix() {
        assertNull(LitePresetDescriptors.parseDocument(document(entry())).single().persona.suffix)
        assertNull(
            LitePresetDescriptors.parseDocument(
                document(entry("persona" to "{\"prefix\":\"sample-prefix\",\"suffix\":null,\"complete\":true}")),
            ).single().persona.suffix,
        )
    }

    @Test
    fun anEmptyPrefixStaysLegal() {
        val descriptor = LitePresetDescriptors.parseDocument(
            document(entry("persona" to "{\"prefix\":\"\",\"complete\":true}")),
        ).single()
        assertEquals("", descriptor.persona.prefix)
    }

    @Test
    fun everyMissingFieldFailsLoud() {
        for (field in listOf("id", "order", "persona", "includeRuntimeContext", "assembledSystemPrompt")) {
            val failure = assertFailsWith<IllegalArgumentException>("omitting $field parsed") {
                LitePresetDescriptors.parseDocument(document(entry(omit = field)))
            }
            assertTrue(failure.message!!.contains(field), "omitting $field: ${failure.message}")
        }
        for ((persona, field) in listOf(
            "{\"complete\":true}" to "prefix",
            "{\"prefix\":\"sample-prefix\"}" to "complete",
        )) {
            val failure = assertFailsWith<IllegalArgumentException>("persona $persona parsed") {
                LitePresetDescriptors.parseDocument(document(entry("persona" to persona)))
            }
            assertTrue(failure.message!!.contains(field), "persona $persona: ${failure.message}")
        }
    }

    @Test
    fun mistypedFieldsFailLoud() {
        assertFailsWith<IllegalArgumentException> { LitePresetDescriptors.parseDocument(document(entry("id" to "3"))) }
        for (order in listOf("\"3\"", "0", "-1", "1.5", "9007199254740992", "null")) {
            assertFailsWith<IllegalArgumentException>("order $order parsed") {
                LitePresetDescriptors.parseDocument(document(entry("order" to order)))
            }
        }
        assertFailsWith<IllegalArgumentException> { LitePresetDescriptors.parseDocument(document(entry("persona" to "\"minimal\""))) }
        assertFailsWith<IllegalArgumentException> {
            LitePresetDescriptors.parseDocument(document(entry("persona" to "{\"prefix\":3,\"complete\":true}")))
        }
        assertFailsWith<IllegalArgumentException> {
            LitePresetDescriptors.parseDocument(document(entry("persona" to "{\"prefix\":\"p\",\"suffix\":3,\"complete\":true}")))
        }
        assertFailsWith<IllegalArgumentException> {
            LitePresetDescriptors.parseDocument(document(entry("persona" to "{\"prefix\":\"p\",\"complete\":\"true\"}")))
        }
        assertFailsWith<IllegalArgumentException> { LitePresetDescriptors.parseDocument(document(entry("includeRuntimeContext" to "\"false\""))) }
        assertFailsWith<IllegalArgumentException> { LitePresetDescriptors.parseDocument(document(entry("assembledSystemPrompt" to "3"))) }
    }

    @Test
    fun blankIdsAndAssembledPromptsFailLoud() {
        for (id in listOf("\"\"", "\"  \"")) {
            val failure = assertFailsWith<IllegalArgumentException>("id $id parsed") {
                LitePresetDescriptors.parseDocument(document(entry("id" to id)))
            }
            assertTrue(failure.message!!.contains("id"), failure.message)
        }
        for (assembled in listOf("\"\"", "\"  \"")) {
            val failure = assertFailsWith<IllegalArgumentException>("assembledSystemPrompt $assembled parsed") {
                LitePresetDescriptors.parseDocument(document(entry("assembledSystemPrompt" to assembled)))
            }
            assertTrue(failure.message!!.contains("assembledSystemPrompt"), failure.message)
        }
    }

    @Test
    fun malformedDocumentsFailLoud() {
        for (text in listOf("{}", "{\"presets\":{}}", "[{\"id\":\"minimal\"}]", "null", "not json", "{\"presets\":[null]}", "{\"presets\":[3]}")) {
            assertFailsWith<IllegalArgumentException>("document $text parsed") { LitePresetDescriptors.parseDocument(text) }
        }
    }

    @Test
    fun anEmptyProjectionAndUnknownFutureFieldsParse() {
        assertEquals(emptyList(), LitePresetDescriptors.parseDocument("{\"presets\":[]}"))
        val descriptor = LitePresetDescriptors.parseDocument(
            "{\"presets\":[{\"id\":\"minimal\",\"order\":3,\"persona\":{\"prefix\":\"sample-prefix\",\"complete\":true,\"futureField\":1}," +
                "\"includeRuntimeContext\":false,\"assembledSystemPrompt\":\"sample-assembled\",\"futureField\":{\"x\":1}}]}",
        ).single()
        assertEquals("minimal", descriptor.id)
    }

    @Test
    fun repeatedIdsFailLoud() {
        assertFailsWith<IllegalArgumentException> {
            LitePresetDescriptors.parseDocument(document(entry(), entry("order" to "4")))
        }
    }

    @Test
    fun theGeneratedProjectionParsesSortedAndUnique() {
        val resource = javaClass.classLoader.getResource("lite-preset-descriptors.json")
        Assumptions.assumeTrue(
            resource != null,
            "packages/preset/agent-presets/lite-preset-descriptors.json has not been generated yet; the integration stage reruns this projection test",
        )
        val descriptors = LitePresetDescriptors.parseDocument(resource!!.readText(Charsets.UTF_8))
        val ids = descriptors.map { it.id }
        assertTrue(ids.isNotEmpty(), "the projection carries the lite preset catalog and cannot be empty")
        assertEquals(ids.sorted(), ids, "the projection must stay sorted by id")
    }
}
