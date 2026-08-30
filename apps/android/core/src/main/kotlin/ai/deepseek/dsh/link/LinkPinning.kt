package ai.deepseek.dsh.link

import java.security.MessageDigest
import java.security.cert.X509Certificate

/**
 * SPKI pinning over one presented leaf certificate, mirroring the Swift
 * `LinkPinning` check: the fingerprint is lowercase hex SHA-256 of the
 * leaf's SubjectPublicKeyInfo DER, compared exactly against the fingerprint
 * the pairing payload carried. The JDK exposes every key's SPKI through
 * `publicKey.encoded` directly, so no per-curve framing lives here. Wiring
 * this check into the TLS handshake rides the OkHttp layer of the future
 * app module; this object is the verification both that layer and tests
 * share.
 */
object LinkPinning {
    /** Lowercase hex SHA-256 of the leaf's SPKI DER. */
    fun spkiFingerprint(certificate: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded)
            .joinToString("") { "%02x".format(it) }

    /** Why a presented certificate failed the pinned fingerprint. */
    sealed class PinFailure : Exception() {
        class FingerprintMismatch(val presented: String, val pinned: String) : PinFailure()
    }

    /** Accept the certificate only when its leaf SPKI fingerprint is the
     * pinned one, byte-for-byte in hex form. */
    fun check(certificate: X509Certificate, pinnedFingerprint: String) {
        val presented = spkiFingerprint(certificate)
        if (presented != pinnedFingerprint) {
            throw PinFailure.FingerprintMismatch(presented = presented, pinned = pinnedFingerprint)
        }
    }
}
