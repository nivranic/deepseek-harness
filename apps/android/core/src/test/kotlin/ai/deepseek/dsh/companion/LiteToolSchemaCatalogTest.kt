package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LiteToolSchema
import ai.deepseek.dsh.contract.LiteToolSchemas
import ai.deepseek.dsh.contract.ToolDescriptors
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assumptions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The §32 tool-schema selection: the Host projection drives the catalog's
 * schemas, and a session without a projection runs bare — requests then carry
 * no tools key at all.
 */
class LiteToolSchemaCatalogTest {

    @Test
    fun bareModeCarriesNoSchemas() {
        assertEquals(LiteToolSchemaSource.BARE, LiteToolSchemaCatalog.BARE.source)
        assertTrue(LiteToolSchemaCatalog.BARE.tools.isEmpty())
    }

    @Test
    fun anEmptyProjectionKeepsTheExplicitSource() {
        val catalog = LiteToolSchemaCatalog.fromProjectedDocument(Json.parseToJsonElement("{\"tools\":[]}"))
        assertEquals(LiteToolSchemaSource.HOST_PROJECTED, catalog.source)
        assertTrue(catalog.tools.isEmpty())
    }

    @Test
    fun malformedDocumentsFailLoudThroughTheCatalog() {
        assertFailsWith<IllegalArgumentException> {
            LiteToolSchemaCatalog.fromProjectedDocument(Json.parseToJsonElement("null"))
        }
    }

    @Test
    fun theSampleFixtureDrivesOneCatalog() {
        val sample = javaClass.classLoader.getResource("fixtures/lite-tool-schemas.sample.json")!!
        val catalog = LiteToolSchemaCatalog.fromProjectedDocument(Json.parseToJsonElement(sample.readText(Charsets.UTF_8)))
        assertEquals(LiteToolSchemaSource.HOST_PROJECTED, catalog.source)
        // The fixture mirrors the projection's shape: the two sample tools
        // keep their document order.
        assertEquals(listOf("sample_web_search", "sample_url_fetch"), catalog.tools.map { it.name })
        assertEquals(LiteToolSchemas.parseDocument(sample.readText(Charsets.UTF_8)), catalog.tools)
    }

    /**
     * The real projection at `packages/core/tools/lite-tool-schemas.json`
     * (copied into test resources by copyLiteToolSchemas) drives one
     * Host-projected catalog; the sample fixture
     * `fixtures/lite-tool-schemas.sample.json` keeps the same schema for
     * behavior tests and is refreshed by rerunning that projection.
     */
    @Test
    fun theHostProjectionDrivesOneCatalog() {
        val resource = javaClass.classLoader.getResource("lite-tool-schemas.json")
        Assumptions.assumeTrue(
            resource != null,
            "packages/core/tools/lite-tool-schemas.json has not been generated yet; the integration stage reruns this cross-check",
        )
        val catalog = LiteToolSchemaCatalog.fromProjectedDocument(Json.parseToJsonElement(resource!!.readText(Charsets.UTF_8)))
        assertEquals(LiteToolSchemaSource.HOST_PROJECTED, catalog.source)
        assertEquals(LiteToolSchemas.parseDocument(resource.readText(Charsets.UTF_8)), catalog.tools)
    }

    @Test
    fun theBundledSchemaUnionKeepsProjectionOrderAheadOfTheDeviceDocument() {
        val host = LiteToolSchemas.parseDocument(
            "{\"tools\":[{\"name\":\"sample_web_search\",\"description\":\"d\",\"parameters\":{\"type\":\"object\"}}]}",
        )
        val device = LiteToolSchemas.parseDocument(
            "{\"tools\":[{\"name\":\"sample_calculator\",\"description\":\"d\",\"parameters\":{\"type\":\"object\"}}]}",
        )
        val union = LiteToolSchemaCatalog.fromBundledDocuments(host, device)
        assertEquals(LiteToolSchemaSource.BUNDLED, union.source)
        assertEquals(host + device, union.tools)
        // An empty side keeps the explicit source with the other side intact.
        assertEquals(emptyList<LiteToolSchema>(), LiteToolSchemaCatalog.fromBundledDocuments(emptyList(), emptyList()).tools)
    }

    @Test
    fun aNameInBothSchemaDocumentsFailsLoudNamingTheCollision() {
        val one = LiteToolSchemas.parseDocument(
            "{\"tools\":[{\"name\":\"sample_web_search\",\"description\":\"d\",\"parameters\":{\"type\":\"object\"}}]}",
        )
        val failure = assertFailsWith<IllegalArgumentException> {
            LiteToolSchemaCatalog.fromBundledDocuments(one, one)
        }
        assertTrue("sample_web_search" in failure.message.orEmpty(), "the collision message must name the colliding schema")
    }

    /**
     * The device-schema twin of the declaration union's cross-check: every
     * name in the app-owned device schema document
     * (`apps/android/app/lite/lite-device-tool-schemas.json`, copied beside
     * the declarations by copyToolDescriptors) names an id the device
     * declaration document carries with `supportsLite`.
     */
    @Test
    fun theDeviceSchemasStayWithinTheDeviceDeclarationsLiteIds() {
        val schemas = javaClass.classLoader.getResource("lite-device-tool-schemas.json")
        val declarations = javaClass.classLoader.getResource("lite-tool-declarations.json")
        Assumptions.assumeTrue(
            schemas != null && declarations != null,
            "the app-owned device documents have not been copied into test resources yet; the integration stage reruns this cross-check",
        )
        val liteIds = ToolDescriptors.parseDocument(declarations!!.readText(Charsets.UTF_8))
            .filter { it.supportsLite }
            .map { it.id }
            .toSet()
        for (schema in LiteToolSchemas.parseDocument(schemas!!.readText(Charsets.UTF_8))) {
            assertTrue(
                schema.name in liteIds,
                "device schema ${schema.name} is not a supportsLite tool id in the device declaration document",
            )
        }
    }
}
