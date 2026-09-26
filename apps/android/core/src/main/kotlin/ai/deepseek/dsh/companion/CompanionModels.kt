package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkArtifactFormat
import ai.deepseek.dsh.link.LinkArtifactReadValue

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
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
) {
    private val _sessions = MutableStateFlow<List<SessionRow>>(emptyList())
    val sessions: StateFlow<List<SessionRow>> = _sessions

    private val listRequest = Mutex()
    private val _listState = MutableStateFlow<SessionListState>(SessionListState.Idle)
    val listState: StateFlow<SessionListState> = _listState

    private val _open = MutableStateFlow<OpenSession?>(null)
    val open: StateFlow<OpenSession?> = _open

    private val _drafts = MutableStateFlow<Map<String, SessionDraft>>(emptyMap())
    val drafts: StateFlow<Map<String, SessionDraft>> = _drafts
    private val _sendFailure = MutableStateFlow<PromptSubmissionFailure?>(null)
    val sendFailure: StateFlow<PromptSubmissionFailure?> = _sendFailure
    private val sendLock = Mutex()

    /** Keep each Session's text independently; an unchanged retry reuses its request id. */
    fun updateDraft(sessionId: String, text: String) {
        _drafts.update { current ->
            when {
                text.isEmpty() -> current - sessionId
                current[sessionId]?.text == text -> current
                else -> current + (sessionId to SessionDraft(text, "companion-${java.util.UUID.randomUUID()}"))
            }
        }
        if (_sendFailure.value?.sessionId == sessionId) _sendFailure.value = null
    }

    /** Only a positive Host acknowledgement clears the exact submitted draft; newer edits survive. */
    suspend fun sendDraft(): Boolean {
        val sessionId = _open.value?.sessionId ?: return false
        val draft = _drafts.value[sessionId] ?: return false
        val accepted = submitPrompt(sessionId, draft.text, emptyList(), draft.requestId)
        if (accepted) _drafts.update { current -> if (current[sessionId] == draft) current - sessionId else current }
        return accepted
    }

    /** Start an explicit UI submission in model lifetime so tab disposal cannot cancel its acknowledgement. */
    fun submitDraft(): Job = scope.launch(start = CoroutineStart.UNDISPATCHED) { sendDraft() }

    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending

    private val followOwner = StreamTransitionOwner(scope)
    val connectionSnapshot: ConnectionSnapshot get() = followOwner.connectionSnapshot

    /** The fold state of the open session, when one is. */
    val state: DomainState get() = _open.value?.state ?: DomainState()

    /** Capture one current projection without reading payloads, cached bytes or starting requests. */
    val sessionDiagnostics: SessionDiagnostics
        get() = _open.value?.let { SessionDiagnostics.Selected(SessionProjectionCounts.capture(it.state)) }
            ?: SessionDiagnostics.Unselected

    /** Decoded artifact content by reference id (filled by readArtifact). */
    private val _artifactBytes = mutableMapOf<String, ByteArray>()

    /** The decoded artifact content cache; companion panes render from it. */
    val artifactBytes: Map<String, ByteArray> get() = _artifactBytes

    /**
     * Read one artifact the open session references over `session/artifact`
     * and cache its decoded bytes (unbounded reads only — a paged read
     * returns its range without caching); null when no session is open, the
     * call fails, or the payload cannot be read.
     * @param artifactId the reference identity from an artifact/created row.
     * @param offset range start — UTF-16 code units for text artifacts, bytes
     *   for bytes artifacts; null starts at zero.
     * @param limit maximum returned units of the artifact format; null reads
     *   through the end.
     * @return the read value (id, kind, title, format, base64 data, truncated, size).
     */
    suspend fun readArtifact(artifactId: String, offset: Int? = null, limit: Int? = null): LinkArtifactReadValue? {
        val sessionId = _open.value?.sessionId ?: return null
        val fields = buildMap {
            put("sessionId", WireValue.StringValue(sessionId))
            put("artifactId", WireValue.StringValue(artifactId))
            offset?.let { put("offset", WireValue.NumberValue(it.toDouble())) }
            limit?.let { put("limit", WireValue.NumberValue(it.toDouble())) }
        }
        val value = try {
            wire.call("session/artifact", mapOf("request" to WireValue.ObjectValue(fields)))
        } catch (_: Exception) {
            return null
        }
        val id = WireShape.string(value, "id") ?: return null
        val kind = WireShape.string(value, "kind") ?: return null
        val title = WireShape.string(value, "title") ?: return null
        val format = WireShape.string(value, "format")
            ?.let { raw -> LinkArtifactFormat.values().firstOrNull { it.wire == raw } } ?: return null
        val data = WireShape.string(value, "data") ?: return null
        val truncated = WireShape.boolean(value, "truncated") ?: return null
        val size = WireShape.number(value, "size") ?: return null
        if (limit == null) _artifactBytes[id] = java.util.Base64.getDecoder().decode(data)
        return LinkArtifactReadValue(
            id = id,
            kind = kind,
            title = title,
            format = format,
            data = data,
            truncated = truncated,
            size = size,
        )
    }

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
        followOwner.stop { _open.value = null }
    }

    /** Close the open session after its follow stream has fully stopped. */
    suspend fun closeAndAwait() {
        followOwner.stopAndAwait { _open.value = null }
    }

    private suspend fun replaceFollow(sessionId: String, payload: Map<String, WireValue>) {
        followOwner.replace(
            create = { generation -> follow(payload, generation) },
            publish = { _open.value = OpenSession(sessionId, DomainState()) },
            invalidate = { _open.value = null },
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

    private suspend fun submitPrompt(sessionId: String, text: String, images: List<Pair<String, String>>, requestId: String): Boolean {
        if ((text.isEmpty() && images.isEmpty()) || !sendLock.tryLock()) return false
        _sending.value = true
        _sendFailure.value = null
        try {
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
                    wire.stream("session/follow", payload).collect { frame ->
                        if (followOwner.isCurrent(generation)) {
                            if (!received) { followOwner.received(generation); received = true }
                            foldFrame(frame, generation)
                        }
                    }
                    followOwner.interrupted(generation, null)
                } catch (failure: CancellationException) {
                    throw failure
                } catch (failure: Exception) {
                    followOwner.interrupted(generation, failure)
                    if (!canReconnectObservation(failure)) return@launch
                }
                if (isActive && followOwner.isCurrent(generation)) {
                    followOwner.retrying(generation)
                    delay(reconnectDelayMillis)
                }
            }
    }

    /** A snapshot generation resets and replays its records; any other
     * frame is one live event entry folded onto the current state. */
    private fun foldFrame(frame: WireValue, generation: Long) {
        if (!followOwner.isCurrent(generation)) return
        val current = _open.value ?: return
        val kind = WireShape.string(frame, "type") ?: ""
        val newState = if (kind == "snapshot") {
            val records = WireShape.array(frame, "records") ?: emptyList()
            foldDomain(JsonArray(records.map { it.toJsonElement() }))
        } else {
            foldInto(current.state, JsonArray(listOf(frame.toJsonElement())))
        }
        _open.value = current.copy(state = newState)
        if (!followOwner.isCurrent(generation)) _open.value = null
    }
}

