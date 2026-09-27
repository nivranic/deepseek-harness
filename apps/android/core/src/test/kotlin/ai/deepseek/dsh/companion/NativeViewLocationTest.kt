package ai.deepseek.dsh.companion

import java.util.Base64
import kotlin.test.*

class NativeViewLocationTest {
    private fun payload(json: String) = "dsh-session-view.v1." + Base64.getUrlEncoder().withoutPadding()
        .encodeToString(json.toByteArray(Charsets.ISO_8859_1))

    @Test fun `encoding matches Web JSON field order and unpadded base64url`() {
        val location = NativeViewLocation("host", "session", 42)
        val encoded = "dsh-session-view.v1.eyJob3N0SWQiOiJob3N0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbiIsImFuY2hvclNlcSI6NDJ9"
        assertEquals(encoded, NativeViewLocations.encode(location))
        assertEquals(location, NativeViewLocations.decode(encoded, 4096))
        assertEquals(0L, NativeViewLocations.decode(payload("""{"hostId":"h","sessionId":"s","anchorSeq":0}"""), 4096).anchorSeq)
        assertEquals(1L, NativeViewLocations.decode(payload("""{"hostId":"h","sessionId":"s","anchorSeq":1e0}"""), 4096).anchorSeq)
    }

    @Test fun `malformed grammar and unsafe anchors are rejected before routing`() {
        val invalid = listOf("", "other.v1.e30", "dsh-session-view.v1.=", "dsh-session-view.v1.a", payload("not JSON"),
            payload("[]"), payload("""{"hostId":"h","sessionId":"s","anchorSeq":1,"extra":true}"""),
            payload("""{"hostId":"","sessionId":"s","anchorSeq":1}"""),
            payload("""{"hostId":"h","sessionId":null,"anchorSeq":1}""")) +
            listOf("-1", "-0", "-0.0", "1.5", "9007199254740992", "1e999", "null", "true", "\"1\"").map {
                payload("""{"hostId":"h","sessionId":"s","anchorSeq":$it}""")
            }
        for (encoded in invalid) assertFails { NativeViewLocations.decode(encoded, 4096) }
        assertFails { NativeViewLocations.decode(NativeViewLocations.encode(NativeViewLocation("h", "s", 0)), 10) }
        assertFails { NativeViewLocations.encode(NativeViewLocation("中文", "s", 0)) }
    }

    @Test fun `a payload cannot choose a different or missing trusted Host`() {
        val location = NativeViewLocation("host-a", "session", 0)
        NativeViewLocations.requireHost(location, "host-a")
        assertFails { NativeViewLocations.requireHost(location, "host-b") }
        assertFails { NativeViewLocations.requireHost(location, null) }
    }

    @Test fun `deep links preserve the existing Web payload and accept its JSON number grammar`() {
        val location = NativeViewLocation("host", "session", 42)
        val encoded = "dsh-session-view.v1.eyJob3N0SWQiOiJob3N0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbiIsImFuY2hvclNlcSI6NDJ9"
        val link = "dsh-companion://session-view/$encoded"
        assertEquals(link, NativeViewLocations.encodeDeepLink(location))
        assertEquals(location, NativeViewLocations.decodeDeepLink(link))
        assertEquals(location, NativeViewLocations.decode(link.removePrefix("dsh-companion://session-view/"), 4096))
        assertEquals(NativeViewLocation("h", "s", 1), NativeViewLocations.decodeDeepLink(
            "dsh-companion://session-view/" + payload("""{ "anchorSeq":1e0, "sessionId":"s", "hostId":"h" }""")))
    }

    @Test fun `deep links reject outer URI variations without trimming or normalization`() {
        val encoded = NativeViewLocations.encode(NativeViewLocation("host", "session", 42))
        val link = "dsh-companion://session-view/$encoded"
        val invalid = listOf(
            "", encoded, "dsh-companion://session-view/", "dsh-companion://session-view",
            "https://session-view/$encoded", "DSH-COMPANION://session-view/$encoded",
            "dsh-companion://SESSION-VIEW/$encoded", "dsh-companion:/session-view/$encoded",
            "dsh-companion:///session-view/$encoded", "dsh-companion://other/$encoded",
            "dsh-companion://session-view:443/$encoded", "dsh-companion://user@session-view/$encoded",
            "dsh-companion://session-view/extra/$encoded", "dsh-companion://session-view//$encoded",
            "$link/", "$link/extra", "$link?", "$link?host=other", "$link#", "$link#anchor",
            "$link%2F", link.replace("v1.", "v1%2E"), link.replace("session-view/", "session-view\\"),
            " $link", "$link ", "$link\n", "$link\u0000",
        )
        for (raw in invalid) assertFails("Accepted malformed deep link: $raw") { NativeViewLocations.decodeDeepLink(raw) }
    }

    @Test fun `deep links retain malformed payload and unsafe anchor rejection`() {
        val invalid = listOf("other.v1.e30", "dsh-session-view.v2.e30", "dsh-session-view.v1.=",
            "dsh-session-view.v1.a", payload("[]"), payload("not JSON"),
            payload("""{"hostId":"h","sessionId":"s","anchorSeq":0,"endpoint":"https://other"}"""),
            payload("""{"hostId":"","sessionId":"s","anchorSeq":0}""")) +
            listOf("-1", "-0", "1.5", "9007199254740992", "1e999", "\"1\"").map {
                payload("""{"hostId":"h","sessionId":"s","anchorSeq":$it}""")
            }
        for (encoded in invalid) assertFails { NativeViewLocations.decodeDeepLink("dsh-companion://session-view/$encoded") }
    }

    @Test fun `deep link encoding and decoding enforce the full payload and URI limits`() {
        val emptyHostJsonBytes = """{"hostId":"","sessionId":"s","anchorSeq":0}""".length
        val jsonBytesAtLimit = (4096 - "dsh-session-view.v1.".length) / 4 * 3
        val location = NativeViewLocation("h".repeat(jsonBytesAtLimit - emptyHostJsonBytes), "s", 0)
        val encoded = NativeViewLocations.encode(location)
        assertEquals(4096, encoded.length)
        val link = NativeViewLocations.encodeDeepLink(location)
        assertEquals(4125, link.length)
        assertEquals(location, NativeViewLocations.decodeDeepLink(link))
        assertFailsWith<IllegalArgumentException> { NativeViewLocations.decodeDeepLink(link + "A") }

        val oversized = location.copy(hostId = location.hostId + "h")
        val oversizedPayload = NativeViewLocations.encode(oversized)
        assertTrue(oversizedPayload.length > 4096)
        assertEquals(oversized, NativeViewLocations.decode(oversizedPayload, oversizedPayload.length))
        assertFailsWith<IllegalArgumentException> { NativeViewLocations.encodeDeepLink(oversized) }
        assertFailsWith<IllegalArgumentException> { NativeViewLocations.decodeDeepLink("dsh-companion://session-view/$oversizedPayload") }
    }
}
