package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Disk validity and progress are separate from transport failure classification. */
enum class NativeDownloadPhase { RESTORING, PAUSED, DOWNLOADING, COMPLETE, FAILED, CHANGED, UNAVAILABLE, CLOSED }

data class NativeDownloadState(
    val phase: NativeDownloadPhase,
    val checkpoint: NativeDownloadCheckpoint? = null,
    val failure: ConnectionFailure? = null,
)

/** Owns one principal-scoped store and its fixed Session target. Restoration is local-only; explicit
 * resume re-stats before reading the first missing byte. Changed descriptors never append. The owner
 * must await close before adopting another Host or reopening the store. This controller has no
 * persisted network approval, background scheduler, or user-selected destination authority.
 */
class NativeDownloadController(
    private val wire: WireDriving,
    private val store: FileNativeDownloadStore,
    parent: CoroutineScope,
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    private val lock = Any()
    private val lifetime = SupervisorJob(parent.coroutineContext[Job])
    private val scope = CoroutineScope(parent.coroutineContext + lifetime)
    private var closed = false
    val saves = NativeResourceSaver(scope)
    private val mutableState = MutableStateFlow(NativeDownloadState(NativeDownloadPhase.RESTORING))
    val state: StateFlow<NativeDownloadState> = mutableState
    private var active: Job = scope.launch(start = CoroutineStart.LAZY) {
        try {
            val checkpoint = withContext(dispatcher) { val context = currentCoroutineContext(); store.load { context.ensureActive() } }
            publish(NativeDownloadState(if (checkpoint?.complete == true) NativeDownloadPhase.COMPLETE else NativeDownloadPhase.PAUSED, checkpoint))
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { publish(NativeDownloadState(NativeDownloadPhase.UNAVAILABLE)) }
    }.also { it.start() }

    /** Reject busy, complete, changed, corrupt or retired owners. Restoration never calls this method. */
    fun resume(): Boolean = synchronized(lock) {
        if (closed || !lifetime.isActive || !active.isCompleted || state.value.phase !in setOf(NativeDownloadPhase.PAUSED, NativeDownloadPhase.FAILED)) return false
        mutableState.value = state.value.copy(phase = NativeDownloadPhase.DOWNLOADING, failure = null)
        active = scope.launch(start = CoroutineStart.LAZY) { transfer() }.also { it.start() }
        true
    }

    /** Finish local restoration before acting on an explicit user command. */
    suspend fun awaitRestored() { val pending = synchronized(lock) { active }; pending.join() }

    /** Capture only this complete checkpoint; removal and retirement invalidate its picker approval. */
    fun prepareSave(selectionValid: () -> Boolean = { true }): NativeResourceSaveRequest? = synchronized(lock) {
        val accepted = state.value
        if (closed || !selectionValid() || accepted.phase != NativeDownloadPhase.COMPLETE) return null
        saves.prepareContent(store.target.path, "application/octet-stream", { !closed && state.value === accepted && selectionValid() },
            NativeResourceContent { write -> store.copyComplete(write) })
    }

    /** Explicit local removal never dispatches a Host mutation. Caller serializes this with selection and resume. */
    suspend fun discard() = withContext(NonCancellable) {
        pauseAndAwait()
        saves.invalidateAndAwait()
        synchronized(lock) { check(!closed); mutableState.value = NativeDownloadState(NativeDownloadPhase.RESTORING) }
        try {
            withContext(dispatcher) { store.discard() }
            publish(NativeDownloadState(NativeDownloadPhase.PAUSED))
        } catch (_: Exception) { publish(NativeDownloadState(NativeDownloadPhase.UNAVAILABLE)) }
    }

    /** Cancellation awaits request and disk completion; a committed final window can restore as complete. */
    suspend fun pauseAndAwait() {
        val pending = synchronized(lock) { active.also { if (state.value.phase == NativeDownloadPhase.DOWNLOADING) it.cancel() } }
        withContext(NonCancellable) { pending.join() }
    }

    private suspend fun transfer() {
        var checkpoint: NativeDownloadCheckpoint? = null
        try {
            try { checkpoint = withContext(dispatcher) { val context = currentCoroutineContext(); store.load { context.ensureActive() } } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { publish(NativeDownloadState(NativeDownloadPhase.UNAVAILABLE)); return }
            if (checkpoint?.complete == true) {
                publish(NativeDownloadState(NativeDownloadPhase.COMPLETE, checkpoint))
                return
            }
            val args = mapOf("workspaceFileScopeId" to WireValue.StringValue(store.target.sessionId),
                "path" to WireValue.StringValue(store.target.path))
            val observed = NativeResourceWire.descriptor(wire.call("workspaceFiles/stat", args))
            if (checkpoint != null && checkpoint.descriptor != observed) throw NativeResourceChanged()
            if (checkpoint == null) checkpoint = withContext(dispatcher) { currentCoroutineContext().ensureActive(); store.begin(observed) }
            publish(NativeDownloadState(NativeDownloadPhase.DOWNLOADING, checkpoint))
            while (!checkNotNull(checkpoint).complete) {
                currentCoroutineContext().ensureActive()
                val accepted = checkNotNull(checkpoint)
                val length = minOf(store.limits.windowBytes.toLong(), store.limits.maxBytes - accepted.receivedBytes).toInt()
                check(length > 0) { "download exceeds its byte limit without EOF" }
                val result = wire.call("workspaceFiles/readBytes", args + ("range" to WireValue.ObjectValue(mapOf(
                    "offset" to WireValue.NumberValue(accepted.receivedBytes.toDouble()), "length" to WireValue.NumberValue(length.toDouble()),
                ))))
                currentCoroutineContext().ensureActive()
                val window = NativeResourceWire.window(result, observed, accepted.receivedBytes, length)
                checkpoint = withContext(dispatcher) { currentCoroutineContext().ensureActive(); store.append(accepted, window) }
                publish(NativeDownloadState(if (checkpoint.complete) NativeDownloadPhase.COMPLETE else NativeDownloadPhase.DOWNLOADING, checkpoint))
            }
        } catch (cancelled: CancellationException) {
            publish(NativeDownloadState(NativeDownloadPhase.PAUSED, checkpoint))
            throw cancelled
        } catch (_: NativeResourceChanged) {
            publish(NativeDownloadState(NativeDownloadPhase.CHANGED, checkpoint))
        } catch (failure: Exception) {
            publish(NativeDownloadState(NativeDownloadPhase.FAILED, checkpoint, ConnectionFailure.from(failure)))
        }
    }

    private fun publish(next: NativeDownloadState) = synchronized(lock) {
        if (!closed) mutableState.value = next
    }

    /** No network call or disk access owned by this controller outlives successful retirement. */
    suspend fun closeAndAwait() {
        synchronized(lock) {
            closed = true
            mutableState.value = NativeDownloadState(NativeDownloadPhase.CLOSED)
            saves.invalidate()
            lifetime.cancel()
        }
        withContext(NonCancellable) {
            saves.invalidateAndAwait()
            lifetime.join()
            withContext(dispatcher) { store.close() }
        }
    }
}
