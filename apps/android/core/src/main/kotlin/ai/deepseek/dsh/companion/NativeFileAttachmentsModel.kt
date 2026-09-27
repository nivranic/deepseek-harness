package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.Base64
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Content-provider metadata and streams are opened only by the owning model's I/O operation. */
interface NativeFileAttachmentSource {
    fun name(): String?
    fun mediaType(): String? = null
    fun open(): InputStream
}

/** Local memory and draft admission limits; the Host independently limits the signed RPC envelope. */
data class NativeFileAttachmentLimits(val maxFileBytes: Long, val maxEncodedArgsBytes: Int, val maxFiles: Int) {
    init { require(maxFileBytes in 1..Int.MAX_VALUE.toLong() - 1 && maxEncodedArgsBytes > 0 && maxFiles > 0) }
}

/** Memory-only picker authority for one selected Session generation. Identity is consumed once. */
class NativeFileSelection internal constructor(val sessionId: String, internal val generation: Long, val kind: NativeAttachmentKind,
                                               internal val admission: SessionAttachmentAdmission)

enum class NativeAttachmentKind { FILE, IMAGE }

enum class NativeFileAttachmentPhase { IDLE, SELECTING, READING, UPLOADING, FAILED }
enum class NativeFileAttachmentIssue { TOO_LARGE, TOO_MANY_FILES, INVALID_FILE, UNSUPPORTED_IMAGE, REQUEST_TOO_LARGE, SOURCE_FAILED, UPLOAD_FAILED, PERSISTENCE_FAILED }
data class NativeFileAttachmentState(val sessionId: String? = null, val phase: NativeFileAttachmentPhase = NativeFileAttachmentPhase.IDLE,
                                     val issue: NativeFileAttachmentIssue? = null, val failure: ConnectionFailure? = null,
                                     val refusal: GatewayFailureEnvelope? = null)

/** One Host's explicit file selection and encoded upload. Cancellation waits for provider and RPC cleanup;
 * an upload already admitted by the Host can leave unreferenced stored bytes. Neither upload nor prompt is retried automatically.
 */
