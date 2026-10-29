package ai.deepseek.dsh.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.io.File
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

/** Write bytes through a same-directory temp file and an atomic rename,
 * falling back to a plain replace where the platform refuses atomic moves. */
private fun writeAtomically(target: File, bytes: ByteArray) {
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
