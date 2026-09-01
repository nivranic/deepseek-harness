package ai.deepseek.dsh.link

import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.spec.XECPrivateKeySpec
import java.security.spec.XECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** The Noise protocol name this transport speaks, 32 bytes exactly. */
private const val PROTOCOL_NAME = "Noise_XX_25519_ChaChaPoly_SHA256"

/** X25519 key bytes and the AEAD tag length, both fixed by the suite. */
private const val KEY_BYTES = 32
private const val TAG_BYTES = 16

/**
 * Noise_XX_25519_ChaChaPoly_SHA256 over JDK-only primitives (chapters 68/69:
 * the relay's "Noise 或 TLS" transport encryption). HTTP is only the
 * courier: handshake messages ride request/response bodies, then every
 * relay body is one or more transport frames (u16 big-endian ciphertext
 * length prefix), AEAD-sealed with empty associated data and a 64-bit
 * little-endian counter nonce. Mirrors apps/relay/noise.mjs byte for byte;
 * the fixed-key vectors pin the agreement.
 */
class NoiseCipherState(key: ByteArray) {
    /** The raw traffic key; the fixed-key vectors read it back. */
    val keyBytes: ByteArray = key.copyOf()

    private val key: ByteArray = key.copyOf()
    private var counter: Long = 0

    /** AEAD seal at the current counter, then advance it. */
    fun encryptWithAd(ad: ByteArray, plaintext: ByteArray): ByteArray {
        val out = chachaSeal(this.key, counter, ad, plaintext)
        counter += 1
        return out
    }

    /** AEAD open at the current counter, then advance it; a bad tag throws. */
    fun decryptWithAd(ad: ByteArray, ciphertext: ByteArray): ByteArray {
        val out = chachaOpen(this.key, counter, ad, ciphertext)
        counter += 1
        return out
    }
}

