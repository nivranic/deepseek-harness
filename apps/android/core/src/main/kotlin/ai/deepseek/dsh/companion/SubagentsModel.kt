package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap

/** Catalog progress is independent of cached rows and the Host's live-parent hint. */
sealed interface SubagentListState {
    data object Idle : SubagentListState
    data object Loading : SubagentListState
    data object Ready : SubagentListState
    data class Failed(val failure: ConnectionFailure) : SubagentListState
}

/** Rows belong to exactly one selected parent; parentAvailable describes a live Agent, not readable history. */
data class SubagentListing(
    val parentSessionId: String? = null,
    val state: SubagentListState = SubagentListState.Idle,
    val rows: List<SubagentRow> = emptyList(),
    val parentAvailable: Boolean? = null,
)

/** Read-only access to a parent-addressed child's bounded Session history. A retired view cannot restart work. */
class SubagentTimeline internal constructor(
    val parentSessionId: String,
    val row: SubagentRow,
    wire: WireDriving,
    parentScope: CoroutineScope,
) {
    private val lifetime = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + lifetime)
    private val model = SessionModel(wire, scope)
    val open: StateFlow<OpenSession?> = model.open
    val history: StateFlow<NativeHistoryState> = model.history

    /** Reopen only this child's durable read address; no prompt or control endpoint is exposed. */
    suspend fun reconnect() {
        lifetime.ensureActive()
        model.openChild(parentSessionId, row.id, checkNotNull(row.mode))
    }

    /** Read an older page within the current observation's fixed log cut. */
    suspend fun loadOlderHistory(): Boolean {
        lifetime.ensureActive()
        return model.loadOlderHistory()
    }

    internal fun close() { lifetime.cancel(); model.close() }
    internal suspend fun closeAndAwait() {
        close()
        withContext(NonCancellable) { model.closeAndAwait(); lifetime.join() }
    }
}

