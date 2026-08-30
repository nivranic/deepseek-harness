package ai.deepseek.dsh.link

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * The carrier's request-signature vocabulary, mirroring the Swift
 * `LinkSigning` and the TypeScript reference client byte-for-byte: the
 * canonical signing input, the three credential headers, and the SPKI
 * framing the fingerprint pins. Ed25519 rides the JDK's built-in provider —
 * no external crypto dependency.
 */
object LinkSigning {
    const val deviceIdHeader = "x-dsh-device-id"
    const val timestampHeader = "x-dsh-timestamp"
    const val signatureHeader = "x-dsh-signature"

    /** The fixed 12-byte SubjectPublicKeyInfo header before one raw Ed25519
     * public key, forming the 44-byte SPKI DER the host stores. */
    private val ED25519_SPKI_HEADER = byteArrayOf(
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    )

    /** The PKCS#8 DER header before one raw Ed25519 private key, forming the
     * 48-byte encoding the JDK's Ed25519 factory accepts. */
    private val ED25519_PKCS8_HEADER = byteArrayOf(
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    )

    /** The canonical input the host verifies:
     * `timestamp\nmethod\npath\nsha256hex(body)`. */
    fun signingInput(timestamp: String, method: String, path: String, bodySha256Hex: String): String =
        "$timestamp\n$method\n$path\n$bodySha256Hex"

    /** Lowercase hex SHA-256 of the exact request body bytes. */
    fun sha256Hex(body: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(body).joinToString("") { "%02x".format(it) }

    /** Base64 Ed25519 signature over the canonical input, UTF-8 encoded. */
    fun sign(input: String, privateKeyRaw: ByteArray): String {
        val factory = KeyFactory.getInstance("Ed25519")
        val pkcs8 = ED25519_PKCS8_HEADER + privateKeyRaw
        val key = factory.generatePrivate(PKCS8EncodedKeySpec(pkcs8))
        val signature = Signature.getInstance("Ed25519")
        signature.initSign(key)
        signature.update(input.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(signature.sign())
    }

    /** Verify one signature against the SPKI DER public key — the shape the
     * host applies; tests re-derive the captured header with it. */
    fun verify(input: String, signatureBase64: String, spkiDer: ByteArray): Boolean {
        val factory = KeyFactory.getInstance("Ed25519")
        val key = factory.generatePublic(X509EncodedKeySpec(spkiDer))
        val signature = Signature.getInstance("Ed25519")
        signature.initVerify(key)
        signature.update(input.toByteArray(Charsets.UTF_8))
        return signature.verify(Base64.getDecoder().decode(signatureBase64))
    }

    /** The 44-byte SPKI DER wrapping one Ed25519 public key. */
    fun ed25519SpkiDer(publicKeyRaw: ByteArray): ByteArray = ED25519_SPKI_HEADER + publicKeyRaw

    /** Lowercase hex SHA-256 of a DER structure — the fingerprint form the
     * pairing payload and the host description carry. */
    fun spkiFingerprint(spkiDer: ByteArray): String = sha256Hex(spkiDer)
}
