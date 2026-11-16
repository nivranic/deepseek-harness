package ai.deepseek.dsh.companion

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Selection restoration is local-only; no partial or complete content is a persisted save approval. */
data class NativeDownloadSelection(val target: NativeResourceTarget? = null, val controller: NativeDownloadController? = null,
                                   val busy: Boolean = false, val failed: Boolean = false)

/** One resource's download controls within a Host model. Replacement awaits the previous transfer and export;
 * retained bytes remain principal-scoped on disk until explicit removal. All commands use this model's wire.
 */
class NativeDownloadsModel(private val wire: WireDriving, private val files: NativeDownloadFiles?, parent: CoroutineScope,
                           private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
                           private val selected: (NativeResourceTarget) -> Boolean = { true }) {
    private val lifetime = SupervisorJob(parent.coroutineContext[Job])
    private val scope = CoroutineScope(parent.coroutineContext + lifetime)
    private val transition = Mutex()
    private val lock = Any()
    private var closed = false
    private var current: NativeDownloadController? = null
    private var retiring: Deferred<Unit>? = null
    private val mutableState = MutableStateFlow(NativeDownloadSelection())
    val state: StateFlow<NativeDownloadSelection> = mutableState
    val available get() = files != null

    suspend fun select(target: NativeResourceTarget?) = owned {
        transition.withLock {
            if (state.value.target == target) return@withLock
            publish(NativeDownloadSelection(target, busy = true))
            val previous = current
            current = null
            previous?.closeAndAwait()
            try {
                if (target != null && files != null && withContext(dispatcher) { files.exists(target) }) current = open(target)
                publish(NativeDownloadSelection(target, current))
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { publish(NativeDownloadSelection(target, failed = true)) }
        }
    }

    /** An explicit download or continuation reads only the selected resource. */
    suspend fun resume(target: NativeResourceTarget) = command(target) {
        val owner = current ?: open(target).also { current = it }
        owner.awaitRestored()
        owner.resume()
    }

    suspend fun pause(target: NativeResourceTarget) = command(target) { current?.pauseAndAwait() }
    suspend fun discard(target: NativeResourceTarget) = command(target) {
        current?.let { owner ->
            owner.discard()
            if (owner.state.value.phase != NativeDownloadPhase.UNAVAILABLE) { owner.closeAndAwait(); current = null }
        }
    }

    private suspend fun command(target: NativeResourceTarget, action: suspend () -> Unit) = owned {
        transition.withLock {
            if (state.value.target != target || !selected(target) || files == null) return@withLock
            publish(state.value.copy(busy = true, failed = false))
            try { action(); publish(NativeDownloadSelection(target, current)) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { publish(NativeDownloadSelection(target, current, failed = true)) }
            finally { publish(state.value.copy(controller = current, busy = false)) }
        }
    }

    fun prepareSave(target: NativeResourceTarget): Pair<NativeResourceSaveRequest, NativeResourceSaver>? = synchronized(lock) {
        val selection = state.value
        if (closed || selection.target != target || !selected(target) || selection.busy) return null
        val owner = selection.controller ?: return null
        owner.prepareSave { state.value.target == target && selected(target) }?.let { it to owner.saves }
    }

    private suspend fun open(target: NativeResourceTarget): NativeDownloadController {
        var candidate: FileNativeDownloadStore? = null
        try {
            withContext(dispatcher) { candidate = checkNotNull(files).open(target) }
            currentCoroutineContext().ensureActive()
            return NativeDownloadController(wire, checkNotNull(candidate), scope, dispatcher).also { candidate = null }
        } finally {
            // No suspension may follow ownership transfer: prompt cancellation would lose the returned controller.
            if (candidate != null) withContext(NonCancellable + dispatcher) { candidate?.close() }
        }
    }

    private suspend fun <T> owned(action: suspend () -> T): T {
        val task = scope.async { action() }
        try { return task.await() }
        finally { withContext(NonCancellable) { task.cancelAndJoin() } }
    }

    private fun publish(value: NativeDownloadSelection) = synchronized(lock) { if (!closed) mutableState.value = value }

    /** Starts awaited cleanup even when ViewModel.onCleared has already cancelled its parent scope. */
    fun close(): Deferred<Unit> = synchronized(lock) {
        retiring?.let { return it }
        closed = true
        mutableState.value = NativeDownloadSelection()
        lifetime.cancel()
        scope.async(NonCancellable, start = CoroutineStart.LAZY) {
            lifetime.join()
            current?.closeAndAwait()
            current = null
        }.also { retiring = it; it.start() }
    }

    suspend fun closeAndAwait() { withContext(NonCancellable) { close().await() } }
}
