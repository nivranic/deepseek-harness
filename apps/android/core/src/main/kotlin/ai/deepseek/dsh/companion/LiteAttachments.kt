package ai.deepseek.dsh.companion

import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * One retained Lite attachment's listing fact: the store key, the retained
 * media type, and the retained byte count. Pixel dimensions stay inside the
 * bytes — decoding an image is the attachment reader's job, not intake's.
 */
data class LiteAttachmentEntry(val name: String, val mediaType: String, val sizeBytes: Long)

/**
 * Retains Lite attachment bytes on this device. The paired face's channel
 * uploads picked documents over the wire and keeps nothing; an independent
 * Lite session has no wire to upload over, so the device keeps the bytes the
 * later attachment readers open.
 */
interface LiteAttachmentStoring {
    /**
     * Write one attachment's bytes and media type under its name, replacing
     * any prior entry stored under the same name.
     * @param name the attachment's store key — a file name, never a path.
     * @param data the complete content bytes.
     * @param mediaType the media type retained beside the bytes.
     */
    fun put(name: String, data: ByteArray, mediaType: String)

    /**
     * Read one attachment's bytes.
     * @param name the attachment's store key.
     * @return the stored bytes, or null when absent.
     */
    fun get(name: String): ByteArray?

    /**
     * List every stored attachment.
     * @return the entries sorted by name.
     * @throws IllegalStateException when a stored sidecar is corrupt — never a guessed media type.
     */
    fun list(): List<LiteAttachmentEntry>

    /**
     * Remove one attachment's bytes and sidecar.
     * @param name the attachment's store key to delete.
     */
    fun remove(name: String)
}

/**
 * File-backed Lite attachments under a directory: `<name>.attachment` bytes
 * with a `<name>.attachment.json` media-type sidecar, both written atomically
 * through the stores' shared rename helper (the [LiteFileArtifactStore]
 * layout plus the sidecar the artifact channel gets from its journal
 * references — attachment intake keeps no journal, so the media type lives
 * beside the bytes).
 */
class LiteFileAttachmentStore(directory: File) : LiteAttachmentStoring {
    private val directory: File = directory.apply { mkdirs() }

    private fun bytesFile(name: String) = File(directory, "$name.attachment")

    private fun sidecarFile(name: String) = File(directory, "$name.attachment.json")

    override fun put(name: String, data: ByteArray, mediaType: String) {
        writeAtomically(bytesFile(name), data)
        // The sidecar lands after the bytes: a crash between the two writes
        // leaves bytes no listing resolves, never a listed entry without
        // bytes.
        writeAtomically(
            sidecarFile(name),
            buildJsonObject { put("mediaType", mediaType) }.toString().encodeToByteArray(),
        )
    }

    override fun get(name: String): ByteArray? = bytesFile(name).takeIf { it.isFile }?.readBytes()

    override fun list(): List<LiteAttachmentEntry> =
        directory.listFiles { file -> file.isFile && file.name.endsWith(".json") }
            .orEmpty()
            .mapNotNull { sidecar ->
                val bytes = File(directory, sidecar.name.removeSuffix(".json"))
                // A sidecar whose bytes are gone names nothing; it reads as
                // absent the way a missing id does, not as a listed entry.
                if (!bytes.isFile) return@mapNotNull null
                LiteAttachmentEntry(
                    name = bytes.name.removeSuffix(".attachment"),
                    mediaType = sidecarMediaType(sidecar),
                    sizeBytes = bytes.length(),
                )
            }
            .sortedBy { it.name }

    override fun remove(name: String) {
        sidecarFile(name).delete()
        bytesFile(name).delete()
    }

    /** Parse one sidecar's media type; a corrupt document fails loud (the config store's corrupt-read form). */
    private fun sidecarMediaType(sidecar: File): String {
        val root = runCatching { Json.parseToJsonElement(sidecar.readText()) as? JsonObject }.getOrNull()
            ?: error("corrupt Lite attachment sidecar in ${sidecar.name}")
        return (root["mediaType"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: error("corrupt Lite attachment sidecar in ${sidecar.name}")
    }
}

/**
 * The typed intake step between one picked document and the retained store:
 * the bounded read already happened, so intake derives the store key,
 * defaults the media type, enforces the content cap, and writes through the
 * store — returning one typed outcome for the UI to render. Intake is
 * store-and-UI state only: nothing it admits reaches the session journal,
 * the fold vocabulary, or a provider request; the request-face form for
 * admitted attachments is a later generation's decision.
 */
object LiteAttachmentIntake {
    /**
     * The retained-content cap, in bytes: 8 MiB admits a modern phone photo
     * (typically 2–6 MiB JPEG) whole while one retained read stays a bounded
     * allocation. Independent of the 256 KiB artifact and url_fetch caps —
     * those bound model-turn content, and intake bytes never ride a model
     * request.
     */
    const val CONTENT_LIMIT_BYTES: Int = 8 * 1024 * 1024

    /** The media type retained when the provider states none. */
    const val UNSTATED_MEDIA_TYPE: String = "application/octet-stream"

    /** One intake outcome: the stored entry, or the category of refusal. */
    sealed interface Outcome {
        /** The entry as retained, with the derived store key. */
        data class Stored(val entry: LiteAttachmentEntry) : Outcome

        /** The refusal categories the UI renders as their own lines. */
        enum class Failure : Outcome { TOO_LARGE, STORE_FAILED }
    }

    /**
     * Derive the store key from a provider display name: the final path
     * segment, trimmed — a display name may carry provider paths, a store
     * key never does.
     * @param displayName the provider-stated display name, or null.
     * @return the usable segment, or null when the name states nothing usable.
     */
    fun storeName(displayName: String?): String? {
        if (displayName == null) return null
        val segment = displayName.substringAfterLast('/').substringAfterLast('\\').trim()
        return segment.ifEmpty { null }
    }

    /**
     * Admit one read document into the store: bytes within
     * [CONTENT_LIMIT_BYTES] land under the derived key — a generated key when
     * the provider states no usable name — with the stated media type or the
     * unstated default.
     * @param store the retention channel the bytes land in.
     * @param displayName the provider-stated display name, or null.
     * @param bytes the complete read bytes; one byte over the cap is the
     * caller's bounded-read proof of oversize.
     * @param mediaType the provider-stated media type, or null when unstated.
     * @return the stored entry, or the refusal category.
     */
    fun intake(store: LiteAttachmentStoring, displayName: String?, bytes: ByteArray, mediaType: String?): Outcome {
        if (bytes.size > CONTENT_LIMIT_BYTES) return Outcome.Failure.TOO_LARGE
        val name = storeName(displayName) ?: "attachment-${UUID.randomUUID().toString().take(8)}"
        val type = mediaType?.trim()?.takeIf { it.isNotEmpty() } ?: UNSTATED_MEDIA_TYPE
        return try {
            store.put(name, bytes, type)
            Outcome.Stored(LiteAttachmentEntry(name = name, mediaType = type, sizeBytes = bytes.size.toLong()))
        } catch (write: IOException) {
            // The store's file write refused the bytes — a full disk or an
            // unwritable directory; the read succeeded, only retention failed.
            Outcome.Failure.STORE_FAILED
        }
    }
}
