package ai.deepseek.dsh.link

import java.net.Socket
import java.security.SecureRandom
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509ExtendedTrustManager

/**
 * SPKI pinning over one presented leaf certificate, mirroring the Swift
 * `LinkPinning` check: the fingerprint is lowercase hex SHA-256 of the
 * leaf's SubjectPublicKeyInfo DER, compared exactly against the fingerprint
 * the pairing payload carried. The JDK exposes every key's SPKI through
 * `publicKey.encoded` directly, so no per-curve framing lives here. The
 * client installs the trust manager and verifier below on its owned OkHttp
 * transport before creating calls, so a mismatch rejects the handshake
 * before request bytes leave the device.
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

    /** Trust manager whose only server-trust rule is the pairing SPKI pin. */
    internal fun trustManager(pinnedFingerprint: String): X509ExtendedTrustManager =
        PinnedTrustManager(pinnedFingerprint)

    /** TLS context backed by the exact trust manager installed on the HTTP client. */
    internal fun sslContext(trustManager: X509ExtendedTrustManager): SSLContext =
        SSLContext.getInstance("TLS").apply {
            init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
        }

    /** Hostname verifier that repeats the SPKI check. The generated Host
     * certificate intentionally has no DNS identity; the QR-authenticated
     * pin, not a public CA hostname, identifies it. */
    internal fun hostnameVerifier(pinnedFingerprint: String): HostnameVerifier = HostnameVerifier { _, session ->
        val certificate = runCatching { session.peerCertificates.firstOrNull() as? X509Certificate }.getOrNull()
        certificate != null && runCatching { check(certificate, pinnedFingerprint) }.isSuccess
    }

    private class PinnedTrustManager(private val pinnedFingerprint: String) : X509ExtendedTrustManager() {
        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) = verify(chain)

        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String, socket: Socket) =
            verify(chain)

        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String, engine: SSLEngine) =
            verify(chain)

        override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) = rejectClientTrust()

        override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String, socket: Socket) =
            rejectClientTrust()

        override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String, engine: SSLEngine) =
            rejectClientTrust()

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

        private fun verify(chain: Array<out X509Certificate>) {
            val leaf = chain.firstOrNull() ?: throw CertificateException("Link peer sent no certificate")
            try {
                check(leaf, pinnedFingerprint)
            } catch (failure: PinFailure.FingerprintMismatch) {
                throw CertificateException("Link SPKI fingerprint mismatch", failure)
            }
        }

        private fun rejectClientTrust(): Nothing =
            throw CertificateException("Link client does not accept client-certificate authentication")
    }
}
