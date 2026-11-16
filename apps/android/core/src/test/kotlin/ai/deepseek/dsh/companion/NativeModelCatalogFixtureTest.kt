package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.*

class NativeModelCatalogFixtureTest {
    /** The Apple contract consumes the same catalog documents this parser accepts. */
    private fun appleCatalogFixtures(): File = generateSequence(File(System.getProperty("user.dir")!!)) { dir -> dir.parentFile }
        .map { dir -> File(dir, "apps/apple/contract/fixtures/native-model-catalog") }
        .firstOrNull { it.isDirectory }
        ?: fail("apple catalog fixtures not found from ${System.getProperty("user.dir")}")

    private fun wireValue(json: String): WireValue = WireValue.fromJsonElement(Json.parseToJsonElement(json))

    @Test fun `apple contract catalog fixtures parse with the same drops and fallbacks`() = runTest {
        val fixtures = appleCatalogFixtures().listFiles()!!.sortedBy { it.name }
        assertEquals(listOf("valid.json"), fixtures.filterNot { it.name.startsWith("invalid-") || it.name.startsWith("edge-") }.map { it.name })
        assertEquals(3, fixtures.count { it.name.startsWith("edge-") })
        assertEquals(1, fixtures.count { it.name.startsWith("invalid-") })
        suspend fun catalogOf(name: String): NativeModelCatalog {
            val wire = FakeWire()
            wire.stub("session/modelCatalog") { wireValue(File(appleCatalogFixtures(), name).readText()) }
            return SessionModel(wire, CoroutineScope(Dispatchers.Unconfined)).modelCatalog()
        }
        val valid = catalogOf("valid.json")
        assertEquals(2, valid.groups.size)
        assertEquals("DeepSeek 官方", valid.groups[0].name)
        assertEquals(2, valid.groups[0].models.size)
        assertNull(valid.groups[0].models[0].reasoning)
        val vision = valid.groups[0].models[1].reasoning!!
        assertEquals(listOf("off", "max", "low"), vision.efforts.map { it.id })
        assertEquals("low", vision.efforts[2].name)
        assertEquals("high", vision.defaultEffort)
        assertEquals("custom-group", valid.groups[1].name)
        assertEquals(0, valid.groups[1].models.size)
        assertEquals("deepseek-official", valid.defaultProvider)
        assertEquals("deepseek-v4-flash", valid.defaultModel)

        assertEquals(NativeModelCatalog(
            groups = listOf(NativeCatalogGroup("g1", "g1", listOf(
                NativeCatalogModel("m1", "m1"),
                NativeCatalogModel("m2", "m2", NativeModelReasoning(listOf(NativeEffortChoice("e1", "e1")), null)),
            ))),
            defaultProvider = "",
            defaultModel = "",
        ), catalogOf("edge-missing-ids.json"))
        assertEquals(NativeModelCatalog(
            groups = listOf(NativeCatalogGroup("g", "g", listOf(NativeCatalogModel("m", "m")))),
            defaultProvider = "",
            defaultModel = "",
        ), catalogOf("edge-type-fallbacks.json"))
        assertEquals(NativeModelCatalog(emptyList(), "", ""), catalogOf("edge-empty.json"))

        assertFails("malformed catalog JSON must be rejected") { catalogOf("invalid-malformed.json") }
    }
}
