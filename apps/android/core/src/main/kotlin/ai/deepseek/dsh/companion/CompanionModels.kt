package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

/** One session row in the list; `cwd` is the Host-side workspace directory when the row publishes it. */
data class SessionRow(val id: String, val title: String, val updatedAt: Double?, val cwd: String? = null)

/** One selectable reasoning effort for an exact model route. */
data class NativeEffortChoice(val id: String, val name: String)

/** Selectable reasoning metadata for one exact model route; absent models take no effort. */
data class NativeModelReasoning(val efforts: List<NativeEffortChoice>, val defaultEffort: String?)

/** One routable model as the Host catalog publishes it. */
data class NativeCatalogModel(val id: String, val name: String, val reasoning: NativeModelReasoning? = null)

/** One provider group in the Host model catalog. */
data class NativeCatalogGroup(val id: String, val name: String, val models: List<NativeCatalogModel>)

/** Host-generation model catalog plus the deployment default selection. */
data class NativeModelCatalog(
    val groups: List<NativeCatalogGroup>,
    val defaultProvider: String,
    val defaultModel: String,
)

/** The open session: its id and the folded domain state. */
data class OpenSession(val sessionId: String, val state: DomainState)

/** One forwarded interaction awaiting an answer. */
data class PendingInteraction(
    val id: String,
    val kind: Kind,
    val sessionId: String,
    val title: String,
    val detail: String,
    val revision: Long,
    val questions: List<CompanionQuestion> = emptyList(),
) {
    enum class Kind { APPROVAL, QUESTION }
}

/** One workspace row from the registry follow. */
data class WorkspaceRow(val id: String, val title: String, val sessionIds: List<String> = emptyList())

/** One workspace directory entry. */
data class FileEntry(val name: String, val isDirectory: Boolean, val size: Double?)

/** A versioned UTF-8 file prefix, paged in Host line units. */
data class OpenTextFile(
    val path: String,
    val mediaType: String,
    val text: String,
    val loadedLines: Int,
    val totalBytes: Long?,
    val version: String,
    val hasMore: Boolean,
)

/** One subagent child row. */
data class SubagentRow(
    val id: String,
    val mode: String?,
    val label: String?,
    val activity: String?,
    val reason: String?,
)

/** Serializes stream replacement and keeps every active or pending job awaitable. */
internal class StreamTransitionOwner(private val scope: CoroutineScope) {
    private val transition = Mutex()
    private data class Observation(val generation: Long, val snapshot: ConnectionSnapshot)
    private val observation = AtomicReference(Observation(0, ConnectionSnapshot(ConnectionState.IDLE, 0, 0, null)))
    private val active = AtomicReference<Job?>()
    private val pending = ConcurrentHashMap.newKeySet<Job>()
    private val mutableSnapshots = MutableStateFlow(observation.get().snapshot)

    val connectionSnapshot: ConnectionSnapshot get() = observation.get().snapshot

    /** Compose-observable mirror of the atomic snapshot; every transition posts the post-update value. */
    val snapshots: StateFlow<ConnectionSnapshot> = mutableSnapshots

    private fun mirror() {
        mutableSnapshots.value = observation.get().snapshot
    }

    fun isCurrent(value: Long): Boolean = observation.get().generation == value

    private fun advanceGeneration(state: ConnectionState): Long = observation.updateAndGet {
        Observation(it.generation + 1, it.snapshot.copy(state = state, lastFailure = null))
    }.also { mirror() }.generation

    private fun update(value: Long, change: (ConnectionSnapshot) -> ConnectionSnapshot) {
        observation.updateAndGet {
            if (it.generation != value || it.snapshot.state == ConnectionState.STOPPING || it.snapshot.state == ConnectionState.STOPPED) it
            else it.copy(snapshot = change(it.snapshot))
        }
        mirror()
    }

    fun attempt(value: Long) = update(value) {
        it.copy(attempts = if (it.attempts == Long.MAX_VALUE) it.attempts else it.attempts + 1)
    }

