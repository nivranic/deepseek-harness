package ai.deepseek.dsh.contract

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SpecVersion
import java.io.InputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Kotlin consumption evidence for the candidate Remote failure contract: the
 * draft 2020-12 envelope schema validates real HTTP payloads and rejects
 * malformed known-code details, and the classification mirror equals the
 * generated projection of the TypeScript authority.
 */
class EnvelopeSchemaTest {

    private val mapper = ObjectMapper()
    private val schema = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012)
        .getSchema(resource("remote-errors.schema.json"))

    private fun resource(name: String): InputStream =
        javaClass.classLoader.getResourceAsStream(name) ?: error("missing test resource $name")

    private fun fixture(name: String): JsonNode = mapper.readTree(resource(name))

    private fun envelope(code: String, message: String, details: Any?): ObjectNode {
        val node = mapper.createObjectNode()
        node.put("code", code)
        node.put("message", message)
        node.set<JsonNode>("details", mapper.valueToTree(details))
        return node
    }

    @Test
    fun schemaDeclaresNinetyOneKnownBranchesPlusOneOpaqueUnknownBranch() {
        val branches = schema.schemaNode["anyOf"]
        assertEquals(92, branches.size(), "expected 91 known branches plus the opaque unknown branch")
        val knownCodes = (0 until branches.size() - 1).map { branches[it]["properties"]["code"]["const"].asText() }
        assertEquals(91, knownCodes.toSet().size)
        val unknown = branches[branches.size() - 1]
        assertEquals(91, unknown["properties"]["code"]["not"]["enum"].size())
    }

    @Test
    fun fiveActualHttpPayloadsValidate() {
        for (index in 1..5) {
            val errors = schema.validate(fixture("fixtures/http-payload-$index.json"))
            assertTrue(errors.isEmpty(), "fixture $index failed: $errors")
        }
    }

    @Test
    fun unknownFutureCodeStaysAnOpaqueDiagnostic() {
        val errors = schema.validate(envelope("future/some-code", "unknown owner diagnostic", mapOf("anything" to listOf(1, 2))))
        assertTrue(errors.isEmpty(), "opaque unknown branch rejected a future code: $errors")
    }

    @Test
    fun malformedKnownCodeDetailsAreRejected() {
        val stringDetails = schema.validate(envelope("gateway/host-not-ready", "not ready", "plain string"))
        assertTrue(stringDetails.isNotEmpty(), "a known code must not accept string details")
        val malformedIssues = schema.validate(
            envelope("gateway/bad-request", "bad request", mapOf("issues" to listOf(17, "not an issue"))),
        )
        assertTrue(malformedIssues.isNotEmpty(), "a known code must not accept malformed issue entries")
    }

    @Test
    fun missingMessageIsRejected() {
        val node = mapper.createObjectNode()
        node.put("code", "gateway/host-not-ready")
        node.set<JsonNode>("details", mapper.valueToTree(mapOf("endpoint" to "a/b", "httpStatus" to 503)))
        assertTrue(schema.validate(node).isNotEmpty(), "message is required")
    }

    @Test
    fun classificationMirrorEqualsTheGeneratedProjection() {
        val generated: Map<String, String> = mapper.readValue(
            resource("generated/remote-failure-classes.json"),
            object : com.fasterxml.jackson.core.type.TypeReference<Map<String, String>>() {},
        )
        val mirrored = RemoteFailureClasses.BY_CODE.mapValues { it.value.WIRE }
        assertEquals(generated, mirrored, "the Kotlin mirror drifted from the TypeScript authority")
    }

    @Test
    fun classificationReferencesOnlySchemaDeclaredCodes() {
        val knownCodes = (0 until schema.schemaNode["anyOf"].size() - 1)
            .map { schema.schemaNode["anyOf"][it]["properties"]["code"]["const"].asText() }
            .toSet()
        for (code in RemoteFailureClasses.BY_CODE.keys) {
            assertTrue(code in knownCodes, "classified code $code is not declared by the schema")
        }
    }

    @Test
    fun unclassifiedVocabularyCodeResolvesToUnknown() {
        assertEquals(RemoteFailureClass.UNKNOWN, RemoteFailureClasses.classify("gateway/service-unavailable"))
        assertEquals(RemoteFailureClass.UNKNOWN, RemoteFailureClasses.classify("future/some-code"))
    }
}
