package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.*

class NativeFollowResumeFixtureTest {
    /** The Apple contract consumes the same follow-resume envelopes this core object builds. */
    private fun appleFollowFixtures(): File = generateSequence(File(System.getProperty("user.dir")!!)) { dir -> dir.parentFile }
        .map { dir -> File(dir, "apps/apple/contract/fixtures/native-follow-resume") }
        .firstOrNull { it.isDirectory }
        ?: fail("apple follow-resume fixtures not found from ${System.getProperty("user.dir")}")

    private fun envelope(name: String): Map<String, WireValue> {
        val root = Json.parseToJsonElement(File(appleFollowFixtures(), name).readText()) as JsonObject
        val address = if ((root["kind"] as JsonPrimitive).content == "subagent") {
            NativeFollowResume.subagentAddress(
                (root["parentSessionId"] as JsonPrimitive).content,
                (root["childSessionId"] as JsonPrimitive).content,
                (root["mode"] as JsonPrimitive).content,
            )
        } else {
            NativeFollowResume.sessionAddress((root["sessionId"] as JsonPrimitive).content)
        }
        val cursor = (root["fromSeq"] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.toLong()
        return NativeFollowResume.request(address, (root["maxMessages"] as JsonPrimitive).content.toInt(), cursor)
    }

    @Test fun `apple contract follow-resume fixtures build the pinned envelopes`() {
        val fixtures = appleFollowFixtures().listFiles()!!.sortedBy { it.name }
        assertEquals(listOf("valid.json"), fixtures.filterNot { it.name.startsWith("invalid-") || it.name.startsWith("edge-") }.map { it.name })
        assertEquals(3, fixtures.count { it.name.startsWith("edge-") })
        assertEquals(1, fixtures.count { it.name.startsWith("invalid-") })

        for (name in listOf("valid.json", "edge-fresh.json", "edge-cursor-zero.json", "edge-subagent.json")) {
            val root = Json.parseToJsonElement(File(appleFollowFixtures(), name).readText()) as JsonObject
            val expected = WireValue.fromJsonElement((root["body"] as JsonObject)["request"]!!)
            assertEquals(expected, envelope(name)["request"], name)
        }
    }

    @Test fun `apple contract follow-resume invalid fixture is rejected at the builder boundary`() {
        assertFails("negative resume cursor must be rejected") {
            envelope("invalid-negative-seq.json")
        }
        assertFails("zero page size must be rejected") {
            NativeFollowResume.request(NativeFollowResume.sessionAddress("s-3"), 0, null)
        }
    }
}
