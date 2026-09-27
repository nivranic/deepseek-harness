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
    fun open(): InputStream
}

/** Local memory and draft admission limits; the Host independently limits the signed RPC envelope. */
data class NativeFileAttachmentLimits(val maxFileBytes: Long, val maxEncodedArgsBytes: Int, val maxFiles: Int) {
    init { require(maxFileBytes in 1..Int.MAX_VALUE.toLong() - 1 && maxEncodedArgsBytes > 0 && maxFiles > 0) }
}

/** Memory-only picker authority for one selected Session generation. Identity is consumed once. */
class NativeFileSelection internal constructor(val sessionId: String, internal val generation: Long)

enum class NativeFileAttachmentPhase { IDLE, SELECTING, READING, UPLOADING, FAILED }
enum class NativeFileAttachmentIssue { TOO_LARGE, TOO_MANY_FILES, INVALID_FILE, REQUEST_TOO_LARGE, SOURCE_FAILED, UPLOAD_FAILED, PERSISTENCE_FAILED }
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

    /** Capture the current selection before launching the picker, without reading or uploading bytes. */
    fun prepare(): NativeFileSelection? = synchronized(lock) {
        val id = session.open.value?.sessionId ?: return null
        if (closed || !lifetime.isActive || pending != null || active?.isCompleted == false || session.sending.value) return null
        if ((inputs.state.value.drafts[id]?.files?.size ?: 0) >= limits.maxFiles) {
            mutableState.value = NativeFileAttachmentState(id, NativeFileAttachmentPhase.FAILED, NativeFileAttachmentIssue.TOO_MANY_FILES)
            return null
        }
        NativeFileSelection(id, session.selectionGeneration).also {
            pending = it
            mutableState.value = NativeFileAttachmentState(id, NativeFileAttachmentPhase.SELECTING)
        }
    }

    fun cancelSelection(selection: NativeFileSelection) = synchronized(lock) {
        if (pending !== selection) return@synchronized
        pending = null
        if (!closed) mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
    }

    /** Consume only the original picker authority. Duplicate and retired callbacks never open their source. */
    fun accept(selection: NativeFileSelection, source: NativeFileAttachmentSource): Job = synchronized(lock) {
        if (pending !== selection) return completed()
        pending = null
        if (!valid(selection) || session.sending.value) {
            if (!closed) mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
            return completed()
        }
        mutableState.value = NativeFileAttachmentState(selection.sessionId, NativeFileAttachmentPhase.READING)
        scope.launch(start = CoroutineStart.LAZY) { upload(selection, source) }.also {
            activeSelection = selection; active = it; it.start()
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
        val previous = synchronized(lock) { pending = null; active.also { it?.cancel() } }
        withContext(NonCancellable) { previous?.join() }
        synchronized(lock) {
            if (!closed && pending == null && active === previous) mutableState.value = NativeFileAttachmentState(session.open.value?.sessionId)
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
            val result = wire.call("fileUploads/upload", prepared.second)
            currentCoroutineContext().ensureActive()
            val file = WireShape.objectValue(result, "file") ?: throw LinkClientException.BadWire("invalid file upload receipt")
            fun text(value: WireValue, key: String) = WireShape.string(value, key)?.takeIf { it.isNotBlank() }
                ?: throw LinkClientException.BadWire("invalid file upload receipt")
            val size = WireShape.number(file, "bytes")
            if (size != prepared.first.toDouble()) throw LinkClientException.BadWire("file upload byte count differs")
            val attachment = SessionFileAttachment(text(result, "receiptId"), text(file, "attachmentId"), text(file, "name"), prepared.first.toLong())
            issue = NativeFileAttachmentIssue.PERSISTENCE_FAILED
            synchronized(lock) {
                if (!valid(selection)) return
                if ((inputs.state.value.drafts[selection.sessionId]?.files?.size ?: 0) >= limits.maxFiles) throw Rejected(NativeFileAttachmentIssue.TOO_MANY_FILES)
                if (!session.addFileAttachment(selection.sessionId, attachment)) throw LinkClientException.BadWire("file receipt was not adopted")
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
        pending = null
        mutableState.value = NativeFileAttachmentState()
        lifetime.cancel()
        scope.async(NonCancellable, start = CoroutineStart.LAZY) { lifetime.join() }.also { retiring = it; it.start() }
    }

    suspend fun closeAndAwait() { withContext(NonCancellable) { close().await() } }
    private fun completed(): Job = Job().apply { complete() }
    private class Rejected(val issue: NativeFileAttachmentIssue) : Exception("file selection cannot be admitted")
}