class NativeFileAttachmentsModel(private val wire: WireDriving, private val session: SessionModel,
                                 private val inputs: CompanionInputState, parent: CoroutineScope,
                                 private val limits: NativeFileAttachmentLimits,
                                 private val dispatcher: CoroutineDispatcher = Dispatchers.IO) {
    private val lock = Any()
    private val lifetime = SupervisorJob(parent.coroutineContext[Job])
    private val scope = CoroutineScope(parent.coroutineContext + lifetime)
    private var closed = false
    private var pending: NativeFileSelection? = null
    private var active: Job? = null
    private var activeSelection: NativeFileSelection? = null
    private var retiring: Deferred<Unit>? = null
    private val mutableState = MutableStateFlow(NativeFileAttachmentState())
    val state: StateFlow<NativeFileAttachmentState> = mutableState
    val maxFileBytes: Long get() = limits.maxFileBytes

    init {
        lifetime.invokeOnCompletion {
            synchronized(lock) {
                pending?.let { selection -> session.releaseAttachment(selection.admission) }
                pending = null
                if (!closed) mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
            }
        }
    }

    /** Capture the current selection before launching the picker, without reading or uploading bytes. */
    fun prepare(kind: NativeAttachmentKind = NativeAttachmentKind.FILE): NativeFileSelection? = synchronized(lock) {
        val id = session.open.value?.sessionId ?: return null
        if (closed || !lifetime.isActive || pending != null || active?.isCompleted == false || session.sending.value) return null
        if ((inputs.state.value.drafts[id]?.attachments?.size ?: 0) >= limits.maxFiles) {
            mutableState.value = NativeFileAttachmentState(id, NativeFileAttachmentPhase.FAILED, NativeFileAttachmentIssue.TOO_MANY_FILES)
            return null
        }
        val admission = session.reserveAttachment() ?: return null
        NativeFileSelection(id, session.selectionGeneration, kind, admission).also {
            pending = it
            mutableState.value = NativeFileAttachmentState(id, NativeFileAttachmentPhase.SELECTING)
        }
    }

    fun cancelSelection(selection: NativeFileSelection) = synchronized(lock) {
        if (pending !== selection) return@synchronized
        pending = null
        session.releaseAttachment(selection.admission)
        if (!closed) mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
    }

    /** Consume only the original picker authority. Duplicate and retired callbacks never open their source. */
    fun accept(selection: NativeFileSelection, source: NativeFileAttachmentSource): Job = synchronized(lock) {
        if (pending !== selection) return completed()
        pending = null
        if (!valid(selection) || session.sending.value) {
            session.releaseAttachment(selection.admission)
            if (!closed) mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
            return completed()
        }
        mutableState.value = NativeFileAttachmentState(selection.sessionId, NativeFileAttachmentPhase.READING)
        scope.launch(start = CoroutineStart.LAZY) { upload(selection, source) }.also {
            activeSelection = selection
            active = it
            // Completion also runs when cancellation prevents the coroutine body from starting.
            it.invokeOnCompletion {
                synchronized(lock) {
                    session.releaseAttachment(selection.admission)
                    if (!closed && activeSelection === selection && state.value.phase in setOf(NativeFileAttachmentPhase.READING, NativeFileAttachmentPhase.UPLOADING)) {
                        mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
                    }
                }
            }
            it.start()
        }
    }

    /** Replace the UI selection after all work belonging to the old selection has settled. */
    suspend fun selectSession(sessionId: String?) {
        synchronized(lock) {
            if (pending?.let(::valid) == true || active?.isCompleted == false && activeSelection?.let(::valid) == true) return
        }
        cancelAndAwait()
        synchronized(lock) {
            if (!closed && pending == null && active?.isCompleted != false && session.open.value?.sessionId == sessionId) {
                mutableState.value = NativeFileAttachmentState(sessionId)
            }
        }
    }

    fun cancel(): Job = scope.launch(start = CoroutineStart.UNDISPATCHED) { cancelAndAwait() }

    suspend fun cancelAndAwait() {
        val previous = synchronized(lock) {
            pending?.let { session.releaseAttachment(it.admission) }
            pending = null
            active?.cancel()
            active to activeSelection
        }
        withContext(NonCancellable) { previous.first?.join() }
        synchronized(lock) {
            previous.second?.let { session.releaseAttachment(it.admission) }
            if (!closed && pending == null && active === previous.first) mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
        }
    }

    private fun valid(selection: NativeFileSelection): Boolean = !closed && lifetime.isActive &&
        session.open.value?.sessionId == selection.sessionId && session.selectionGeneration == selection.generation

    private suspend fun upload(selection: NativeFileSelection, source: NativeFileAttachmentSource) {
        var issue = NativeFileAttachmentIssue.SOURCE_FAILED
        try {
            val prepared = withContext(dispatcher) {
                val context = currentCoroutineContext()
                context.ensureActive()
                val name = source.name()
                if (name != null && name.isBlank()) throw Rejected(NativeFileAttachmentIssue.INVALID_FILE)
                val mediaType = if (selection.kind == NativeAttachmentKind.IMAGE) {
                    source.mediaType()?.takeIf { it in IMAGE_MEDIA_TYPES } ?: throw Rejected(NativeFileAttachmentIssue.UNSUPPORTED_IMAGE)
                } else null
                val bytes = source.open().use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(minOf(16_384L, limits.maxFileBytes + 1).toInt())
                    while (true) {
                        context.ensureActive()
                        val count = input.read(buffer, 0, minOf(buffer.size.toLong(), limits.maxFileBytes + 1 - output.size()).toInt())
                        context.ensureActive()
                        if (count < 0) break
                        if (count == 0) throw Rejected(NativeFileAttachmentIssue.SOURCE_FAILED)
                        if (output.size().toLong() + count > limits.maxFileBytes) throw Rejected(NativeFileAttachmentIssue.TOO_LARGE)
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                val request = mutableMapOf<String, WireValue>("data" to WireValue.StringValue(Base64.getEncoder().encodeToString(bytes)))
                if (name != null) request["name"] = WireValue.StringValue(name)
                if (mediaType != null) request["mediaType"] = WireValue.StringValue(mediaType)
                val args = mapOf("agentId" to WireValue.StringValue(selection.sessionId), "request" to WireValue.ObjectValue(request))
                if (WireValue.ObjectValue(args).toJsonElement().toString().toByteArray(Charsets.UTF_8).size > limits.maxEncodedArgsBytes) {
                    throw Rejected(NativeFileAttachmentIssue.REQUEST_TOO_LARGE)
                }
                bytes.size to args
            }
            currentCoroutineContext().ensureActive()
            synchronized(lock) {
                if (!valid(selection)) return
                mutableState.value = NativeFileAttachmentState(selection.sessionId, NativeFileAttachmentPhase.UPLOADING)
            }
            issue = NativeFileAttachmentIssue.UPLOAD_FAILED
            val result = wire.call(if (selection.kind == NativeAttachmentKind.IMAGE) "fileUploads/uploadImage" else "fileUploads/upload", prepared.second)
            currentCoroutineContext().ensureActive()
            val attachment = parseReceipt(result, selection.kind, prepared.first)
            issue = NativeFileAttachmentIssue.PERSISTENCE_FAILED
            synchronized(lock) {
                if (!valid(selection)) return
                if ((inputs.state.value.drafts[selection.sessionId]?.attachments?.size ?: 0) >= limits.maxFiles) throw Rejected(NativeFileAttachmentIssue.TOO_MANY_FILES)
                if (!session.addAttachment(selection.sessionId, attachment)) throw LinkClientException.BadWire("attachment receipt was not adopted")
            }
            inputs.flush()
            synchronized(lock) { if (valid(selection)) mutableState.value = NativeFileAttachmentState(selection.sessionId) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            synchronized(lock) {
                if (valid(selection)) mutableState.value = NativeFileAttachmentState(selection.sessionId, NativeFileAttachmentPhase.FAILED,
                    (failure as? Rejected)?.issue ?: issue, ConnectionFailure.from(failure),
                    (failure as? LinkClientException.Refused)?.let(GatewayFailureEnvelope::from))
            }
        } finally {
            synchronized(lock) {
                if (!closed && state.value.phase in setOf(NativeFileAttachmentPhase.READING, NativeFileAttachmentPhase.UPLOADING)) {
                    mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
                }
            }
        }
    }

    /** Retire even after parent cancellation, awaiting every content stream and request before Host replacement. */
    fun close(): Deferred<Unit> = synchronized(lock) {
        retiring?.let { return it }
        closed = true
        pending?.let { session.releaseAttachment(it.admission) }
        pending = null
        mutableState.value = NativeFileAttachmentState()
        lifetime.cancel()
        scope.async(NonCancellable, start = CoroutineStart.LAZY) {
            lifetime.join()
            synchronized(lock) { activeSelection?.let { session.releaseAttachment(it.admission) } }
            Unit
        }.also { retiring = it; it.start() }
    }

    suspend fun closeAndAwait() { withContext(NonCancellable) { close().await() } }
    private fun parseReceipt(result: WireValue, kind: NativeAttachmentKind, sourceBytes: Int): SessionAttachment {
        fun invalid(): Nothing = throw LinkClientException.BadWire("invalid attachment upload receipt")
        fun text(value: WireValue, key: String) = WireShape.string(value, key)?.takeIf { it.isNotBlank() } ?: invalid()
        fun number(value: WireValue, key: String, minimum: Long, maximum: Long): Long {
            val found = WireShape.number(value, key) ?: invalid()
            if (!found.isFinite() || found != kotlin.math.floor(found) || found < minimum.toDouble() || found > maximum.toDouble()) invalid()
            return found.toLong()
        }
        val receiptId = text(result, "receiptId")
        if (kind == NativeAttachmentKind.FILE) {
            val file = WireShape.objectValue(result, "file") ?: invalid()
            if (number(file, "bytes", 0, 9_007_199_254_740_991L) != sourceBytes.toLong()) invalid()
            return SessionFileAttachment(receiptId, text(file, "attachmentId"), text(file, "name"), sourceBytes.toLong())
        }
        val image = WireShape.objectValue(result, "image") ?: invalid()
        val fields = (image as? WireValue.ObjectValue)?.entries ?: invalid()
        val mediaType = text(image, "mediaType").takeIf { it in IMAGE_MEDIA_TYPES } ?: invalid()
        val name = if ("name" in fields) text(image, "name") else null
        val original = if ("originalDimensions" in fields) {
            val dimensions = WireShape.objectValue(image, "originalDimensions") ?: invalid()
            SessionImageDimensions(number(dimensions, "width", 1, Int.MAX_VALUE.toLong()).toInt(),
                number(dimensions, "height", 1, Int.MAX_VALUE.toLong()).toInt())
        } else null
        return SessionImageAttachment(receiptId, text(image, "attachmentId"), mediaType,
            number(image, "bytes", 1, 9_007_199_254_740_991L), number(image, "width", 1, Int.MAX_VALUE.toLong()).toInt(),
            number(image, "height", 1, Int.MAX_VALUE.toLong()).toInt(), name, original)
    }
    private fun completed(): Job = Job().apply { complete() }
    private class Rejected(val issue: NativeFileAttachmentIssue) : Exception("file selection cannot be admitted")

    private companion object { val IMAGE_MEDIA_TYPES = setOf("image/png", "image/jpeg", "image/webp", "image/gif") }
}
