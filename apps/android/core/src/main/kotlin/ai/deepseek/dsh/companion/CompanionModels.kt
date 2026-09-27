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

/** One session row in the list. */
data class SessionRow(val id: String, val title: String, val updatedAt: Double?)

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

    val connectionSnapshot: ConnectionSnapshot get() = observation.get().snapshot

    fun isCurrent(value: Long): Boolean = observation.get().generation == value

    private fun advanceGeneration(state: ConnectionState): Long = observation.updateAndGet {
        Observation(it.generation + 1, it.snapshot.copy(state = state, lastFailure = null))
    }.generation

    private fun update(value: Long, change: (ConnectionSnapshot) -> ConnectionSnapshot) {
        observation.updateAndGet {
            if (it.generation != value || it.snapshot.state == ConnectionState.STOPPING || it.snapshot.state == ConnectionState.STOPPED) it
            else it.copy(snapshot = change(it.snapshot))
        }
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

    /** Keep each Session's text independently; an unchanged retry reuses its request id. */
    fun updateDraft(sessionId: String, text: String) {
        inputs.update { current ->
            current.copy(drafts = when {
                text.isEmpty() -> current.drafts - sessionId
                current.drafts[sessionId]?.text == text -> current.drafts
                else -> current.drafts + (sessionId to SessionDraft(text, "companion-${java.util.UUID.randomUUID()}"))
            })
        }
        if (_sendFailure.value?.sessionId == sessionId) _sendFailure.value = null
    }

    /** Only a positive Host acknowledgement clears the exact submitted draft; newer edits survive. */
    suspend fun sendDraft(): Boolean {
        val sessionId = _open.value?.sessionId ?: return false
        val draft = input.value.drafts[sessionId] ?: return false
        return submitPrompt(sessionId, draft.text, emptyList(), draft.requestId, retainIntent = true)
    }

    /** Start an explicit UI submission in model lifetime so tab disposal cannot cancel its acknowledgement. */
    fun submitDraft(): Job = scope.launch(start = CoroutineStart.UNDISPATCHED) { sendDraft() }

    /** Retry the persisted original intent explicitly, even when the composer contains newer edits. */
    fun retryPrompt(requestId: String): Job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
        val pending = input.value.pendingPrompts[requestId] ?: return@launch
        submitPrompt(pending.sessionId, pending.draft.text, emptyList(), requestId, retainIntent = true)
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
    private var followGeneration = 0L
    private val _deliveredFiles = MutableStateFlow<List<NativeDeliveredFile>>(emptyList())
    val deliveredFiles: StateFlow<List<NativeDeliveredFile>> = _deliveredFiles
    private val journal = NativeSessionJournal(wire, scope, historyLimits) { generation, id, records, replacement ->
        if (followOwner.isCurrent(generation)) {
            val current = _open.value
            if (current?.sessionId == id) {
                records.forEach { acknowledgeRecordedPrompt(id, it) }
                val delivered = nativeDeliveredFiles(records)
                _deliveredFiles.value = if (replacement) delivered else _deliveredFiles.value + delivered
                val values = JsonArray(records.map { it.toJsonElement() })
                _open.value = current.copy(state = if (replacement) foldDomain(values) else foldInto(current.state, values))
            }
        }
    }
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
        replaceFollow(
            sessionId,
            mapOf(
                "request" to WireValue.ObjectValue(
                    mapOf(
                        "address" to WireValue.ObjectValue(
                            mapOf("kind" to WireValue.StringValue("session"), "sessionId" to WireValue.StringValue(sessionId)),
                        ),
                    ),
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
                    mapOf(
                        "address" to WireValue.ObjectValue(
                            mapOf(
                                "kind" to WireValue.StringValue("subagent"),
                                "parentSessionId" to WireValue.StringValue(parentSessionId),
                                "childSessionId" to WireValue.StringValue(childSessionId),
                                "mode" to WireValue.StringValue(mode),
                            ),
                        ),
                    ),
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
        followOwner.stop { _open.value = null }
    }

    /** Close the open session after its follow stream has fully stopped. */
    suspend fun closeAndAwait() {
        _deliveredFiles.value = emptyList()
        val view = viewRequest.getAndSet(null)
        view?.cancel()
        val reads = journal.close()
        _viewAnchor.value = null
        followOwner.stopAndAwait { _open.value = null }
        withContext(NonCancellable) { reads.joinAll(); view?.join() }
    }

    private suspend fun replaceFollow(sessionId: String, payload: Map<String, WireValue>) {
        followOwner.replace(
            create = { generation ->
                viewRequest.getAndSet(null)?.cancel()
                val request = payload.getValue("request") as WireValue.ObjectValue
                val target = request.entries.getValue("address") as WireValue.ObjectValue
                followGeneration = generation
                _viewAnchor.value = null
                journal.reset(generation, sessionId, target)
                follow(payload + ("request" to WireValue.ObjectValue(request.entries +
                    ("maxMessages" to WireValue.NumberValue(historyLimits.pageMessages.toDouble())))), generation)
            },
            publish = { _deliveredFiles.value = emptyList(); _open.value = OpenSession(sessionId, DomainState()) },
            invalidate = { _deliveredFiles.value = emptyList(); _open.value = null },
        )
    }

    /** Submit a new user intent in queue mode; the Host promotes inline image bytes to durable references.
     * Returns true only after a positive acknowledgement; failures remain in [sendFailure].
     * UI retries use [sendDraft] to retain the existing request identity.
     */
    suspend fun send(text: String, images: List<Pair<String, String>> = emptyList()): Boolean {
        val session = _open.value ?: return false
        return submitPrompt(session.sessionId, text, images, "companion-${java.util.UUID.randomUUID()}")
    }

    private suspend fun submitPrompt(sessionId: String, text: String, images: List<Pair<String, String>>, requestId: String,
                                     retainIntent: Boolean = false): Boolean {
        if ((text.isEmpty() && images.isEmpty()) || !sendLock.tryLock()) return false
        _sending.value = true
        _sendFailure.value = null
        try {
            if (retainIntent) {
                inputs.update { it.copy(pendingPrompts = it.pendingPrompts + (requestId to PendingPrompt(sessionId, SessionDraft(text, requestId)))) }
                inputs.flush()
            }
            val content = buildList {
                add(WireValue.ObjectValue(mapOf("type" to WireValue.StringValue("text"), "text" to WireValue.StringValue(text))))
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
                            "mode" to WireValue.StringValue("queue"),
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
            _sending.value = false
            sendLock.unlock()
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

    private fun follow(payload: Map<String, WireValue>, generation: Long): Job =
        scope.launch(start = CoroutineStart.LAZY) {
            while (isActive && followOwner.isCurrent(generation)) {
                followOwner.attempt(generation)
                var received = false
                try {
                    val cursor = journal.beginFollow(generation)
                    val request = payload.getValue("request") as WireValue.ObjectValue
                    val resumed = if (cursor == null) payload else payload + ("request" to
                        WireValue.ObjectValue(request.entries + ("fromSeq" to WireValue.NumberValue(cursor.toDouble()))))
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
        if (current.pendingPrompts[requestId]?.sessionId != sessionId) return@update current
        current.copy(pendingPrompts = current.pendingPrompts - requestId,
            drafts = if (current.drafts[sessionId]?.requestId == requestId) current.drafts - sessionId else current.drafts)
    }
}
