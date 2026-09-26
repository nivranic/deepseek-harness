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
}