    fun received(value: Long) = update(value) { it.copy(state = ConnectionState.OPEN, lastFailure = null) }

    fun interrupted(value: Long, error: Throwable?) = update(value) {
        it.copy(state = ConnectionState.ENDED, lastFailure = error?.let { failure -> ConnectionFailure.from(failure) },
            interruptions = if (it.interruptions == Long.MAX_VALUE) it.interruptions else it.interruptions + 1)
    }

    fun retrying(value: Long) = update(value) { it.copy(state = ConnectionState.RECONNECTING) }

    private fun finished(value: Long) {
        update(value) { it.copy(state = ConnectionState.ENDED) }
        settleStopped()
    }

    /** A synchronous stop remains stopping while a replacement or its retired stream still owns work. */
    private fun settleStopped() {
        if (!transition.tryLock()) return
        try {
            if (active.get()?.isCompleted == false || pending.any { !it.isCompleted }) return
            observation.updateAndGet {
                if (it.snapshot.state == ConnectionState.STOPPING) it.copy(snapshot = it.snapshot.copy(state = ConnectionState.STOPPED)) else it
            }
            mirror()
        } finally {
            transition.unlock()
        }
    }

    suspend fun replace(
        create: (Long) -> Job,
        publish: () -> Unit,
        invalidate: () -> Unit,
    ) {
        val nextGeneration = advanceGeneration(ConnectionState.OPENING)
        withContext(NonCancellable) {
            replaceGeneration(nextGeneration, create, publish, invalidate)
        }
    }

    fun replaceAsync(
        create: (Long) -> Job,
        publish: () -> Unit,
        invalidate: () -> Unit,
    ) {
        val nextGeneration = advanceGeneration(ConnectionState.OPENING)
        val pendingJob = scope.launch(start = CoroutineStart.LAZY) {
            withContext(NonCancellable) {
                replaceGeneration(nextGeneration, create, publish, invalidate)
            }
        }
        pending.add(pendingJob)
        pendingJob.invokeOnCompletion { failure ->
            pending.remove(pendingJob)
            if (failure != null) finished(nextGeneration) else settleStopped()
        }
        pendingJob.start()
    }

    fun stop(invalidate: () -> Unit) {
        advanceGeneration(ConnectionState.STOPPING)
        active.get()?.cancel()
        invalidate()
        settleStopped()
    }

    suspend fun stopAndAwait(invalidate: () -> Unit) {
        withContext(NonCancellable) {
            stop(invalidate)
            while (true) {
                pending.toList().joinAll()
                transition.withLock {
                    active.getAndSet(null)?.cancelAndJoin()
                    invalidate()
                }
                if (pending.isEmpty()) return@withContext
            }
        }
        settleStopped()
    }

    private suspend fun replaceGeneration(
        value: Long,
        create: (Long) -> Job,
        publish: () -> Unit,
        invalidate: () -> Unit,
    ) {
        try {
            transition.withLock {
                active.getAndSet(null)?.cancelAndJoin()
                if (!isCurrent(value)) return@withLock
                val next = create(value)
                active.set(next)
                next.invokeOnCompletion { finished(value) }
                if (!isCurrent(value)) {
                    retire(next, invalidate)
                    return@withLock
                }
                publish()
                if (!isCurrent(value)) {
                    retire(next, invalidate)
                    return@withLock
                }
                if (!next.start()) {
                    active.compareAndSet(next, null)
                    invalidate()
                }
            }
        } finally {
            settleStopped()
        }
    }

    private suspend fun retire(job: Job, invalidate: () -> Unit) {
        active.compareAndSet(job, null)
        invalidate()
        job.cancelAndJoin()
    }
}

/**
 * The session-slice state machine — the Kotlin mirror of the Swift
 * `RemoteSessionViewModel`: list sessions, open one, fold the follow
 * stream's snapshot and live events through the conformance-tested fold,
 * send prompts, cancel, and expose the plan/todo/goal and tool projections.
 * Every field the UI renders is a [StateFlow], so Compose recomposes on
 * each emission rather than re-reading on navigation.
 */
