package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeGatewayProtocol
import ai.deepseek.dsh.gateway.NativePairing
import ai.deepseek.dsh.gateway.nativeOrigin
import ai.deepseek.dsh.link.CredentialsCipher
import ai.deepseek.dsh.link.LinkCredentials
import java.io.File
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.json.*

/** A saved Host key excludes the replaceable device grant and network address. */
@JvmInline
value class NativeHostKey(val value: String)

/** Public selection metadata contains no signing key or pairing secret. */
data class SavedNativeHost(
    val key: NativeHostKey,
    val hostId: String,
    val name: String,
    val fingerprint: String,
    val endpoint: String,
    val role: String,
)

/** One atomically selected set of trusted identities; an empty catalog has no selection. */
data class NativeHostCatalog(val hosts: List<LinkCredentials> = emptyList(), val active: NativeHostKey? = null) {
    fun selected(): LinkCredentials? = active?.let { key -> hosts.single { nativeHostKey(it) == key } }

    fun remember(credentials: LinkCredentials): NativeHostCatalog {
        val key = nativeHostKey(credentials)
        return NativeHostCatalog(hosts.filterNot { nativeHostKey(it) == key } + credentials, key)
    }

    fun summaries(): List<SavedNativeHost> = hosts.map {
        SavedNativeHost(nativeHostKey(it), it.hostId, it.hostName, it.pinnedFingerprint, it.endpoint, it.role)
    }
}

/** Hash the verified Host identity, independently of its current device grant. */
fun nativeHostKey(credentials: LinkCredentials): NativeHostKey {
    val identity = buildJsonArray { add(credentials.hostId); add(credentials.pinnedFingerprint) }
    return NativeHostKey(MessageDigest.getInstance("SHA-256").digest(identity.toString().toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) })
}

/** A missing catalog and an unreadable catalog have different recovery semantics. */
interface NativeHostStoring {
    fun load(): NativeHostCatalog?
    fun save(catalog: NativeHostCatalog)
    fun preserveAndStartFresh()
}

/** Bounded, whole-document encryption with mandatory same-directory atomic replacement. */
class FileNativeHostStore(private val file: File, private val cipher: CredentialsCipher, private val maxBytes: Int) : NativeHostStoring {
    init { require(maxBytes > 0 && maxBytes < Int.MAX_VALUE) }

    override fun load(): NativeHostCatalog? {
        val input = try { Files.newInputStream(file.toPath()) }
        catch (_: NoSuchFileException) { return null }
        val encrypted = input.use { it.readNBytes(maxBytes + 1) }
        require(encrypted.size <= maxBytes) { "Host catalog exceeds its byte limit" }
        val plain = cipher.open(encrypted)
        require(plain.size <= maxBytes) { "decoded Host catalog exceeds its byte limit" }
        return decode(plain)
    }

    override fun save(catalog: NativeHostCatalog) {
        val plain = encode(catalog).toString().toByteArray(Charsets.UTF_8)
        require(plain.size <= maxBytes) { "Host catalog exceeds its byte limit" }
        decode(plain)
        val encrypted = cipher.seal(plain)
        require(encrypted.size <= maxBytes) { "encrypted Host catalog exceeds its byte limit" }
        val target = file.toPath().toAbsolutePath()
        Files.createDirectories(target.parent)
        val temporary = Files.createTempFile(target.parent, file.name + "-", ".tmp")
        AutoCloseable { Files.deleteIfExists(temporary) }.use {
            Files.write(temporary, encrypted)
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        }
    }

    override fun preserveAndStartFresh() {
        try {
            Files.copy(file.toPath(), File(file.parentFile, "${file.name}.unavailable-${UUID.randomUUID()}").toPath())
        } catch (_: NoSuchFileException) {
            // A deleted catalog has no bytes to preserve; permission and other read failures still reject recovery.
        }
        save(NativeHostCatalog())
    }

    private fun encode(catalog: NativeHostCatalog) = buildJsonObject {
        put("version", 1)
        put("active", catalog.active?.value?.let(::JsonPrimitive) ?: JsonNull)
        put("hosts", JsonArray(catalog.hosts.map { credentials -> buildJsonObject {
            put("hostId", credentials.hostId); put("hostName", credentials.hostName)
            put("deviceId", credentials.deviceId); put("role", credentials.role)
            put("endpoint", credentials.endpoint); put("pinnedFingerprint", credentials.pinnedFingerprint)
            put("signingKeyBase64", credentials.signingKeyBase64)
            put("transportFormat", credentials.transportFormat?.let(::JsonPrimitive) ?: JsonNull)
        } }))
    }

    private fun decode(bytes: ByteArray): NativeHostCatalog {
        val root = Json.parseToJsonElement(bytes.decodeToString(throwOnInvalidSequence = true)).fields("version", "active", "hosts")
        val version = root.getValue("version") as? JsonPrimitive
        require(version != null && !version.isString && version.intOrNull == 1) { "unsupported Host catalog version" }
        val hosts = (root.getValue("hosts") as? JsonArray ?: error("Host catalog array required")).map { element ->
            val row = element.fields("hostId", "hostName", "deviceId", "role", "endpoint", "pinnedFingerprint", "signingKeyBase64", "transportFormat")
            val credentials = LinkCredentials(row.text("deviceId"), row.text("hostId"), row.text("hostName"),
                row.text("role"), nativeOrigin(row.text("endpoint")), row.text("pinnedFingerprint"),
                row.text("signingKeyBase64"), row.text("transportFormat"))
            require(credentials.transportFormat == NativeGatewayProtocol.credentialFormat &&
                credentials.role in NativePairing.roles && credentials.signingKeyRaw?.size == 32 &&
                Regex("[a-f0-9]{64}").matches(credentials.pinnedFingerprint)) { "invalid native Host identity" }
            credentials
        }
        val keys = hosts.map(::nativeHostKey)
        require(keys.distinct().size == keys.size) { "duplicate saved Host" }
        val active = root.getValue("active").takeUnless { it == JsonNull }?.let { value ->
            val id = value as? JsonPrimitive ?: error("active Host key required")
            require(id.isString) { "active Host key must be a string" }
            NativeHostKey(id.content)
        }
        require(if (hosts.isEmpty()) active == null else active in keys) { "active Host does not name a saved identity" }
        return NativeHostCatalog(hosts, active)
    }

    private fun JsonElement.fields(vararg keys: String): JsonObject {
        val value = this as? JsonObject ?: error("Host catalog object required")
        require(value.keys == keys.toSet()) { "unexpected Host catalog fields" }
        return value
    }

    private fun JsonObject.text(key: String): String {
        val value = getValue(key) as? JsonPrimitive ?: error("Host catalog string required")
        require(value.isString && value.content.isNotBlank()) { "invalid Host catalog string" }
        return value.content
    }
}
