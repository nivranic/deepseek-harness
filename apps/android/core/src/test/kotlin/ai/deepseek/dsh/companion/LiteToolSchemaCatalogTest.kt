package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LiteToolSchemas
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
}
