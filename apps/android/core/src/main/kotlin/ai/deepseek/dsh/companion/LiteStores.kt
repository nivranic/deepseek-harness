package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.CredentialsCipher
import ai.deepseek.dsh.link.PlainCredentialsCipher
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.net.URI
import java.net.URISyntaxException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Durable Lite session identity: its stable id plus the event journal that
 * is the session — replaying the events through the fold reproduces the
 * whole state.
 */
class LiteSession(val id: String, events: List<JsonObject> = emptyList()) {
    private val journal = events.toMutableList()

    /** The recorded events, in journal order. */
    val events: List<JsonObject> get() = journal.toList()

    /** Append one event to the journal. */
    fun record(event: JsonObject) {
        journal.add(event)
    }

    /** Replay the journal through the Behavior-Spec fold. */
    val state: LiteDomainState
        get() {
            val fold = LiteFold()
            for (event in events) fold.apply(event)
            return fold.state
        }
}

/**
 * Persists Lite session journals — one append-only JSON-lines file per
 * session, one encoded event per line (plan chapter 11's journal shape).
 */
interface LiteSessionStoring {
    /**
     * Persist the session's complete journal, replacing any prior one.
     * @param session the session whose events become durable.
     */
    fun save(session: LiteSession)

    /**
     * Load one session's journal.
     * @param id the session identity.
     * @return the replayable session, or null when none is stored.
     */
    fun load(id: String): LiteSession?

    /**
     * Quarantine one session's unreadable journal: the stored bytes move to an
     * `unavailable` sibling name — never deleted or replaced — and later loads
     * read the session as absent. The documented recovery is a cold open that
     * neither crashes nor silently drops the bytes; direct [load] callers keep
     * the fail-loud throw, so this is the assembly path's degradation, not a
     * second read semantic.
     * @param id the session identity whose journal is retired.
     * @return the quarantined file name, or null when nothing is stored under the id.
     */
    fun quarantine(id: String): String?

    /**
     * Remove one session's journal.
     * @param id the session identity to delete.
     */
    fun delete(id: String)
}

/** File-backed session journals under a directory, `<id>.litejournal`. */
class LiteFileSessionStore(directory: File) : LiteSessionStoring {
    private val directory: File = directory.apply { mkdirs() }

    private fun file(id: String) = File(directory, "$id.litejournal")

    override fun save(session: LiteSession) {
        val text = session.events.joinToString("\n") { it.toString() } + "\n"
        writeAtomically(file(session.id), text.encodeToByteArray())
    }

    override fun load(id: String): LiteSession? {
        val file = file(id)
        if (!file.exists()) return null
        val session = LiteSession(id)
        for (line in file.readText().split('\n')) {
            if (line.isBlank()) continue
            val event = runCatching { Json.parseToJsonElement(line) as? JsonObject }.getOrNull()
                ?: error("corrupt journal line in ${file.name}")
            session.record(event)
        }
        return session
    }

    override fun delete(id: String) {
        file(id).delete()
    }

    override fun quarantine(id: String): String? {
        val source = file(id)
        if (!source.exists()) return null
        // A same-directory rename of a file that just failed to parse: the
        // bytes survive beside the journal under a name later loads never
        // resolve, and the next save writes a fresh `<id>.litejournal`.
        val quarantined = File(
            directory,
            "${source.name}.unavailable-${java.util.UUID.randomUUID().toString().take(8)}",
        )
        Files.move(source.toPath(), quarantined.toPath())
        return quarantined.name
    }
}

/**
 * Stores artifact content out-of-band (plan chapter 56): events carry only
 * references and status; bytes live in the resource channel.
 */
interface LiteArtifactStoring {
    /**
     * Write one artifact's bytes under its id.
     * @param id the artifact reference identity.
     * @param data the complete content bytes.
     */
    fun put(id: String, data: ByteArray)

    /**
     * Read one artifact's bytes.
     * @param id the artifact reference identity.
     * @return the stored bytes, or null when absent.
     */
    fun get(id: String): ByteArray?

    /**
     * Remove one artifact's bytes.
     * @param id the artifact reference identity.
     */
    fun remove(id: String)
}

/** File-backed artifact content under a directory, `<id>.artifact`. */
class LiteFileArtifactStore(directory: File) : LiteArtifactStoring {
    private val directory: File = directory.apply { mkdirs() }

    private fun file(id: String) = File(directory, "$id.artifact")