/** Owns one selected parent's catalog and one child observation, with cancellable reads and awaited replacement. */
class SubagentsModel(private val wire: WireDriving, parentScope: CoroutineScope) {
    private val lifetime = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + lifetime)
    private val lock = Any()
    private val transition = Mutex()
    private val childOwner = StreamTransitionOwner(scope)
    private val reads = ConcurrentHashMap.newKeySet<Deferred<WireValue>>()
    private var sequence = 0L
    private var pending: Deferred<WireValue>? = null
    private var closed = false
    private val mutableListing = MutableStateFlow(SubagentListing())
    val listing: StateFlow<SubagentListing> = mutableListing
    private val mutableChild = MutableStateFlow<SubagentTimeline?>(null)
    val childTimeline: StateFlow<SubagentTimeline?> = mutableChild

    /** Select the application's actual parent and retire old reads and child work before returning. */
    suspend fun selectParent(parentSessionId: String?) = transition.withLock {
        val previous = synchronized(lock) {
            if (closed || listing.value.parentSessionId == parentSessionId) return@withLock
            val previous = reads.toList()
            sequence++
            pending = null
            mutableListing.value = SubagentListing(parentSessionId)
            previous
        }
        previous.forEach { it.cancel() }
        withContext(NonCancellable) {
            childOwner.stopAndAwait(::invalidateChild)
            previous.joinAll()
        }
    }

    /** Refresh only the selected parent; superseded responses cannot replace a newer parent or refresh. */
    suspend fun refresh() {
        val (generation, parent, request, previous) = synchronized(lock) {
            if (closed) return
            val parent = listing.value.parentSessionId ?: return
            val previous = pending
            val generation = ++sequence
            val request = scope.async(start = CoroutineStart.LAZY) {
                wire.call("subagents/list", mapOf("parentSessionId" to WireValue.StringValue(parent)))
            }
            reads.add(request)
            request.invokeOnCompletion { reads.remove(request) }
            pending = request
            mutableListing.value = listing.value.copy(state = SubagentListState.Loading)
            CatalogRequest(generation, parent, request, previous)
        }
        previous?.cancel()
        request.start()
        try {
            val value = request.await()
            val rows = parseRows(value)
            val available = WireShape.boolean(value, "parentAvailable") ?: invalid("parent availability is missing")
            synchronized(lock) {
                if (!closed && sequence == generation) mutableListing.value = SubagentListing(parent, SubagentListState.Ready, rows, available)
            }
        } catch (cancelled: CancellationException) {
            synchronized(lock) {
                if (!closed && sequence == generation) mutableListing.value = listing.value.copy(state = SubagentListState.Idle)
            }
            throw cancelled
        } catch (failure: Exception) {
            synchronized(lock) {
                if (!closed && sequence == generation) mutableListing.value = listing.value.copy(state = SubagentListState.Failed(ConnectionFailure.from(failure)))
            }
        } finally {
            withContext(NonCancellable) { request.cancelAndJoin() }
            synchronized(lock) { if (pending === request) pending = null }
        }
    }

    /** Open a row from the specified current parent. Stale callbacks and diagnostic rows return false without I/O. */
    suspend fun openChild(parentSessionId: String, childSessionId: String): Boolean = transition.withLock {
        val row = synchronized(lock) {
            if (closed || listing.value.parentSessionId != parentSessionId) return@withLock false
            listing.value.rows.find { it.id == childSessionId && it.mode != null } ?: return@withLock false
        }
        val child = SubagentTimeline(parentSessionId, row, wire, scope)
        try {
            childOwner.replace(
                create = { scope.launch(start = CoroutineStart.LAZY) {
                    try { child.reconnect(); awaitCancellation() }
                    finally { child.closeAndAwait() }
                } },
                publish = { synchronized(lock) { if (!closed) mutableChild.value = child } },
                invalidate = ::invalidateChild,
            )
            mutableChild.value === child
        } finally {
            if (mutableChild.value !== child) child.closeAndAwait()
        }
    }

    /** Return to the catalog only after the current child's requests have retired. */
    suspend fun closeChildAndAwait() = transition.withLock { childOwner.stopAndAwait(::invalidateChild) }

    private fun invalidateChild() {
        mutableChild.value?.close()
        mutableChild.value = null
    }

    /** Invalidate publications synchronously; [closeAndAwait] completes retirement. */
    fun close() {
        synchronized(lock) {
            closed = true
            sequence++
            pending = null
            mutableListing.value = SubagentListing()
        }
        reads.toList().forEach { it.cancel() }
        childOwner.stop(::invalidateChild)
        lifetime.cancel()
    }

    /** Await catalog cancellation and every child replacement, including a transition already in progress. */
    suspend fun closeAndAwait() {
        close()
        withContext(NonCancellable) {
            transition.withLock { childOwner.stopAndAwait(::invalidateChild) }
            reads.toList().joinAll()
            lifetime.join()
        }
    }

    private data class CatalogRequest(val generation: Long, val parent: String, val request: Deferred<WireValue>, val previous: Deferred<WireValue>?)

    private fun parseRows(value: WireValue): List<SubagentRow> {
        val rows = WireShape.array(value, "entries") ?: invalid("catalog entries are missing")
        val ids = mutableSetOf<String>()
        return rows.map { row ->
            val id = WireShape.string(row, "id")?.takeIf(String::isNotBlank) ?: invalid("child identity is missing")
            if (!ids.add(id)) invalid("duplicate child identity")
            when (WireShape.string(row, "kind")) {
                "child" -> {
                    val mode = WireShape.string(row, "mode")?.takeIf { it in setOf("one-shot", "continuable") } ?: invalid("child mode is invalid")
                    val activity = WireShape.string(row, "activity")?.takeIf { it in setOf("running", "inactive") } ?: invalid("child activity is invalid")
                    val label = WireShape.string(row, "label")
                    if (mode == "continuable" && label == null) invalid("continuable label is missing")
                    SubagentRow(id, mode, label, activity, null)
                }
                "diagnostic" -> {
                    val reason = WireShape.string(row, "reason")?.takeIf { it in setOf("corrupt", "unsupported", "unavailable") } ?: invalid("diagnostic reason is invalid")
                    SubagentRow(id, null, null, null, reason)
                }
                else -> invalid("catalog entry kind is invalid")
            }
        }
    }

    private fun invalid(message: String): Nothing = throw LinkClientException.BadWire(message)
}
