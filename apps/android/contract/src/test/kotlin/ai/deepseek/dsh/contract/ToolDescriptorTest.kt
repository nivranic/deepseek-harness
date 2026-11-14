package ai.deepseek.dsh.contract

import org.junit.jupiter.api.Assumptions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Kotlin consumption evidence for the §32 tool-descriptor contract: the
 * parser accepts the agreed schema, refuses out-of-vocabulary or mistyped
 * values loudly, and the generated Host projection parses in its stable
 * order.
 */
class ToolDescriptorTest {

    /** One entry's raw fields, with per-test overrides and one omission. */
    private fun entry(vararg overrides: Pair<String, String>, omit: String? = null): String {
        val fields = linkedMapOf(
            "id" to "\"web_search\"",
            "version" to "1",
            "risk" to "\"low\"",
            "permissions" to "[\"net.search\"]",
            "supportsLite" to "true",
            "supportsRemote" to "true",
        )
        overrides.forEach { (key, value) -> fields[key] = value }
        fields.remove(omit)
        return fields.entries.joinToString(",") { "\"${it.key}\":${it.value}" }
    }

    private fun document(vararg entries: String): String = "{\"tools\":[${entries.joinToString(",") { "{$it}" }}]}"

    @Test
    fun parsesEveryFieldOfOneEntry() {
        val descriptor = ToolDescriptors.parseDocument(
            document(
                entry(
                    "id" to "\"url_fetch\"",
                    "version" to "3",
                    "risk" to "\"critical\"",
                    "permissions" to "[\"net.fetch\",\"disk.read\"]",
                    "supportsLite" to "false",
                    "supportsRemote" to "true",
                ),
            ),
        ).single()
        assertEquals(
            ToolDescriptor("url_fetch", 3, ToolRisk.CRITICAL, listOf("net.fetch", "disk.read"), supportsLite = false, supportsRemote = true),
            descriptor,
        )
    }

    @Test
    fun allFourRiskTiersParseFromTheirWireSpellings() {
        val tiers = mapOf("low" to ToolRisk.LOW, "moderate" to ToolRisk.MODERATE, "high" to ToolRisk.HIGH, "critical" to ToolRisk.CRITICAL)
        for ((wire, tier) in tiers) {
            val descriptor = ToolDescriptors.parseDocument(document(entry("risk" to "\"$wire\""))).single()
            assertEquals(tier, descriptor.risk, "risk wire $wire did not parse")
        }
    }

    @Test
    fun risksOutsideTheVocabularyFailLoud() {
        for (risk in listOf("\"extreme\"", "\"LOW\"", "\"\"")) {
            val failure = assertFailsWith<IllegalArgumentException> {
                ToolDescriptors.parseDocument(document(entry("risk" to risk)))
            }
            assertTrue(failure.message!!.contains("risk"), failure.message)
        }
    }

    @Test
    fun nonPositiveFractionalOrStringVersionsFailLoud() {
        for (version in listOf("0", "-1", "1.5", "\"2\"", "9007199254740992", "null")) {
            val failure = assertFailsWith<IllegalArgumentException> {
                ToolDescriptors.parseDocument(document(entry("version" to version)))
            }
            assertTrue(failure.message!!.contains("version"), failure.message)
        }
    }

    @Test
    fun everyMissingFieldFailsLoud() {
        for (field in listOf("id", "version", "risk", "permissions", "supportsLite", "supportsRemote")) {
            val failure = assertFailsWith<IllegalArgumentException>("omitting $field parsed") {
                ToolDescriptors.parseDocument(document(entry(omit = field)))
            }
            assertTrue(failure.message!!.contains(field), "omitting $field: ${failure.message}")
        }
    }

    @Test
    fun mistypedFieldsFailLoud() {
        assertFailsWith<IllegalArgumentException> { ToolDescriptors.parseDocument(document(entry("id" to "123"))) }
        assertFailsWith<IllegalArgumentException> { ToolDescriptors.parseDocument(document(entry("permissions" to "\"net.search\""))) }
        assertFailsWith<IllegalArgumentException> { ToolDescriptors.parseDocument(document(entry("permissions" to "[\"net.search\",3]"))) }
        assertFailsWith<IllegalArgumentException> { ToolDescriptors.parseDocument(document(entry("permissions" to "[null]"))) }
        assertFailsWith<IllegalArgumentException> { ToolDescriptors.parseDocument(document(entry("supportsLite" to "\"true\""))) }
        assertFailsWith<IllegalArgumentException> { ToolDescriptors.parseDocument(document(entry("supportsRemote" to "1"))) }
    }

    @Test
    fun malformedDocumentsFailLoud() {
        for (text in listOf("{}", "{\"tools\":{}}", "[{\"id\":\"web_search\"}]", "null", "not json", "{\"tools\":[null]}")) {
            assertFailsWith<IllegalArgumentException>("document $text parsed") { ToolDescriptors.parseDocument(text) }
        }
    }

    @Test
    fun anEmptyCatalogAndUnknownFutureFieldsParse() {
        assertEquals(emptyList(), ToolDescriptors.parseDocument("{\"tools\":[]}"))
        val descriptor = ToolDescriptors.parseDocument(
            "{\"tools\":[{\"id\":\"a\",\"version\":1,\"risk\":\"low\",\"permissions\":[],\"supportsLite\":true,\"supportsRemote\":false,\"futureField\":{\"x\":1}}]}",
        ).single()
        assertEquals("a", descriptor.id)
    }

    @Test
    fun repeatedIdsFailLoud() {
        assertFailsWith<IllegalArgumentException> {
            ToolDescriptors.parseDocument(document(entry(), entry("version" to "2")))
        }
    }

    @Test
    fun theGeneratedProjectionParsesSortedAndUnique() {
        val resource = javaClass.classLoader.getResource("tool-descriptors.json")
        Assumptions.assumeTrue(
            resource != null,
            "packages/core/tools/tool-descriptors.json has not been generated yet; the integration stage reruns this projection test",
        )
        val descriptors = ToolDescriptors.parseDocument(resource!!.readText(Charsets.UTF_8))
        val ids = descriptors.map { it.id }
        assertTrue(ids.isNotEmpty(), "the projection covers the bundled harvest list and cannot be empty")
        assertEquals(ids.sorted(), ids, "the projection must stay sorted by id")
    }
}
