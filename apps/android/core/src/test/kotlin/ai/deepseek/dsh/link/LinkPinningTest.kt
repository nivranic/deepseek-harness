package ai.deepseek.dsh.link

import java.io.ByteArrayInputStream
import java.security.cert.CertificateFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** SPKI pinning over a real certificate: the leaf fingerprint is SHA-256 of
 * the public key's SubjectPublicKeyInfo DER, exactly compared. */
class LinkPinningTest {
    private fun fixtureCertificate(): java.security.cert.X509Certificate {
        val der = javaClass.getResourceAsStream("/certificates/pin-fixture.der")!!.readBytes()
        return CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as java.security.cert.X509Certificate
    }

    @Test
    fun fingerprintIsSha256OfTheLeafSpkiDer() {
        val certificate = fixtureCertificate()
        assertEquals(
            LinkSigning.sha256Hex(certificate.publicKey.encoded),
            LinkPinning.spkiFingerprint(certificate),
        )
    }

    @Test
    fun checkAcceptsThePinnedFingerprintAndRejectsAnyOther() {
        val certificate = fixtureCertificate()
        val pinned = LinkPinning.spkiFingerprint(certificate)
        LinkPinning.check(certificate, pinned)

        val other = "ab".repeat(32)
        val failure = assertFailsWith<LinkPinning.PinFailure.FingerprintMismatch> { LinkPinning.check(certificate, other) }
        assertEquals(pinned, failure.pinned)
        assertEquals(other, failure.presented)
    }
}
