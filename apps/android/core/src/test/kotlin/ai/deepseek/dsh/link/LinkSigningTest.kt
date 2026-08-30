package ai.deepseek.dsh.link

import java.security.KeyPairGenerator
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The signing vocabulary: canonical input, SHA-256 hex, Ed25519
 * sign/verify over the JDK provider, and the SPKI framing. */
class LinkSigningTest {
    @Test
    fun signingInputIsTheCanonicalFourLines() {
        assertEquals(
            "1759000000000\nPOST\n/api/session/list\n" + LinkSigning.sha256Hex("{}".toByteArray()),
            LinkSigning.signingInput("1759000000000", "POST", "/api/session/list", LinkSigning.sha256Hex("{}".toByteArray())),
        )
    }

    @Test
    fun sha256HexMatchesTheKnownVector() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            LinkSigning.sha256Hex("abc".toByteArray()),
        )
    }

    @Test
    fun ed25519SignsAndVerifiesThroughTheJdkProvider() {
        val keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val publicRaw = keyPair.public.encoded.copyOfRange(keyPair.public.encoded.size - 32, keyPair.public.encoded.size)
        val privateRaw = keyPair.private.encoded.copyOfRange(keyPair.private.encoded.size - 32, keyPair.private.encoded.size)

        val spki = LinkSigning.ed25519SpkiDer(publicRaw)
        assertEquals(44, spki.size)
        // The framed SPKI is byte-identical to the JDK's own encoding.
        assertTrue(spki.contentEquals(keyPair.public.encoded))
        assertEquals(LinkSigning.spkiFingerprint(spki), LinkSigning.spkiFingerprint(keyPair.public.encoded))

        val input = "1759000000000\nPOST\n/link/pair\n" + LinkSigning.sha256Hex(ByteArray(0))
        val signature = LinkSigning.sign(input, privateRaw)
        assertTrue(LinkSigning.verify(input, signature, spki))
        assertFalse(LinkSigning.verify("tampered", signature, spki))
    }
}
