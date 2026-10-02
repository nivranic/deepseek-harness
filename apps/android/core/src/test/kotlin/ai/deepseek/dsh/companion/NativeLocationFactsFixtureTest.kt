package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.*

class NativeLocationFactsFixtureTest {
    /** The Apple contract consumes the same location documents this derivation accepts. */
    private fun appleLocationFixtures(): File = generateSequence(File(System.getProperty("user.dir")!!)) { dir -> dir.parentFile }
        .map { dir -> File(dir, "apps/apple/contract/fixtures/native-location-facts") }
        .firstOrNull { it.isDirectory }
        ?: fail("apple location fixtures not found from ${System.getProperty("user.dir")}")

    private fun wireValue(json: String): WireValue = WireValue.fromJsonElement(Json.parseToJsonElement(json))

    private fun string(member: JsonElement?): String? =
        (member as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    private data class Derived(val facts: List<String>, val detail: String?)

    /** Drive the real core derivation over one shared fixture document. */
    private fun derive(name: String): Derived {
        val root = Json.parseToJsonElement(File(appleLocationFixtures(), name).readText()).let { it as? JsonObject ?: JsonObject(emptyMap()) }
        val host = root["host"] as? JsonObject
        val hostName = NativeLocationFacts.presentedHostName(
            string(host?.get("name")),
            string(host?.get("hostId")),
        )
        val cwd = string(root["cwd"])
        val journal = (root["journal"] as? JsonArray)?.map { wireValue(it.toString()) } ?: emptyList()
        val state = string(root["connectionState"])
        return Derived(
            NativeLocationFacts.factsLine(hostName, cwd, NativeLocationFacts.latestPreset(journal), state),
            NativeLocationFacts.detailLine(cwd),
        )
    }

    @Test fun `apple contract location fixtures derive the same facts and fallbacks`() {
        val fixtures = appleLocationFixtures().listFiles()!!.sortedBy { it.name }
        assertEquals(listOf("valid.json"), fixtures.filterNot { it.name.startsWith("invalid-") || it.name.startsWith("edge-") }.map { it.name })
        assertEquals(4, fixtures.count { it.name.startsWith("edge-") })
        assertEquals(1, fixtures.count { it.name.startsWith("invalid-") })

        assertEquals(Derived(
            listOf("Work PC", "deepseek-harness", "read-only", "reconnecting"),
            "full · E:\\Mix\\project\\deepseek-harness",
        ), derive("valid.json"))
        assertEquals(Derived(listOf("lab-2", "/"), "full · /"), derive("edge-blank-fallbacks.json"))
        assertEquals(Derived(emptyList(), null), derive("edge-absent-facts.json"))
        assertEquals(Derived(listOf("custom-host-preset"), null), derive("edge-preset-kept.json"))
        assertEquals(Derived(listOf("Desk", "src"), "full · src"), derive("edge-unknown-state.json"))

        assertFails("malformed location JSON must be rejected") {
            Json.parseToJsonElement(File(appleLocationFixtures(), "invalid-malformed.json").readText())
        }
    }
}
