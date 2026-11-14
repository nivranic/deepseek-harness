package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.CredentialsCipher
import ai.deepseek.dsh.link.WireValue
import java.io.File
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.StandardCopyOption
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.json.*

/** The persisted follow window for one principal's current Session. The records are a
 * Host-reconstructible cache, never user input: a cold open without them is always lawful. */
data class NativeJournalWindow(
    val sessionId: String,
    val address: WireValue.ObjectValue,
    val cut: Long,
    val hasMore: Boolean,
    val records: List<WireValue>,
)

/** Durable storage for the §25 persisted window. */
interface NativeJournalStoring {
    /** A structurally invalid or foreign document is quarantined beside its file and reads as
     * absent — the documented recovery is a cold open, because every record refetches from the Host. */
    fun load(): NativeJournalWindow?
    /** Atomic replacement. Records beyond the byte bound drop from the OLDEST side with
     * `hasMore` forced true; the cut and newest record never drop. */
    fun save(window: NativeJournalWindow)
}

/** An encrypted, bounded v1 document per principal, laid out like [FileCompanionInputStore]:
 * one `<principal-sha256>.journal` file, exact field sets, atomic same-directory move,
 * unreadable bytes quarantined rather than replaced. */
class FileNativeJournalStore(
    directory: File,
    private val principal: CompanionInputPrincipal,
    private val cipher: CredentialsCipher,
    private val maxBytes: Int,
) : NativeJournalStoring {
    init { require(maxBytes > 0 && maxBytes < Int.MAX_VALUE) }
    private val principalJson = buildJsonObject {
        put("hostId", principal.hostId); put("fingerprint", principal.fingerprint); put("deviceId", principal.deviceId)
    }
    private val name = MessageDigest.getInstance("SHA-256").digest(principalJson.toString().toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) }
    private val file = File(directory, "$name.journal")

    override fun load(): NativeJournalWindow? {
        val encrypted = try { Files.newInputStream(file.toPath()).use { it.readNBytes(maxBytes + 1) } }
        catch (_: NoSuchFileException) { return null }
        require(encrypted.size <= maxBytes) { "journal window exceeds its byte limit" }
        return try {
            decode(cipher.open(encrypted))
        } catch (_: IllegalArgumentException) {
            // The window is a cache: unreadable bytes (malformed document or failed
            // cipher authentication) quarantine to a cold open, never a crash.
            quarantine()
        } catch (_: IllegalStateException) {
            quarantine()
        } catch (_: GeneralSecurityException) {
            quarantine()
        }
    }

    private fun quarantine(): NativeJournalWindow? {
        Files.createDirectories(file.parentFile.toPath())
        Files.copy(file.toPath(), File(file.parentFile, "${file.name}.unavailable-${UUID.randomUUID()}").toPath())
        return null
    }

    override fun save(window: NativeJournalWindow) {
        val plain = encode(trimToBound(window))
        val encrypted = cipher.seal(plain)
        require(encrypted.size <= maxBytes) { "journal window exceeds its byte limit" }
        decode(plain)
        val target = file.toPath().toAbsolutePath()
        Files.createDirectories(target.parent)
        val temporary = Files.createTempFile(target.parent, file.name + "-", ".tmp")
        AutoCloseable { Files.deleteIfExists(temporary) }.use {
            Files.write(temporary, encrypted)
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        }
    }

    /** Keep the newest records within the byte bound; the cut and last seq survive every trim. */
    private fun trimToBound(window: NativeJournalWindow): NativeJournalWindow {
        var records = window.records
        var hasMore = window.hasMore
        while (serialized(window.sessionId, window.address, window.cut, hasMore, records).toByteArray(Charsets.UTF_8).size > maxBytes) {
            require(records.isNotEmpty()) { "a single journal record exceeds the persisted byte bound" }
            records = records.drop(1)
            hasMore = true
        }
        return NativeJournalWindow(window.sessionId, window.address, window.cut, hasMore, records)
    }

    private fun serialized(sessionId: String, address: WireValue.ObjectValue, cut: Long, hasMore: Boolean, records: List<WireValue>) =
        buildJsonObject {
            put("version", 1)
            put("principal", principalJson)
            put("sessionId", sessionId)
            put("address", address.toJsonElement())
            put("cut", cut)
            put("hasMore", hasMore)
            put("records", JsonArray(records.map { it.toJsonElement() }))
        }.toString()

    private fun encode(window: NativeJournalWindow): ByteArray =
        serialized(window.sessionId, window.address, window.cut, window.hasMore, window.records)
            .toByteArray(Charsets.UTF_8).also { require(it.size <= maxBytes) { "journal window exceeds its byte limit" } }

    private fun decode(bytes: ByteArray): NativeJournalWindow {
        if (bytes.isEmpty()) error("journal window document required")
        val root = Json.parseToJsonElement(bytes.decodeToString(throwOnInvalidSequence = true)) as? JsonObject
            ?: error("journal window object required")
        require(root.keys == setOf("version", "principal", "sessionId", "address", "cut", "hasMore", "records")) {
            "unexpected journal window fields"
        }
        val version = root.getValue("version") as? JsonPrimitive
        require(version != null && !version.isString && version.intOrNull == 1) { "unsupported journal window version" }
        require(root.getValue("principal") == principalJson) { "journal window belongs to another principal" }
        val sessionId = (root.getValue("sessionId") as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotEmpty() }
            ?.content ?: error("journal window session required")
        val address = WireValue.fromJsonElement(root.getValue("address")) as? WireValue.ObjectValue
            ?: error("journal window address object required")
        val cut = longOf(root.getValue("cut"), "cut", minimum = -1)
        val hasMore = booleanOf(root.getValue("hasMore"))
        val records = (root.getValue("records") as? JsonArray)?.map { WireValue.fromJsonElement(it) }
            ?: error("journal window records required")
        var previous: Long? = null
        for (record in records) {
            val seq = sequenceOf(record)
            if (previous != null && seq != previous + 1) error("journal window records are not contiguous")
            previous = seq
        }
        // Live events may extend a window past its snapshot cut, never before it.
        val last = records.lastOrNull()?.let(::sequenceOf)
        require(last == null || last >= cut) { "journal window cut differs from its last record" }
        require(last != null || cut == -1L) { "an empty journal window must carry the empty cut" }
        return NativeJournalWindow(sessionId, address, cut, hasMore, records)
    }

    private fun sequenceOf(record: WireValue): Long {
        if (WireShape.string(record, "type") != "event") error("journal window event record required")
        val event = WireShape.objectValue(record, "event") ?: error("journal window event is missing")
        val seq = WireShape.number(event, "seq") ?: error("journal window seq is missing")
        if (seq < 0 || seq > 9_007_199_254_740_991.0 || seq != kotlin.math.floor(seq)) error("journal window seq must be a safe integer")
        return seq.toLong()
    }

    private fun longOf(element: JsonElement, field: String, minimum: Long): Long {
        val primitive = element as? JsonPrimitive
        val number = primitive?.doubleOrNull
        require(primitive != null && !primitive.isString && number != null
            && number.isFinite() && number >= minimum && number <= 9_007_199_254_740_991.0
            && number == kotlin.math.floor(number)) { "invalid journal window $field" }
        return number.toLong()
    }

    private fun booleanOf(element: JsonElement): Boolean {
        val primitive = element as? JsonPrimitive ?: error("journal window boolean required")
        if (primitive.isString || (primitive.content != "true" && primitive.content != "false")) error("invalid journal window boolean")
        return primitive.content == "true"
    }
}
