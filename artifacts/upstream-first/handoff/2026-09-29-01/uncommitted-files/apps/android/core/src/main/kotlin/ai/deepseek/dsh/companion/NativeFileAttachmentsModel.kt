package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeHttpRequestTooLarge
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
                                               internal val admission: SessionAttachmentAdmission, internal val cleanup: (() -> Unit)?) {
    internal var retiring: Deferred<Unit>? = null
    internal val released = CompletableDeferred<Unit>()
    @Volatile var cleanupFailed: Boolean = false
        internal set
    /** Complete only after optional owned-output cleanup and prompt-admission release. */
    suspend fun awaitReleased() { released.await() }
}

enum class NativeAttachmentKind { FILE, IMAGE }

enum class NativeFileAttachmentPhase { IDLE, SELECTING, READING, UPLOADING, CLEANING, FAILED }
enum class NativeFileAttachmentIssue { TOO_LARGE, TOO_MANY_FILES, INVALID_FILE, UNSUPPORTED_IMAGE, REQUEST_TOO_LARGE, SOURCE_FAILED, UPLOAD_FAILED, PERSISTENCE_FAILED, CLEANUP_FAILED }
data class NativeFileAttachmentState(val sessionId: String? = null, val phase: NativeFileAttachmentPhase = NativeFileAttachmentPhase.IDLE,
                                     val issue: NativeFileAttachmentIssue? = null, val failure: ConnectionFailure? = null,
                                     val refusal: GatewayFailureEnvelope? = null)