/** The XX handshake for either role, mirroring the node reference state machine. */
class NoiseHandshake(
    private val role: Role,
    staticScalar: ByteArray? = null,
    ephemeralScalar: ByteArray? = null,
) {
    /** Which side of XX this state plays. */
    enum class Role { INITIATOR, RESPONDER }

    private val staticPair = x25519Pair(staticScalar)
    private val ephemeralPair = x25519Pair(ephemeralScalar)
    private var remoteStatic: ByteArray? = null
    private var remoteEphemeral: ByteArray? = null
    private var ck: ByteArray = PROTOCOL_NAME.toByteArray(Charsets.US_ASCII)
    private var h: ByteArray = ck.copyOf()
    private var key: ByteArray? = null
    private var counter: Long = 0

    /** The transcript hash right now — the HTTP session id after message 2. */
    val transcriptHash: ByteArray get() = h.copyOf()

    /** XX message 1 (initiator → responder): the ephemeral public key. */
    fun writeMessage1(): ByteArray {
        mixHash(ephemeralPair.publicRaw)
        return ephemeralPair.publicRaw + encryptAndHash(EMPTY)
    }

    /** Ingest XX message 1 (responder side). */
    fun readMessage1(message: ByteArray) {
        remoteEphemeral = message.copyOfRange(0, KEY_BYTES)
        mixHash(remoteEphemeral!!)
        decryptAndHash(message.copyOfRange(KEY_BYTES, message.size))
    }

    /** XX message 2 (responder → initiator): e, ee rekey, sealed s, es rekey. */
    fun writeMessage2(): ByteArray {
        mixHash(ephemeralPair.publicRaw)
        mixKey(x25519(ephemeralPair.privateKey, remoteEphemeral!!))
        val sealedStatic = encryptAndHash(staticPair.publicRaw)
        mixKey(x25519(staticPair.privateKey, remoteEphemeral!!))
        return ephemeralPair.publicRaw + sealedStatic + encryptAndHash(EMPTY)
    }

    /** Ingest XX message 2 (initiator side). */
    fun readMessage2(message: ByteArray) {
        var offset = 0
        remoteEphemeral = message.copyOfRange(offset, offset + KEY_BYTES)
        offset += KEY_BYTES
        mixHash(remoteEphemeral!!)
        mixKey(x25519(ephemeralPair.privateKey, remoteEphemeral!!))
        remoteStatic = decryptAndHash(message.copyOfRange(offset, offset + KEY_BYTES + TAG_BYTES))
        offset += KEY_BYTES + TAG_BYTES
        // XX's es token pairs the initiator's ephemeral with the responder's
        // static — the initiator reads DH(e, rs).
        mixKey(x25519(ephemeralPair.privateKey, remoteStatic!!))
        decryptAndHash(message.copyOfRange(offset, message.size))
    }

    /** XX message 3 (initiator → responder): sealed s, es rekey. */
    fun writeMessage3(): ByteArray {
        val sealedStatic = encryptAndHash(staticPair.publicRaw)
        mixKey(x25519(ephemeralPair.privateKey, remoteStatic!!))
        return sealedStatic + encryptAndHash(EMPTY)
    }

    /** Ingest XX message 3 (responder side). */
    fun readMessage3(message: ByteArray) {
        var offset = 0
        remoteStatic = decryptAndHash(message.copyOfRange(offset, offset + KEY_BYTES + TAG_BYTES))
        offset += KEY_BYTES + TAG_BYTES
        // The responder reads es as DH(s, re).
        mixKey(x25519(staticPair.privateKey, remoteEphemeral!!))
        decryptAndHash(message.copyOfRange(offset, message.size))
    }

    /**
     * Split into transport states; the first state carries initiator →
     * responder traffic.
     * @return send/recv oriented for this state's role.
     */
    fun split(): Pair<NoiseCipherState, NoiseCipherState> {
        val (k1, k2) = hkdf2(ck, EMPTY)
        val c1 = NoiseCipherState(k1)
        val c2 = NoiseCipherState(k2)
        return if (role == Role.INITIATOR) c1 to c2 else c2 to c1
    }

    private fun mixHash(data: ByteArray) {
        h = sha256(h + data)
    }

    private fun mixKey(ikm: ByteArray) {
        val (nextCk, tempKey) = hkdf2(ck, ikm)
        ck = nextCk
        key = tempKey
        counter = 0
    }

    private fun encryptAndHash(plaintext: ByteArray): ByteArray {
        val sealed = key?.let { chachaSeal(it, counter, h, plaintext) } ?: plaintext
        if (key != null) counter += 1
        mixHash(sealed)
        return sealed
    }

    private fun decryptAndHash(sealed: ByteArray): ByteArray {
        val plaintext = key?.let { chachaOpen(it, counter, h, sealed) } ?: sealed
        if (key != null) counter += 1
        mixHash(sealed)
        return plaintext
    }
}

/** Frame one ciphertext: u16 big-endian length, then the bytes. */
fun encodeNoiseFrame(ciphertext: ByteArray): ByteArray {
    require(ciphertext.size <= 0xffff) { "relay noise frame exceeds 65535 bytes" }
    return byteArrayOf((ciphertext.size shr 8).toByte(), ciphertext.size.toByte()) + ciphertext
}

/** Split a framed body into ciphertexts; a truncated tail throws. */
fun decodeNoiseFrames(body: ByteArray): List<ByteArray> {
    val frames = mutableListOf<ByteArray>()
    var offset = 0
    while (offset < body.size) {
        require(offset + 2 <= body.size) { "relay noise frame header truncated" }
        val length = ((body[offset].toInt() and 0xff) shl 8) or (body[offset + 1].toInt() and 0xff)
        offset += 2
        require(offset + length <= body.size) { "relay noise frame truncated" }
        frames.add(body.copyOfRange(offset, offset + length))
        offset += length
    }
    return frames
}

private val EMPTY = ByteArray(0)

/** One X25519 keypair, optionally pinned to a fixed raw scalar for vectors. */
private class X25519Pair(val privateKey: java.security.PrivateKey, val publicRaw: ByteArray)

private fun x25519Pair(rawScalar: ByteArray?): X25519Pair {
    val factory = KeyFactory.getInstance("XDH")
    val privateKey = if (rawScalar == null) {
        KeyPairGenerator.getInstance("X25519").generateKeyPair().let { pair ->
            return X25519Pair(pair.private, rawFromSpki(pair.public.encoded))
        }
    } else {
        factory.generatePrivate(
            XECPrivateKeySpec(java.security.spec.NamedParameterSpec.X25519, BigInteger(1, rawScalar.reversedArray())),
        )
    }
    return X25519Pair(privateKey, publicFromScalar(factory, privateKey))
}

