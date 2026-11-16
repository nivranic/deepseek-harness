package ai.deepseek.dsh.companion

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlin.test.*

class NativeViewLocationFixtureTest {
    /** The Apple contract consumes the same view-location payloads this codec reads and writes. */
    private fun appleViewFixtures(): File = generateSequence(File(System.getProperty("user.dir")!!)) { dir -> dir.parentFile }
        .map { dir -> File(dir, "apps/apple/contract/fixtures/native-view-location") }
        .firstOrNull { it.isDirectory }
        ?: fail("apple view-location fixtures not found from ${System.getProperty("user.dir")}")

    /** The decode-side caller bound the Companion applies to untrusted clipboard data. */
    private val maxCharacters = 4096

    private data class Doc(val location: NativeViewLocation?, val encoded: String)

    private fun doc(name: String): Doc {
        val root = Json.parseToJsonElement(File(appleViewFixtures(), name).readText()) as JsonObject
        val encoded = (root["encoded"] as JsonPrimitive).content
        val location = (root["location"] as? JsonObject)?.let { body ->
            NativeViewLocation(
                hostId = (body["hostId"] as JsonPrimitive).content,
                sessionId = (body["sessionId"] as JsonPrimitive).content,
                anchorSeq = (body["anchorSeq"] as? JsonPrimitive)?.longOrNull
                    ?: (body["anchorSeq"] as JsonPrimitive).doubleOrNull!!.toLong(),
            )
        }
        return Doc(location, encoded)
    }

    @Test fun `apple contract view-location fixtures round-trip to the pinned bytes`() {
        val fixtures = appleViewFixtures().listFiles()!!.sortedBy { it.name }
        assertEquals(listOf("valid.json"), fixtures.filterNot { it.name.startsWith("invalid-") || it.name.startsWith("edge-") }.map { it.name })
        assertEquals(3, fixtures.count { it.name.startsWith("edge-") })
        assertEquals(6, fixtures.count { it.name.startsWith("invalid-") })

        for (name in listOf("valid.json", "edge-anchor-zero.json", "edge-escaped-ids.json", "edge-max-safe-integer.json")) {
            val document = doc(name)
            assertEquals(document.location, NativeViewLocations.decode(document.encoded, maxCharacters), name)
            assertEquals(document.encoded, NativeViewLocations.encode(document.location!!), name)
        }
    }

    @Test fun `apple contract view-location invalid fixtures are rejected at the parse boundary`() {
        for (name in listOf(
            "invalid-unknown-prefix.json", "invalid-not-base64url.json", "invalid-not-json.json",
            "invalid-wrong-fields.json", "invalid-bad-anchor.json", "invalid-anchor-negative-zero.json",
        )) {
            val encoded = doc(name).encoded
            assertFails("malformed view-location payload must be rejected: $name") {
                NativeViewLocations.decode(encoded, maxCharacters)
            }
        }
    }
}
