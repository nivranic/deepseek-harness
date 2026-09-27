package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.CredentialsCipher
import java.io.File
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.json.*

/** Local input is isolated from every other Host key and device grant. */
data class CompanionInputPrincipal(val hostId: String, val fingerprint: String, val deviceId: String)

/** An explicit prompt whose receipt has not yet been observed. Its complete original intent survives composer edits. */
data class PendingPrompt(val sessionId: String, val draft: SessionDraft)

/** Local human input and viewing position; this contains neither credentials nor a copy of the Host transcript. */
data class CompanionInputSnapshot(
    val drafts: Map<String, SessionDraft> = emptyMap(),
    val pendingPrompts: Map<String, PendingPrompt> = emptyMap(),
    val answers: Map<QuestionDraftKey, List<CompanionQuestionAnswer>> = emptyMap(),
    val lastSessionId: String? = null,
)

/** Durable input storage. An unreadable document is never silently replaced by an empty snapshot. */
interface CompanionInputStoring {
    fun load(): CompanionInputSnapshot?
    fun save(snapshot: CompanionInputSnapshot)
    /** Explicit recovery preserves the previous encrypted bytes before committing an empty snapshot. */
    fun preserveAndStartFresh()
}

/** An encrypted, bounded v3 document per principal. Older formats are rejected without rewriting their bytes.
 * Replacement requires an atomic same-directory move.
 */
