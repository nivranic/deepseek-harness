package ai.deepseek.dsh.link

import kotlinx.serialization.json.put

import java.util.Base64

/**
 * The device identity one pairing established, persisted between runs —
 * the Kotlin mirror of the Swift `LinkCredentials`.
 */
data class LinkCredentials(
    val deviceId: String,
    val hostId: String,
    val hostName: String,
    val role: String,
    /** The carrier endpoint the pairing payload carried; rebuilding the
     * client after relaunch needs it alongside the identity. */
    val endpoint: String,
    /** The SPKI fingerprint TLS pins for this host. */
    val pinnedFingerprint: String,
    /** Base64 of the Ed25519 private key's 32 raw bytes. */
    val signingKeyBase64: String,
) {
    /** The raw private key bytes, or null when the stored form is not base64. */
    val signingKeyRaw: ByteArray?
        get() = runCatching { Base64.getDecoder().decode(signingKeyBase64) }.getOrNull()
}

/** Where the credentials live; the Android app module backs this with the
 * Keystore-backed store, previews and tests with the in-memory one. */
interface LinkCredentialsStoring {
    fun load(): LinkCredentials?

    fun save(credentials: LinkCredentials)

    fun clear()
}

/** One JSON file in a caller-owned directory; the app passes its files
 * directory. Writes replace atomically enough for a single identity. */
/** The at-rest boundary for the signing key: seal it before it hits disk
 * and open it on the way back. The app injects the AndroidKeyStore-backed
 * implementation; tests inject fakes; the plain one is the no-op. */
interface CredentialsCipher {
    fun seal(plain: ByteArray): ByteArray

    fun open(sealed: ByteArray): ByteArray
}

/** Identity cipher — in-memory previews and shape-only tests. */
object PlainCredentialsCipher : CredentialsCipher {
    override fun seal(plain: ByteArray): ByteArray = plain

    override fun open(sealed: ByteArray): ByteArray = sealed
}

/** One JSON file in a caller-owned directory; the app passes its files
 * directory. The signing key never lands on disk as stored — the cipher's
 * sealed form rides in its place. Writes replace atomically enough for a
 * single identity. */
class FileLinkCredentialsStore(
    private val file: java.io.File,
    private val cipher: CredentialsCipher = PlainCredentialsCipher,
) : LinkCredentialsStoring {
    override fun load(): LinkCredentials? = runCatching {
        if (!file.isFile) return null
        val atRest = LinkPayloadParsing.credentials(file.readText()) ?: return null
        val sealedKey = java.util.Base64.getDecoder().decode(atRest.signingKeyBase64)
        atRest.copy(signingKeyBase64 = java.util.Base64.getEncoder().encodeToString(cipher.open(sealedKey)))
    }.getOrNull()

    override fun save(credentials: LinkCredentials) {
        file.parentFile?.mkdirs()
        val sealed = java.util.Base64.getEncoder()
            .encodeToString(cipher.seal(java.util.Base64.getDecoder().decode(credentials.signingKeyBase64)))
        val text = credentials.copy(signingKeyBase64 = sealed).toJson()
        val temporary = java.io.File(file.parentFile, file.name + ".tmp")
        temporary.writeText(text, Charsets.UTF_8)
        if (!temporary.renameTo(file)) {
            file.writeText(text, Charsets.UTF_8)
            temporary.delete()
        }
    }

    override fun clear() {
        file.delete()
    }

    private fun LinkCredentials.toJson(): String {
        val json = kotlinx.serialization.json.Json
        val element = kotlinx.serialization.json.buildJsonObject {
            put("deviceId", deviceId)
            put("hostId", hostId)
            put("hostName", hostName)
            put("role", role)
            put("endpoint", endpoint)
            put("pinnedFingerprint", pinnedFingerprint)
            put("signingKeyBase64", signingKeyBase64)
        }
        return json.encodeToString(element)
    }
}

/** Process-lifetime storage; previews and tests. */
class MemoryLinkCredentialsStore : LinkCredentialsStoring {
    private val lock = Any()
    private var stored: LinkCredentials? = null

    override fun load(): LinkCredentials? = synchronized(lock) { stored }

    override fun save(credentials: LinkCredentials) {
        synchronized(lock) { stored = credentials }
    }

    override fun clear() {
        synchronized(lock) { stored = null }
    }
}