class SessionModel(
    private val wire: WireDriving,
    private val scope: CoroutineScope,
    private val reconnectDelayMillis: Long = 1_000,
    private val inputs: CompanionInputState = CompanionInputState.memory(),
    private val historyLimits: NativeHistoryLimits = NativeHistoryLimits(pageMessages = 50, maxBufferedBytes = 8_388_608),
) {
    private val _sessions = MutableStateFlow<List<SessionRow>>(emptyList())
    val sessions: StateFlow<List<SessionRow>> = _sessions

    private val listRequest = Mutex()
    private val _listState = MutableStateFlow<SessionListState>(SessionListState.Idle)
    val listState: StateFlow<SessionListState> = _listState

    private val _open = MutableStateFlow<OpenSession?>(null)
    val open: StateFlow<OpenSession?> = _open

    val input: StateFlow<CompanionInputSnapshot> = inputs.state
    private val _sendFailure = MutableStateFlow<PromptSubmissionFailure?>(null)
    val sendFailure: StateFlow<PromptSubmissionFailure?> = _sendFailure
    private val sendLock = Mutex()
    private val submissionAdmission = Any()
    private var attachmentAdmission: SessionAttachmentAdmission? = null

    /** Reserve prompt exclusion before a picker acquires authority; both admissions share one lock. */
    internal fun reserveAttachment(): SessionAttachmentAdmission? = synchronized(submissionAdmission) {
        if (_sending.value || attachmentAdmission != null) null
        else SessionAttachmentAdmission().also { attachmentAdmission = it }
    }

    /** Reserve only the reviewed Session generation, under the same lock as prompt and selection admission. */
    internal fun reserveAttachment(sessionId: String, generation: Long): SessionAttachmentAdmission? = synchronized(submissionAdmission) {
        if (!matchesAttachmentTarget(sessionId, generation)) null else reserveAttachment()
    }

    /** Whether the reviewed target still names the current Session observation rather than an earlier visit. */
    internal fun matchesAttachmentTarget(sessionId: String, generation: Long): Boolean = synchronized(submissionAdmission) {
        _open.value?.sessionId == sessionId && followGeneration == generation
    }

    /** Only the exact retired operation can release its reservation. */
    internal fun releaseAttachment(admission: SessionAttachmentAdmission) = synchronized(submissionAdmission) {
        if (attachmentAdmission === admission) attachmentAdmission = null
    }

    /** Append one complete shared batch to the latest draft without changing an unconfirmed prompt intent. */
    internal fun appendSharedContent(request: NativeShareRequest, admission: SessionAttachmentAdmission,
                                     attachments: List<SessionAttachment>, maxFiles: Int): NativeShareResult = synchronized(submissionAdmission) {
        var result: NativeShareResult = NativeShareResult.NotAdopted(NativeShareIssue.STALE_TARGET)
        if (attachmentAdmission !== admission || !matchesAttachmentTarget(request.sessionId, request.selectionGeneration)) return@synchronized result
        inputs.update { current ->
            if (!matchesAttachmentTarget(request.sessionId, request.selectionGeneration)) return@update current
            val previous = current.drafts[request.sessionId]
            val existing = previous?.attachments.orEmpty()
            if (existing.size + attachments.size > maxFiles) {
                result = NativeShareResult.NotAdopted(NativeShareIssue.ATTACHMENT_FAILED, NativeFileAttachmentIssue.TOO_MANY_FILES)
                return@update current
            }
            val combined = existing + attachments
            if (combined.map { it.receiptId }.distinct().size != combined.size) {
                result = NativeShareResult.NotAdopted(NativeShareIssue.ATTACHMENT_FAILED,
                    NativeFileAttachmentIssue.INVALID_FILE, ConnectionFailure.INVALID_RESPONSE)
                return@update current
            }
            val text = listOf(previous?.text.orEmpty(), request.text).filter { it.isNotEmpty() }.joinToString("\n\n")
            val draft = SessionDraft(text, "companion-${java.util.UUID.randomUUID()}", combined)
            result = NativeShareResult.Adopted(draft.requestId, saved = false)
            current.copy(drafts = current.drafts + (request.sessionId to draft))
        }
        result
    }

    private fun publishAttachmentTarget(value: OpenSession?) = synchronized(submissionAdmission) { _open.value = value }

    /** Keep each Session's text and files independently; an unchanged intent reuses its request id. */
    fun updateDraft(sessionId: String, text: String) {
        inputs.update { current ->
            replaceDraft(current, sessionId, text, current.drafts[sessionId]?.attachments.orEmpty())
        }
        if (_sendFailure.value?.sessionId == sessionId) _sendFailure.value = null
    }

    /** Attach a staged receipt only to the currently open Session; duplicate receipts leave its intent unchanged.
     * @param sessionId Session that issued the staged receipt.
     * @param attachment Accepted Host receipt and its display metadata.
     * @return Whether this receipt was added to the selected Session's draft.
     */
    fun addAttachment(sessionId: String, attachment: SessionAttachment): Boolean {
        if (_open.value?.sessionId != sessionId) return false
        var added = false
        inputs.update { current ->
            val draft = current.drafts[sessionId]
            if (_open.value?.sessionId != sessionId || draft?.attachments?.any { it.receiptId == attachment.receiptId } == true) return@update current
            added = true
            replaceDraft(current, sessionId, draft?.text.orEmpty(), draft?.attachments.orEmpty() + attachment)
        }
        if (added && _sendFailure.value?.sessionId == sessionId) _sendFailure.value = null
        return added
    }

    /** Remove one selected Session's receipt while preserving its text and remaining files.
     * @param sessionId Session whose composer owns the receipt.
     * @param receiptId Receipt to remove from the local draft; this does not delete the Host file.
     */
    fun removeAttachment(sessionId: String, receiptId: String) {
        if (_open.value?.sessionId != sessionId) return
        inputs.update { current ->
            val draft = current.drafts[sessionId] ?: return@update current
            if (_open.value?.sessionId != sessionId) return@update current
            replaceDraft(current, sessionId, draft.text, draft.attachments.filterNot { it.receiptId == receiptId })
        }
        if (_sendFailure.value?.sessionId == sessionId) _sendFailure.value = null
    }

    private fun replaceDraft(current: CompanionInputSnapshot, sessionId: String, text: String,
                             files: List<SessionAttachment>): CompanionInputSnapshot {
        val draft = current.drafts[sessionId]
        if (draft != null && draft.text == text && draft.attachments == files) return current
        return current.copy(drafts = if (text.isEmpty() && files.isEmpty()) current.drafts - sessionId
            else current.drafts + (sessionId to SessionDraft(text, "companion-${java.util.UUID.randomUUID()}", files)))
    }

    /** Only a positive Host acknowledgement clears the exact submitted draft; newer edits survive.
     * Steer mode interrupts the running turn (or runs next-step when idle); the Host owns that decision.
     */
    suspend fun sendDraft(steer: Boolean = false): Boolean {
        val sessionId = _open.value?.sessionId ?: return false
        val draft = input.value.drafts[sessionId] ?: return false
        return submitPrompt(sessionId, draft, retainIntent = true, steer = steer)
    }

    /** Start an explicit UI submission in model lifetime so tab disposal cannot cancel its acknowledgement. */
    fun submitDraft(steer: Boolean = false): Job = scope.launch(start = CoroutineStart.UNDISPATCHED) { sendDraft(steer) }

    /** Retry the persisted original intent explicitly, even when the composer contains newer edits. */
    fun retryPrompt(requestId: String): Job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
        val pending = input.value.pendingPrompts[requestId] ?: return@launch
        submitPrompt(pending.sessionId, pending.draft, retainIntent = true)
    }

    /** Forget local input without withdrawing anything the Host may already have accepted. */
    fun discardPending(requestId: String) {
        if (_sending.value) return
        inputs.update { current ->
            val pending = current.pendingPrompts[requestId] ?: return@update current
            current.copy(pendingPrompts = current.pendingPrompts - requestId,
                drafts = if (current.drafts[pending.sessionId]?.requestId == requestId) current.drafts - pending.sessionId else current.drafts)
        }
    }

    /** Restore only a read-only observation; the saved draft is never submitted here. */
    suspend fun restoreSelection() { input.value.lastSessionId?.let { openSession(it) } }

    /** Return to the list explicitly; model retirement itself must preserve the saved viewing position. */
    suspend fun returnToList() {
        closeAndAwait()
        if (inputs.persistence.value != InputPersistenceStatus.RESTORE_FAILED) inputs.update { it.copy(lastSessionId = null) }
    }

    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending

    private val followOwner = StreamTransitionOwner(scope)
    val connectionSnapshot: ConnectionSnapshot get() = followOwner.connectionSnapshot

    /** Live follow-stream connection state for Compose observers; equals [connectionSnapshot] at rest. */
    val connectionSnapshots: StateFlow<ConnectionSnapshot> get() = followOwner.snapshots
    private var followGeneration = 0L
    /** The current Session selection's generation; reconnects preserve it and a null open Session invalidates it. */
    val selectionGeneration: Long get() = followGeneration
    private val _deliveredFiles = MutableStateFlow<List<NativeDeliveredFile>>(emptyList())
    val deliveredFiles: StateFlow<List<NativeDeliveredFile>> = _deliveredFiles
    private val _permissionPreset = MutableStateFlow<String?>(null)

    /** Latest permission preset the open session's visible records name; null until one is published. */
    val permissionPreset: StateFlow<String?> = _permissionPreset
    private val journal = NativeSessionJournal(wire, scope, historyLimits) { generation, id, records, replacement ->
        if (followOwner.isCurrent(generation)) {
            val current = _open.value
            if (current?.sessionId == id) {
                records.forEach { acknowledgeRecordedPrompt(id, it) }
                val delivered = nativeDeliveredFiles(records)
                _deliveredFiles.value = if (replacement) delivered else _deliveredFiles.value + delivered
                val preset = latestPermissionPreset(records)
                if (replacement || preset != null) _permissionPreset.value = preset
                val values = JsonArray(records.map { it.toJsonElement() })
                _open.value = current.copy(state = if (replacement) foldDomain(values) else foldInto(current.state, values))
            }
        }
    }

    /** Newest `permission/preset` in a record batch; a replacement window with none is authoritative null. */
    private fun latestPermissionPreset(records: List<WireValue>): String? = NativeLocationFacts.latestPreset(records)
    val history: StateFlow<NativeHistoryState> = journal.state
    private val _viewAnchor = MutableStateFlow<NativeViewAnchor?>(null)
    val viewAnchor: StateFlow<NativeViewAnchor?> = _viewAnchor
    private val viewRequest = AtomicReference<Deferred<Unit>?>(null)

    /** Load one older message-aligned page without moving the current Host or submitting input. */
    suspend fun loadOlderHistory(): Boolean = journal.loadOlder()

    /** Reveal a shared location on the selected trusted Host; mismatches reject before opening a stream. */
    suspend fun openViewLocation(location: NativeViewLocation, selectedHostId: String?) {
        NativeViewLocations.requireHost(location, selectedHostId)
        openSession(location.sessionId)
        val generation = followGeneration
        val request = scope.async(start = CoroutineStart.LAZY) {
            val ready = history.first { it.ready || it.failure != null }
            if (!ready.ready || !followOwner.isCurrent(generation) || !journal.loadThrough(location.anchorSeq) || !followOwner.isCurrent(generation)) {
                throw ai.deepseek.dsh.link.LinkClientException.BadWire("Session view anchor is unavailable")
            }
            _viewAnchor.value = NativeViewAnchor(generation, location.anchorSeq)
        }
        viewRequest.getAndSet(request)?.cancel()
        request.start()
        try { request.await() }
        finally {
            viewRequest.compareAndSet(request, null)
            withContext(NonCancellable) { request.cancelAndJoin() }
        }
    }

    /** The fold state of the open session, when one is. */
    val state: DomainState get() = _open.value?.state ?: DomainState()

    /** Capture one current projection without reading payloads, cached bytes or starting requests. */
    val sessionDiagnostics: SessionDiagnostics
        get() = _open.value?.let { SessionDiagnostics.Selected(SessionProjectionCounts.capture(it.state)) }
            ?: SessionDiagnostics.Unselected

    /** Serialize explicit reads through `session/list`; cancellation leaves no failure and no request retries itself. */
    suspend fun loadSessions() = listRequest.withLock {
        _listState.value = SessionListState.Loading
        try {
            val value = wire.call("session/list", mapOf("_request" to WireValue.ObjectValue(emptyMap())))
            _sessions.value = (WireShape.array(value, "items") ?: emptyList()).mapNotNull { row ->
                val id = WireShape.string(row, "sessionId") ?: return@mapNotNull null
                SessionRow(
                    id = id,
                    title = WireShape.string(row, "title") ?: "未命名会话",
                    updatedAt = WireShape.number(row, "updatedAt"),
                    cwd = WireShape.string(row, "cwd"),
                )
            }
            _listState.value = SessionListState.Ready
        } catch (cancelled: CancellationException) {
            _listState.value = SessionListState.Idle
            throw cancelled
        } catch (failure: Exception) {
            _listState.value = SessionListState.Failed(ConnectionFailure.from(failure),
                (failure as? ai.deepseek.dsh.link.LinkClientException.Refused)?.let(GatewayFailureEnvelope::from))
        }
    }

    /** Open one session: fold its follow stream from a fresh snapshot. */
    suspend fun openSession(sessionId: String) {
        if (inputs.persistence.value != InputPersistenceStatus.RESTORE_FAILED) inputs.update { it.copy(lastSessionId = sessionId) }
        _permissionPreset.value = null
        replaceFollow(
            sessionId,
            mapOf(
                "request" to WireValue.ObjectValue(
                    NativeFollowResume.sessionRequest(sessionId),
                ),
            ),
        )
    }

    /** Open one subagent child's timeline read-only by durable address. */
    suspend fun openChild(parentSessionId: String, childSessionId: String, mode: String) {
        replaceFollow(
            childSessionId,
            mapOf(
                "request" to WireValue.ObjectValue(
                    NativeFollowResume.subagentRequest(parentSessionId, childSessionId, mode),
                ),
            ),
        )
    }

    /** Request follow shutdown without suspending synchronous UI disposal. */
    fun close() {
        _deliveredFiles.value = emptyList()
        viewRequest.getAndSet(null)?.cancel()
        journal.close()
        _viewAnchor.value = null
        followOwner.stop { publishAttachmentTarget(null) }
    }

    /** Close the open session after its follow stream has fully stopped. */
    suspend fun closeAndAwait() {
        _deliveredFiles.value = emptyList()
        val view = viewRequest.getAndSet(null)
        view?.cancel()
        val reads = journal.close()
        _viewAnchor.value = null
        followOwner.stopAndAwait { publishAttachmentTarget(null) }
        withContext(NonCancellable) { reads.joinAll(); view?.join() }
    }

    private suspend fun replaceFollow(sessionId: String, payload: Map<String, WireValue>) {
        followOwner.replace(
            create = { generation ->
                viewRequest.getAndSet(null)?.cancel()
                val request = payload.getValue("request") as WireValue.ObjectValue
                val target = request.entries.getValue("address") as WireValue.ObjectValue
                synchronized(submissionAdmission) { followGeneration = generation }
                _viewAnchor.value = null
                journal.reset(generation, sessionId, target)
                follow(payload + ("request" to WireValue.ObjectValue(NativeFollowResume.withMaxMessages(
                    request.entries, historyLimits.pageMessages))), generation)
            },
            publish = { _deliveredFiles.value = emptyList(); publishAttachmentTarget(OpenSession(sessionId, DomainState())) },
            invalidate = { _deliveredFiles.value = emptyList(); publishAttachmentTarget(null) },
        )
    }

    /** Submit a new user intent in queue mode; the Host promotes inline image bytes to durable references.
     * Returns true only after a positive acknowledgement; failures remain in [sendFailure].
     * UI retries use [sendDraft] to retain the existing request identity.
     */
    suspend fun send(text: String, images: List<Pair<String, String>> = emptyList()): Boolean {
        val session = _open.value ?: return false
        return submitPrompt(session.sessionId, SessionDraft(text, "companion-${java.util.UUID.randomUUID()}"), images)
    }

    private suspend fun submitPrompt(sessionId: String, draft: SessionDraft, images: List<Pair<String, String>> = emptyList(),
                                     retainIntent: Boolean = false, steer: Boolean = false): Boolean {
        synchronized(submissionAdmission) {
            if ((draft.text.isEmpty() && draft.attachments.isEmpty() && images.isEmpty()) || attachmentAdmission != null || !sendLock.tryLock()) return false
            _sending.value = true
        }
        val requestId = draft.requestId
        _sendFailure.value = null
        try {
            if (retainIntent) {
                inputs.update { it.copy(pendingPrompts = it.pendingPrompts + (requestId to PendingPrompt(sessionId, draft))) }
                inputs.flush()
            }
            val content = buildList {
                add(WireValue.ObjectValue(mapOf("type" to WireValue.StringValue("text"), "text" to WireValue.StringValue(draft.text))))
                for (file in draft.attachments) {
                    add(WireValue.ObjectValue(mapOf("type" to WireValue.StringValue(when (file) { is SessionFileAttachment -> "file"; is SessionImageAttachment -> "staged-image" }), "receiptId" to WireValue.StringValue(file.receiptId))))
                }
                for ((base64, mediaType) in images) {
                    add(
                        WireValue.ObjectValue(
                            mapOf(
                                "type" to WireValue.StringValue("image"),
                                "mediaType" to WireValue.StringValue(mediaType),
                                "data" to WireValue.StringValue(base64),
                            ),
                        ),
                    )
                }
            }
            val acknowledgement = wire.call(
                "session/prompt",
                mapOf(
                    "request" to WireValue.ObjectValue(
                        mapOf(
                            "requestId" to WireValue.StringValue(requestId),
                            "sessionId" to WireValue.StringValue(sessionId),
                            "mode" to WireValue.StringValue(if (steer) "steer" else "queue"),
                            "content" to WireValue.ArrayValue(content),
                        ),
                    ),
                ),
            )
            if (WireShape.boolean(acknowledgement, "accepted") != true) {
                throw ai.deepseek.dsh.link.LinkClientException.BadWire("invalid prompt acknowledgement")
            }
            if (retainIntent) acknowledgePrompt(sessionId, requestId)
            return true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            _sendFailure.value = PromptSubmissionFailure(sessionId, ConnectionFailure.from(failure),
                (failure as? ai.deepseek.dsh.link.LinkClientException.Refused)?.let(GatewayFailureEnvelope::from))
            return false
        } finally {
            synchronized(submissionAdmission) { _sending.value = false; sendLock.unlock() }
        }
    }

    /** Cancel the open session's in-flight work. */
    suspend fun cancelActive() {
        val session = _open.value ?: return
        wire.call(
            "session/cancel",
            mapOf("request" to WireValue.ObjectValue(mapOf("sessionId" to WireValue.StringValue(session.sessionId)))),
        )
    }

    /** Install one Session-local model selection; the Host resolves and normalizes the route. */
    suspend fun selectModel(provider: String, model: String, reasoningEffort: String? = null) {
        val session = _open.value ?: return
        wire.call(
            "session/selectModel",
            mapOf("request" to WireValue.ObjectValue(buildMap {
                put("sessionId", WireValue.StringValue(session.sessionId))
                put("provider", WireValue.StringValue(provider))
                put("model", WireValue.StringValue(model))
                if (reasoningEffort != null) put("reasoningEffort", WireValue.StringValue(reasoningEffort))
            })),
        )
    }

    /** Read the Host-generation model catalog for the composition picker.
     * modelCatalog takes no wire arguments; the strict descriptor rejects any arg key. */
    suspend fun modelCatalog(): NativeModelCatalog {
        val value = wire.call("session/modelCatalog", emptyMap())
        val groups = (WireShape.array(value, "groups") ?: emptyList()).mapNotNull { group ->
            val id = WireShape.string(group, "id") ?: return@mapNotNull null
            val models = (WireShape.array(group, "models") ?: emptyList()).mapNotNull { entry ->
                val modelId = WireShape.string(entry, "id") ?: return@mapNotNull null
                val reasoning = WireShape.objectValue(entry, "reasoning")?.let { metadata ->
                    NativeModelReasoning(
                        efforts = (WireShape.array(metadata, "efforts") ?: emptyList()).mapNotNull { choice ->
                            val effortId = WireShape.string(choice, "id") ?: return@mapNotNull null
                            NativeEffortChoice(effortId, WireShape.string(choice, "name") ?: effortId)
                        },
                        defaultEffort = WireShape.string(metadata, "defaultEffort"),
                    )
                }
                NativeCatalogModel(modelId, WireShape.string(entry, "name") ?: modelId, reasoning)
            }
            NativeCatalogGroup(id, WireShape.string(group, "name") ?: id, models)
        }
        val default = WireShape.objectValue(value, "default")
        return NativeModelCatalog(groups,
            default?.let { WireShape.string(it, "provider") } ?: "",
            default?.let { WireShape.string(it, "model") } ?: "")
    }

    private fun follow(payload: Map<String, WireValue>, generation: Long): Job =
        scope.launch(start = CoroutineStart.LAZY) {
            while (isActive && followOwner.isCurrent(generation)) {
                followOwner.attempt(generation)
                var received = false
                try {
                    val cursor = journal.beginFollow(generation)
                    val request = payload.getValue("request") as WireValue.ObjectValue
                    val resumed = if (cursor == null) payload else payload + ("request" to
                        WireValue.ObjectValue(NativeFollowResume.withResumeCursor(request.entries, cursor)))
                    wire.stream("session/follow", resumed).collect { frame ->
                        if (followOwner.isCurrent(generation)) {
                            foldFrame(frame, generation)
                            if (!received) { followOwner.received(generation); received = true }
                        }
                    }
                    if (!received) journal.observationFailed(ai.deepseek.dsh.link.LinkClientException.BadWire("Session follow ended before snapshot"), generation)
                    followOwner.interrupted(generation, null)
                } catch (failure: CancellationException) {
                    throw failure
                } catch (failure: Exception) {
                    journal.observationFailed(failure, generation)
                    followOwner.interrupted(generation, failure)
                    if (!canReconnectObservation(failure)) return@launch
                }
                if (isActive && followOwner.isCurrent(generation)) {
                    followOwner.retrying(generation)
                    delay(reconnectDelayMillis)
                }
            }
    }

    /** The journal validates and merges snapshots, live events, and backward pages before folding. */
    private fun foldFrame(frame: WireValue, generation: Long) {
        journal.accept(frame, generation)
    }

    private fun acknowledgeRecordedPrompt(sessionId: String, record: WireValue) {
        if (WireShape.string(record, "type") != "event") return
        val event = WireShape.objectValue(record, "event") ?: return
        if (WireShape.string(event, "type") != "user/message") return
        val data = WireShape.objectValue(event, "data") ?: return
        val source = WireShape.objectValue(data, "source") ?: return
        if (WireShape.string(source, "kind") != "user") return
        val requestId = WireShape.string(source, "rpcId") ?: return
        if (input.value.pendingPrompts[requestId]?.sessionId == sessionId) acknowledgePrompt(sessionId, requestId)
    }

    private fun acknowledgePrompt(sessionId: String, requestId: String) = inputs.update { current ->
        val pending = current.pendingPrompts[requestId]?.takeIf { it.sessionId == sessionId } ?: return@update current
        current.copy(pendingPrompts = current.pendingPrompts - requestId,
            drafts = if (current.drafts[sessionId] == pending.draft) current.drafts - sessionId else current.drafts)
    }
}