class FileCompanionInputStore(
    directory: File,
    private val principal: CompanionInputPrincipal,
    private val cipher: CredentialsCipher,
    private val maxBytes: Int,
) : CompanionInputStoring {
    init { require(maxBytes > 0 && maxBytes < Int.MAX_VALUE) }
    private val principalJson = buildJsonObject {
        put("hostId", principal.hostId); put("fingerprint", principal.fingerprint); put("deviceId", principal.deviceId)
    }
    private val name = MessageDigest.getInstance("SHA-256").digest(principalJson.toString().toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) }
    private val file = File(directory, "$name.state")

    override fun load(): CompanionInputSnapshot? {
        val input = try { Files.newInputStream(file.toPath()) }
        catch (_: NoSuchFileException) { return null }
        val encrypted = input.use { it.readNBytes(maxBytes + 1) }
        require(encrypted.size <= maxBytes) { "input snapshot exceeds its byte limit" }
        val plain = cipher.open(encrypted)
        require(plain.size <= maxBytes) { "decoded input snapshot exceeds its byte limit" }
        return decode(plain)
    }

    override fun save(snapshot: CompanionInputSnapshot) {
        val plain = encode(snapshot).toString().toByteArray(Charsets.UTF_8)
        require(plain.size <= maxBytes) { "input snapshot exceeds its byte limit" }
        decode(plain)
        val encrypted = cipher.seal(plain)
        require(encrypted.size <= maxBytes) { "encrypted input snapshot exceeds its byte limit" }
        val target = file.toPath().toAbsolutePath()
        Files.createDirectories(target.parent)
        val temporary = Files.createTempFile(target.parent, file.name + "-", ".tmp")
        AutoCloseable { Files.deleteIfExists(temporary) }.use {
            Files.write(temporary, encrypted)
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        }
    }

    override fun preserveAndStartFresh() {
        if (file.exists()) Files.copy(file.toPath(), File(file.parentFile, "${file.name}.unavailable-${UUID.randomUUID()}").toPath())
        save(CompanionInputSnapshot())
    }

    private fun encode(snapshot: CompanionInputSnapshot) = buildJsonObject {
        put("version", 3)
        put("principal", principalJson)
        put("drafts", JsonArray(snapshot.drafts.map { (sessionId, draft) -> promptJson(sessionId, draft) }))
        put("pendingPrompts", JsonArray(snapshot.pendingPrompts.map { (requestId, pending) ->
            require(requestId == pending.draft.requestId) { "pending prompt identity differs" }
            promptJson(pending.sessionId, pending.draft)
        }))
        put("answers", JsonArray(snapshot.answers.map { (key, answers) -> buildJsonObject {
            put("sessionId", key.sessionId); put("interactionId", key.interactionId); put("revision", key.revision)
            put("answers", JsonArray(answers.map { answer -> buildJsonObject {
                put("id", answer.id)
                put("selected", JsonArray(answer.selected.map(::JsonPrimitive)))
                put("custom", answer.custom?.let(::JsonPrimitive) ?: JsonNull)
            } }))
        } }))
        put("lastSessionId", snapshot.lastSessionId?.let(::JsonPrimitive) ?: JsonNull)
    }

    private fun promptJson(sessionId: String, draft: SessionDraft) = buildJsonObject {
        put("sessionId", sessionId); put("text", draft.text); put("requestId", draft.requestId)
        put("attachments", JsonArray(draft.attachments.map { attachment -> buildJsonObject {
            put("type", if (attachment is SessionImageAttachment) "image" else "file")
            put("receiptId", attachment.receiptId); put("attachmentId", attachment.attachmentId)
            put("name", attachment.name?.let(::JsonPrimitive) ?: JsonNull); put("bytes", attachment.bytes)
            if (attachment is SessionImageAttachment) {
                put("mediaType", attachment.mediaType); put("width", attachment.width); put("height", attachment.height)
                put("originalDimensions", attachment.originalDimensions?.let { dimensions -> buildJsonObject {
                    put("width", dimensions.width); put("height", dimensions.height)
                } } ?: JsonNull)
            }
        } }))
    }

    private fun decode(bytes: ByteArray): CompanionInputSnapshot {
        val root = Json.parseToJsonElement(bytes.decodeToString(throwOnInvalidSequence = true)).objectWith(
            "version", "principal", "drafts", "pendingPrompts", "answers", "lastSessionId")
        val version = root.getValue("version") as? JsonPrimitive
        require(version != null && !version.isString && version.intOrNull == 3) { "unsupported input snapshot version" }
        require(root.getValue("principal").objectWith("hostId", "fingerprint", "deviceId") == principalJson) {
            "input snapshot belongs to another principal"
        }
        val intents = mutableMapOf<String, PendingPrompt>()
        fun prompt(element: JsonElement): PendingPrompt {
            val row = element.objectWith("sessionId", "text", "requestId", "attachments")
            val files = row.array("attachments").map { raw ->
                val kind = (raw as? JsonObject)?.text("type") ?: error("attachment object required")
                val file = when (kind) {
                    "file" -> raw.objectWith("type", "receiptId", "attachmentId", "name", "bytes")
                    "image" -> raw.objectWith("type", "receiptId", "attachmentId", "name", "bytes", "mediaType", "width", "height", "originalDimensions")
                    else -> error("unsupported attachment type")
                }
                val bytesValue = file.getValue("bytes") as? JsonPrimitive
                val size = bytesValue?.longOrNull
                require(bytesValue != null && !bytesValue.isString && size != null && size in 0..9_007_199_254_740_991L) {
                    "invalid file attachment size"
                }
                if (kind == "file") SessionFileAttachment(file.text("receiptId"), file.text("attachmentId"), file.text("name"), size)
                else {
                    require(size > 0) { "invalid image attachment size" }
                    val mediaType = file.text("mediaType")
                    require(mediaType in setOf("image/png", "image/jpeg", "image/webp", "image/gif")) { "unsupported image media type" }
                    fun dimension(value: JsonObject, key: String): Int {
                        val item = value.getValue(key) as? JsonPrimitive
                        val number = item?.intOrNull
                        require(item != null && !item.isString && number != null && number > 0) { "invalid image dimensions" }
                        return number
                    }
                    val original = file.getValue("originalDimensions").takeUnless { it == JsonNull }?.objectWith("width", "height")?.let {
                        SessionImageDimensions(dimension(it, "width"), dimension(it, "height"))
                    }
                    SessionImageAttachment(file.text("receiptId"), file.text("attachmentId"), mediaType, size,
                        dimension(file, "width"), dimension(file, "height"),
                        file.getValue("name").takeUnless { it == JsonNull }?.stringValue(), original)
                }
            }
            require(files.map { it.receiptId }.distinct().size == files.size) { "duplicate file receipt" }
            val pending = PendingPrompt(row.text("sessionId"),
                SessionDraft(row.getValue("text").stringValue(allowEmpty = true), row.text("requestId"), files))
            val previous = intents.putIfAbsent(pending.draft.requestId, pending)
            require(previous == null || previous == pending) { "one prompt identity names different input" }
            return pending
        }
        val drafts = mutableMapOf<String, SessionDraft>()
        for (element in root.array("drafts")) {
            val pending = prompt(element)
            require(drafts.put(pending.sessionId, pending.draft) == null) { "duplicate Session draft" }
        }
        val pending = mutableMapOf<String, PendingPrompt>()
        for (element in root.array("pendingPrompts")) {
            val item = prompt(element)
            require(pending.put(item.draft.requestId, item) == null) { "duplicate pending prompt" }
        }
        val answers = mutableMapOf<QuestionDraftKey, List<CompanionQuestionAnswer>>()
        for (element in root.array("answers")) {
            val row = element.objectWith("sessionId", "interactionId", "revision", "answers")
            val revision = row.getValue("revision") as? JsonPrimitive
            val number = revision?.longOrNull
            require(revision != null && !revision.isString && number != null && number in 1..9_007_199_254_740_991L) {
                "invalid Question revision"
            }
            val key = QuestionDraftKey(row.text("sessionId"), row.text("interactionId"), number)
            val items = row.array("answers").map { raw ->
                val item = raw.objectWith("id", "selected", "custom")
                val selected = item.array("selected").map { it.stringValue() }
                require(selected.distinct().size == selected.size) { "duplicate selected answer" }
                CompanionQuestionAnswer(item.text("id"), selected,
                    item.getValue("custom").takeUnless { it == JsonNull }?.stringValue(allowEmpty = true))
            }
            require(items.map { it.id }.distinct().size == items.size) { "duplicate Question answer" }
            require(answers.put(key, items) == null) { "duplicate Question draft" }
        }
        val lastSession = root.getValue("lastSessionId").takeUnless { it == JsonNull }?.stringValue()
        return CompanionInputSnapshot(drafts, pending, answers, lastSession)
    }

    private fun JsonElement.objectWith(vararg keys: String): JsonObject {
        val value = this as? JsonObject ?: error("input snapshot object required")
        require(value.keys == keys.toSet()) { "unexpected input snapshot fields" }
        return value
    }

    private fun JsonElement.stringValue(allowEmpty: Boolean = false): String {
        val value = this as? JsonPrimitive ?: error("input snapshot string required")
        require(value.isString && (allowEmpty || value.content.isNotBlank())) { "invalid input snapshot string" }
        return value.content
    }

    private fun JsonObject.text(key: String): String = getValue(key).stringValue()
    private fun JsonObject.array(key: String): JsonArray = getValue(key) as? JsonArray ?: error("input snapshot array required")
}
