package ai.deepseek.dsh.companion

import java.io.File
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.StandardCopyOption
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Durable memory of file digests this device uploaded successfully; advisory, bounded, and per installation. */
interface NativeUploadDigestMemory {
    /** Digests remembered by earlier processes, oldest first; unreadable storage reads as empty. */
    fun load(): List<String>

    /** Persist one digest as most recent, dropping the oldest beyond capacity. */
    fun remember(digest: String)
}

/** A bounded plaintext JSON file; damage or absence reads as empty and never blocks an upload. */
class FileNativeUploadDigestMemory(private val file: File, private val capacity: Int = 256) : NativeUploadDigestMemory {
    init { require(capacity > 0) }

    private val lock = Any()

    override fun load(): List<String> = synchronized(lock) {
        val bytes = try { Files.readAllBytes(file.toPath()) } catch (_: NoSuchFileException) { return emptyList() }
        val root = try {
            Json.parseToJsonElement(bytes.decodeToString()) as? JsonObject ?: return emptyList()
        } catch (_: IllegalArgumentException) {
            // A damaged document is not upload evidence; an empty memory only costs a full re-upload.
            return emptyList()
        }
        val digests = root["digests"] as? JsonArray ?: return emptyList()
        digests.mapNotNull { item ->
            (item as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf(DIGEST_PATTERN::matches)
        }.distinct()
    }

    override fun remember(digest: String) = synchronized(lock) {
        require(DIGEST_PATTERN.matches(digest)) { "digest must be lowercase hex SHA-256" }
        val current = load().toMutableList()
        current.remove(digest)
        current.add(digest)
        val kept = current.takeLast(capacity)
        Files.createDirectories(file.parentFile.toPath())
        val document = buildJsonObject {
            put("version", 1)
            put("digests", JsonArray(kept.map(::JsonPrimitive)))
        }.toString()
        val temporary = Files.createTempFile(file.parentFile.toPath(), file.name + "-", ".tmp")
        try {
            Files.write(temporary, document.toByteArray(Charsets.UTF_8))
            Files.move(temporary, file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally {
            Files.deleteIfExists(temporary)
        }
        Unit
    }

    private companion object {
        val DIGEST_PATTERN = Regex("[a-f0-9]{64}")
    }
}