/** One Host's attachment selections and atomic shared batches. Cancellation waits for provider and RPC cleanup;
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
    private var activeShare: NativeShareRequest? = null
    private var retiring: Deferred<Unit>? = null
    private val selections = mutableSetOf<NativeFileSelection>()
    private val mutableState = MutableStateFlow(NativeFileAttachmentState())
    val state: StateFlow<NativeFileAttachmentState> = mutableState
    val maxFileBytes: Long get() = limits.maxFileBytes

    init {
        lifetime.invokeOnCompletion {
            synchronized(lock) {
                selections.toList().forEach(::releaseSelection)
                pending = null
            }
        }
    }

    /** Capture the current selection before launching the picker, without reading or uploading bytes. */
    fun prepare(kind: NativeAttachmentKind = NativeAttachmentKind.FILE, cleanup: (() -> Unit)? = null): NativeFileSelection? = synchronized(lock) {
        val id = session.open.value?.sessionId ?: return null
        if (closed || !lifetime.isActive || pending != null || active?.isCompleted == false || session.sending.value) return null
        if ((inputs.state.value.drafts[id]?.attachments?.size ?: 0) >= limits.maxFiles) {
            mutableState.value = NativeFileAttachmentState(id, NativeFileAttachmentPhase.FAILED, NativeFileAttachmentIssue.TOO_MANY_FILES)
            return null
        }
        val admission = session.reserveAttachment() ?: return null
        NativeFileSelection(id, session.selectionGeneration, kind, admission, cleanup).also {
            selections.add(it)
            pending = it
            mutableState.value = NativeFileAttachmentState(id, NativeFileAttachmentPhase.SELECTING)
        }
    }

    fun cancelSelection(selection: NativeFileSelection) = synchronized(lock) {
        if (pending !== selection) return@synchronized
        pending = null
        releaseSelection(selection)
    }

    /** Consume only the original picker authority. Duplicate and retired callbacks never open their source. */
    fun accept(selection: NativeFileSelection, source: NativeFileAttachmentSource): Job = synchronized(lock) {
        if (pending !== selection) return completed()
        pending = null
        if (!valid(selection) || session.sending.value) {
            return releaseSelection(selection)
        }
        mutableState.value = NativeFileAttachmentState(selection.sessionId, NativeFileAttachmentPhase.READING)
        scope.launch(start = CoroutineStart.LAZY) { upload(selection, source) }.also {
            activeSelection = selection
            activeShare = null
            active = it
            // Completion also runs when cancellation prevents the coroutine body from starting.
            it.invokeOnCompletion {
                synchronized(lock) {
                    releaseSelection(selection)
                }
            }
            it.start()
        }
    }

    /** Import one explicitly reviewed batch, retaining prompt exclusion through adoption and its checkpoint. */
    fun importShare(incoming: NativeShareRequest, shareLimits: NativeShareLimits): NativeShareImport = synchronized(lock) {
        val request = incoming.copy(items = incoming.items.toList(), allowedKinds = incoming.allowedKinds.toSet())
        fun rejected(issue: NativeShareIssue, attachmentIssue: NativeFileAttachmentIssue? = null) =
            NativeShareImport(completed(), CompletableDeferred(NativeShareResult.NotAdopted(issue, attachmentIssue)))
        if (!valid(request)) return@synchronized rejected(NativeShareIssue.STALE_TARGET)
        if (pending != null || active?.isCompleted == false || session.sending.value) return@synchronized rejected(NativeShareIssue.BUSY)
        if (request.text.isEmpty() && request.items.isEmpty()) return@synchronized rejected(NativeShareIssue.EMPTY)
        if (request.text.toByteArray(Charsets.UTF_8).size > shareLimits.maxTextBytes) return@synchronized rejected(NativeShareIssue.TEXT_TOO_LARGE)
        if (inputs.state.value.drafts[request.sessionId]?.attachments.orEmpty().size + request.items.size > limits.maxFiles) {
            return@synchronized rejected(NativeShareIssue.ATTACHMENT_FAILED, NativeFileAttachmentIssue.TOO_MANY_FILES)
        }
        val admission = session.reserveAttachment(request.sessionId, request.selectionGeneration)
            ?: return@synchronized rejected(if (valid(request)) NativeShareIssue.BUSY else NativeShareIssue.STALE_TARGET)
        val completion = CompletableDeferred<NativeShareResult>()
        var outcome: NativeShareResult = NativeShareResult.NotAdopted(NativeShareIssue.CANCELLED)
        mutableState.value = NativeFileAttachmentState(request.sessionId, NativeFileAttachmentPhase.READING)
        val operation = scope.launch(start = CoroutineStart.LAZY) {
            var issue = NativeFileAttachmentIssue.SOURCE_FAILED
            try {
                val attachments = mutableListOf<SessionAttachment>()
                for (item in request.items) {
                    currentCoroutineContext().ensureActive()
                    synchronized(lock) {
                        if (!valid(request)) throw ShareRejected(NativeShareIssue.STALE_TARGET)
                        mutableState.value = NativeFileAttachmentState(request.sessionId, NativeFileAttachmentPhase.READING)
                    }
                    issue = NativeFileAttachmentIssue.SOURCE_FAILED
                    val prepared = withContext(dispatcher) {
                        currentCoroutineContext().ensureActive()
                        val mediaType = item.source.mediaType()
                        val kind = if (item.requireImage || mediaType?.startsWith("image/", ignoreCase = true) == true) {
                            if (mediaType !in IMAGE_MEDIA_TYPES) throw Rejected(NativeFileAttachmentIssue.UNSUPPORTED_IMAGE)
                            NativeAttachmentKind.IMAGE
                        } else NativeAttachmentKind.FILE
                        if (kind !in request.allowedKinds) throw ShareRejected(NativeShareIssue.KIND_UNAVAILABLE)
                        prepareUpload(request.sessionId, item.source, kind, mediaType)
                    }
                    currentCoroutineContext().ensureActive()
                    synchronized(lock) {
                        if (!valid(request)) throw ShareRejected(NativeShareIssue.STALE_TARGET)
                        mutableState.value = NativeFileAttachmentState(request.sessionId, NativeFileAttachmentPhase.UPLOADING)
                    }
                    issue = NativeFileAttachmentIssue.UPLOAD_FAILED
                    attachments += uploadPrepared(prepared)
                }
                currentCoroutineContext().ensureActive()
                issue = NativeFileAttachmentIssue.PERSISTENCE_FAILED
                synchronized(lock) {
                    if (!valid(request)) throw ShareRejected(NativeShareIssue.STALE_TARGET)
                    outcome = session.appendSharedContent(request, admission, attachments, limits.maxFiles)
                }
                val adopted = outcome as? NativeShareResult.Adopted
                if (adopted != null) {
                    inputs.flush()
                    currentCoroutineContext().ensureActive()
                    synchronized(lock) { outcome = adopted.copy(saved = true) }
                }
            } catch (cancelled: CancellationException) {
                synchronized(lock) {
                    if (outcome !is NativeShareResult.Adopted) outcome = NativeShareResult.NotAdopted(
                        if (closed || !session.matchesAttachmentTarget(request.sessionId, request.selectionGeneration)) NativeShareIssue.STALE_TARGET
                        else NativeShareIssue.CANCELLED)
                }
                throw cancelled
            } catch (failure: Exception) {
                synchronized(lock) {
                    if (outcome !is NativeShareResult.Adopted) outcome = NativeShareResult.NotAdopted(
                        (failure as? ShareRejected)?.issue ?: if (issue == NativeFileAttachmentIssue.PERSISTENCE_FAILED) NativeShareIssue.INPUT_FAILED
                        else NativeShareIssue.ATTACHMENT_FAILED,
                        if (failure is ShareRejected) null else (failure as? Rejected)?.issue ?: issue,
                        ConnectionFailure.from(failure), (failure as? LinkClientException.Refused)?.let(GatewayFailureEnvelope::from))
                }
            }
        }
        activeSelection = null
        activeShare = request
        active = operation
        operation.invokeOnCompletion {
            synchronized(lock) {
                session.releaseAttachment(admission)
                if (activeShare === request) activeShare = null
                if (valid(request)) {
                    val failure = outcome as? NativeShareResult.NotAdopted
                    mutableState.value = when {
                        outcome is NativeShareResult.Adopted && !(outcome as NativeShareResult.Adopted).saved ->
                            NativeFileAttachmentState(request.sessionId, NativeFileAttachmentPhase.FAILED, NativeFileAttachmentIssue.PERSISTENCE_FAILED)
                        failure?.attachmentIssue != null -> NativeFileAttachmentState(request.sessionId, NativeFileAttachmentPhase.FAILED,
                            failure.attachmentIssue, failure.failure, failure.refusal)
                        else -> NativeFileAttachmentState(request.sessionId)
                    }
                }
                completion.complete(outcome)
            }
        }
        operation.start()
        NativeShareImport(operation, completion)
    }

    /** Replace the UI selection after all work belonging to the old selection has settled. */
    suspend fun selectSession(sessionId: String?) {
        synchronized(lock) {
            if (pending?.let(::valid) == true || active?.isCompleted == false &&
                (activeSelection?.let(::valid) == true || activeShare?.let(::valid) == true)) return
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
            val selected = selections.toList()
            pending?.let(::releaseSelection)
            pending = null
            active?.cancel()
            active to selected
        }
        withContext(NonCancellable) { previous.first?.join() }
        withContext(NonCancellable) { previous.second.forEach { releaseSelection(it).await() } }
    }

    private fun valid(selection: NativeFileSelection): Boolean = !closed && lifetime.isActive &&
        session.open.value?.sessionId == selection.sessionId && session.selectionGeneration == selection.generation

    private fun valid(request: NativeShareRequest): Boolean = !closed && lifetime.isActive &&
        session.matchesAttachmentTarget(request.sessionId, request.selectionGeneration)

    private suspend fun upload(selection: NativeFileSelection, source: NativeFileAttachmentSource) {
        var issue = NativeFileAttachmentIssue.SOURCE_FAILED
        try {
            val prepared = withContext(dispatcher) {
                prepareUpload(selection.sessionId, source, selection.kind,
                    if (selection.kind == NativeAttachmentKind.IMAGE) source.mediaType() else null)
            }
            currentCoroutineContext().ensureActive()
            synchronized(lock) {
                if (!valid(selection)) return
                mutableState.value = NativeFileAttachmentState(selection.sessionId, NativeFileAttachmentPhase.UPLOADING)
            }
            issue = NativeFileAttachmentIssue.UPLOAD_FAILED
            val attachment = uploadPrepared(prepared)
            issue = NativeFileAttachmentIssue.PERSISTENCE_FAILED
            synchronized(lock) {
                if (!valid(selection)) return
                if ((inputs.state.value.drafts[selection.sessionId]?.attachments?.size ?: 0) >= limits.maxFiles) throw Rejected(NativeFileAttachmentIssue.TOO_MANY_FILES)
                if (!session.addAttachment(selection.sessionId, attachment)) throw LinkClientException.BadWire("attachment receipt was not adopted")
            }
            inputs.flush()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            synchronized(lock) {
                if (valid(selection)) mutableState.value = NativeFileAttachmentState(selection.sessionId, NativeFileAttachmentPhase.FAILED,
                    (failure as? Rejected)?.issue ?: issue, ConnectionFailure.from(failure),
                    (failure as? LinkClientException.Refused)?.let(GatewayFailureEnvelope::from))
            }
        } finally {
            withContext(NonCancellable) { releaseSelection(selection).await() }
        }
    }

    private data class PreparedUpload(val kind: NativeAttachmentKind, val sourceBytes: Int, val args: Map<String, WireValue>)

    /** Read one bounded source on the I/O dispatcher, retaining only one encoded upload at a time. */
    private suspend fun prepareUpload(sessionId: String, source: NativeFileAttachmentSource, kind: NativeAttachmentKind,
                                      sourceMediaType: String?): PreparedUpload {
        val context = currentCoroutineContext()
        context.ensureActive()
        val name = source.name()
        context.ensureActive()
        if (name != null && name.isBlank()) throw Rejected(NativeFileAttachmentIssue.INVALID_FILE)
        val mediaType = if (kind == NativeAttachmentKind.IMAGE) {
            sourceMediaType?.takeIf { it in IMAGE_MEDIA_TYPES } ?: throw Rejected(NativeFileAttachmentIssue.UNSUPPORTED_IMAGE)
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
        val args = mapOf("agentId" to WireValue.StringValue(sessionId), "request" to WireValue.ObjectValue(request))
        if (WireValue.ObjectValue(args).toJsonElement().toString().toByteArray(Charsets.UTF_8).size > limits.maxEncodedArgsBytes) {
            throw Rejected(NativeFileAttachmentIssue.REQUEST_TOO_LARGE)
        }
        return PreparedUpload(kind, bytes.size, args)
    }

    private suspend fun uploadPrepared(prepared: PreparedUpload): SessionAttachment {
        val result = try {
            wire.call(if (prepared.kind == NativeAttachmentKind.IMAGE) "fileUploads/uploadImage" else "fileUploads/upload", prepared.args)
        } catch (_: NativeHttpRequestTooLarge) {
            throw Rejected(NativeFileAttachmentIssue.REQUEST_TOO_LARGE)
        }
        currentCoroutineContext().ensureActive()
        return parseReceipt(result, prepared.kind, prepared.sourceBytes)
    }

    /** Retire even after parent cancellation, awaiting every content stream and request before Host replacement. */
    fun close(): Deferred<Unit> = synchronized(lock) {
        retiring?.let { return it }
        closed = true
        pending?.let(::releaseSelection)
        pending = null
        mutableState.value = NativeFileAttachmentState()
        lifetime.cancel()
        scope.async(NonCancellable, start = CoroutineStart.LAZY) {
            lifetime.join()
            val selected = synchronized(lock) { selections.toList() }
            selected.forEach { releaseSelection(it).await() }
        }.also { retiring = it; it.start() }
    }

    suspend fun closeAndAwait() { withContext(NonCancellable) { close().await() } }

    /** Only explicitly owned camera output supplies cleanup; arbitrary picked provider documents have no finalizer. */
    private fun releaseSelection(selection: NativeFileSelection): Deferred<Unit> = synchronized(lock) {
        selection.retiring?.let { return it }
        val prior = state.value
        fun finish() {
            synchronized(lock) {
                session.releaseAttachment(selection.admission)
                selections.remove(selection)
                if (!closed && state.value.sessionId == selection.sessionId) {
                    mutableState.value = when {
                        selection.cleanupFailed -> NativeFileAttachmentState(selection.sessionId, NativeFileAttachmentPhase.FAILED, NativeFileAttachmentIssue.CLEANUP_FAILED)
                        prior.phase == NativeFileAttachmentPhase.FAILED -> prior
                        else -> NativeFileAttachmentState(session.open.value?.sessionId)
                    }
                }
                selection.released.complete(Unit)
            }
        }
        if (selection.cleanup == null) {
            finish()
            return CompletableDeferred(Unit).also { selection.retiring = it }
        }
        if (!closed && state.value.sessionId == selection.sessionId) mutableState.value = prior.copy(phase = NativeFileAttachmentPhase.CLEANING)
        scope.async(NonCancellable + dispatcher, start = CoroutineStart.LAZY) {
            try { selection.cleanup.invoke() }
            catch (_: Exception) { selection.cleanupFailed = true }
            finally { finish() }
        }.also { selection.retiring = it; it.start() }
    }
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
    private class ShareRejected(val issue: NativeShareIssue) : Exception("shared input cannot be adopted")

    private companion object { val IMAGE_MEDIA_TYPES = setOf("image/png", "image/jpeg", "image/webp", "image/gif") }
}