    override fun put(id: String, data: ByteArray) {
        writeAtomically(file(id), data)
    }

    override fun get(id: String): ByteArray? {
        val file = file(id)
        return if (file.exists()) file.readBytes() else null
    }

    override fun remove(id: String) {
        file(id).delete()
    }
}

/** The persisted Lite provider configuration one assembled session reads at launch. */
data class LiteConfig(
    val endpoint: String,
    val apiKey: String,
    val model: String,
    /** The requested preset id (§33): null means the bundled catalog's default — the projection resolves it at assembly. */
    val presetId: String? = null,
)

/** Where the Lite provider configuration lives. */
interface LiteConfigStoring {
    /**
     * Load the persisted configuration.
     * @return the stored configuration, or null before the first save.
     * @throws IllegalStateException when the stored file is malformed or undecryptable — never a silent null.
     */
    fun load(): LiteConfig?

    /**
     * Persist the configuration, atomically replacing any prior one.
     * @param config the validated configuration.
     */
    fun save(config: LiteConfig)
}

/** One encrypted JSON config file — the app passes its files directory and
 * the Keystore cipher, JVM tests the plain one. The whole file is sealed
 * (the FileNativeHostStore form); an absent file is an unconfigured Lite
 * face, while a malformed or undecryptable one fails loud. */
class LiteFileConfigStore(
    private val file: File,
    private val cipher: CredentialsCipher = PlainCredentialsCipher,
) : LiteConfigStoring {
    override fun load(): LiteConfig? {
        if (!file.isFile) return null
        val plain = cipher.open(file.readBytes())
        val root = runCatching { Json.parseToJsonElement(plain.decodeToString()) as? JsonObject }.getOrNull()
            ?: error("corrupt Lite config in ${file.name}")
        return LiteConfig(
            endpoint = root.configField("endpoint", file.name),
            apiKey = root.configField("apiKey", file.name),
            model = root.configField("model", file.name),
            presetId = root.optionalConfigField("presetId", file.name),
        )
    }

    override fun save(config: LiteConfig) {
        val text = buildJsonObject {
            put("endpoint", config.endpoint)
            put("apiKey", config.apiKey)
            put("model", config.model)
            // A null selection omits the key — the projection's own optional-
            // field form — so a default-selection file stays the legacy
            // three-key document byte for byte.
            config.presetId?.let { put("presetId", it) }
        }.toString()
        file.parentFile?.mkdirs()
        writeAtomically(file, cipher.seal(text.encodeToByteArray()))
    }
}

private fun JsonObject.configField(name: String, fileName: String): String =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: error("corrupt Lite config in $fileName")

/** The optional preset id: an absent key and a JSON null both read as no
 * selection (the persona.suffix parsing form); any non-string value fails
 * loud like a required one. */
private fun JsonObject.optionalConfigField(name: String, fileName: String): String? = when (val raw = this[name]) {
    null, is JsonNull -> null
    is JsonPrimitive -> raw.takeIf { it.isString }?.content ?: error("corrupt Lite config in $fileName")
    else -> error("corrupt Lite config in $fileName")
}

/**
 * Validate a candidate endpoint before it is saved: HTTPS scheme, a
 * non-empty host, and no userinfo — the native pairing origin rule minus
 * its origin-only path restriction, so a full chat-completions URL stays
 * valid.
 * @param value the candidate endpoint exactly as entered.
 * @return the failure text for the form, or null when the endpoint is acceptable.
 */
fun validateLiteEndpoint(value: String): String? {
    val uri = try { URI(value.trim()) } catch (_: IllegalArgumentException) { null }
        catch (_: URISyntaxException) { null }
    if (uri == null || uri.scheme != "https" || uri.host.isNullOrEmpty() || uri.rawUserInfo != null) {
        return "端点必须是 https:// 开头、包含主机名且不带用户信息的完整地址"
    }
    return null
}

/** Write bytes through a same-directory temp file and an atomic rename,
 * falling back to a plain replace where the platform refuses atomic moves. */
internal fun writeAtomically(target: File, bytes: ByteArray) {
    val temp = File(target.parentFile, target.name + ".tmp")
    temp.writeBytes(bytes)
    try {
        Files.move(temp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)
    } catch (unsupported: AtomicMoveNotSupportedException) {
        // Nothing else can reach this catch: only the atomic flavor is
        // unsupported here, and the plain replace below is equivalent.
        Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
    }
}