/**
 * The subagent surface — the Kotlin mirror of the Swift
 * `SubagentsViewModel`: list one parent's direct children, open a child's
 * timeline read-only.
 */
class SubagentsModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    private val _rows = MutableStateFlow<List<SubagentRow>>(emptyList())
    val rows: StateFlow<List<SubagentRow>> = _rows

    private val _listState = MutableStateFlow("idle")
    val listState: StateFlow<String> = _listState

    /** The open child timeline, when one is. */
    private val _childTimeline = MutableStateFlow<SessionModel?>(null)
    val childTimeline: StateFlow<SessionModel?> = _childTimeline

    suspend fun load(parentSessionId: String) {
        _listState.value = "loading"
        try {
            val value = wire.call("subagents/list", mapOf("parentSessionId" to WireValue.StringValue(parentSessionId)))
            _rows.value = (WireShape.array(value, "entries") ?: emptyList()).mapNotNull { entry ->
                val id = WireShape.string(entry, "id") ?: return@mapNotNull null
                SubagentRow(
                    id = id,
                    mode = WireShape.string(entry, "mode"),
                    label = WireShape.string(entry, "label"),
                    activity = WireShape.string(entry, "activity"),
                    reason = WireShape.string(entry, "reason"),
                )
            }
            _listState.value = "ready"
        } catch (failure: Exception) {
            _listState.value = "failed:${failure.message}"
        }
    }

    /** Open one child's read-only timeline; a diagnostic row has no mode
     * and no timeline to open. */
    suspend fun openChild(parentSessionId: String, row: SubagentRow) {
        val mode = row.mode ?: return
        val child = SessionModel(wire, scope)
        _childTimeline.value = child
        child.openChild(parentSessionId = parentSessionId, childSessionId = row.id, mode = mode)
    }

    fun closeChild() {
        _childTimeline.value?.close()
        _childTimeline.value = null
    }
}
