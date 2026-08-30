package ai.deepseek.dsh.link

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