/** The SPKI DER wrapper ends with the 32 raw X25519 public key bytes. */
private fun rawFromSpki(spki: ByteArray): ByteArray =
    spki.copyOfRange(spki.size - KEY_BYTES, spki.size)

/**
 * The public key one private scalar owns: X25519's base point is u=9, and
 * scalarmult_base(s) equals DH(s, 9), so a KeyAgreement against the
 * importable base point yields the raw public key — the JDK offers no
 * direct derivation entry point.
 */
private fun publicFromScalar(factory: KeyFactory, privateKey: java.security.PrivateKey): ByteArray {
    val basePoint = factory.generatePublic(
        XECPublicKeySpec(java.security.spec.NamedParameterSpec.X25519, BigInteger.valueOf(9)),
    )
    val agreement = KeyAgreement.getInstance("XDH").apply {
        init(privateKey)
        doPhase(basePoint, true)
    }
    return agreement.generateSecret()
}

/** The X25519 shared secret between one private key and one raw peer public key. */
private fun x25519(privateKey: java.security.PrivateKey, peerRaw: ByteArray): ByteArray {
    // The JDK XDH spec reads the u coordinate's BigInteger in little-endian
    // byte order, so the raw little-endian bytes reverse into it.
    val peer = KeyFactory.getInstance("XDH").generatePublic(
        XECPublicKeySpec(java.security.spec.NamedParameterSpec.X25519, BigInteger(1, peerRaw.reversedArray())),
    )
    val agreement = KeyAgreement.getInstance("XDH").apply {
        init(privateKey)
        doPhase(peer, true)
    }
    return agreement.generateSecret()
}

private fun sha256(data: ByteArray): ByteArray =
    java.security.MessageDigest.getInstance("SHA-256").digest(data)

private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
    Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data)

/** Noise §4.3 HKDF with two outputs: temp = HMAC(ck, ikm); o1 = HMAC(temp, 1); o2 = HMAC(temp, o1||2). */
private fun hkdf2(chainingKey: ByteArray, ikm: ByteArray): Pair<ByteArray, ByteArray> {
    val temp = hmac(chainingKey, ikm)
    val one = hmac(temp, byteArrayOf(1))
    val two = hmac(temp, one + byteArrayOf(2))
    return one to two
}

/** The 12-byte Noise ChaChaPoly nonce: 4 zero bytes then the counter little-endian. */
private fun noiseNonce(counter: Long): ByteArray =
    byteArrayOf(0, 0, 0, 0) + byteArrayOf(
        (counter and 0xff).toByte(),
        ((counter shr 8) and 0xff).toByte(),
        ((counter shr 16) and 0xff).toByte(),
        ((counter shr 24) and 0xff).toByte(),
        ((counter shr 32) and 0xff).toByte(),
        ((counter shr 40) and 0xff).toByte(),
        ((counter shr 48) and 0xff).toByte(),
        ((counter shr 56) and 0xff).toByte(),
    )

/** ChaCha20-Poly1305 seal; the output is ciphertext || tag. */
private fun chachaSeal(key: ByteArray, counter: Long, ad: ByteArray, plaintext: ByteArray): ByteArray =
    Cipher.getInstance("ChaCha20-Poly1305/None/NoPadding").run {
        init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "ChaCha20"), IvParameterSpec(noiseNonce(counter)))
        updateAAD(ad)
        doFinal(plaintext)
    }

/** ChaCha20-Poly1305 open over ciphertext || tag; a bad tag throws. */
private fun chachaOpen(key: ByteArray, counter: Long, ad: ByteArray, ciphertext: ByteArray): ByteArray =
    Cipher.getInstance("ChaCha20-Poly1305/None/NoPadding").run {
        init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "ChaCha20"), IvParameterSpec(noiseNonce(counter)))
        updateAAD(ad)
        doFinal(ciphertext)
    }
