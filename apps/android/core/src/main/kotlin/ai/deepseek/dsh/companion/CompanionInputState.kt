package ai.deepseek.dsh.companion

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The visible durability state distinguishes unsaved edits from an unreadable document kept for recovery. */
enum class InputPersistenceStatus { MEMORY_ONLY, SAVED, SAVING, WRITE_FAILED, RESTORE_FAILED }

/** A fixed public failure message; private filesystem and cipher failures stay in the cause. */
class InputPersistenceException(cause: Throwable? = null) : Exception("local input storage is unavailable", cause)

/** One principal's input state. Writes coalesce; explicit mutations can await a durable checkpoint before dispatch. */
class CompanionInputState private constructor(
    initial: CompanionInputSnapshot,
    private val store: CompanionInputStoring?,
    scope: CoroutineScope?,
    private val dispatcher: CoroutineDispatcher,
    restoreFailed: Boolean,
) {
    private val lock = Any()
    private val writeLock = Mutex()
    private var generation = 0L
    private var persisted = 0L
    private var blocked = restoreFailed
    private var closing = false
    private val _state = MutableStateFlow(initial)
    val state: StateFlow<CompanionInputSnapshot> = _state
    private val _persistence = MutableStateFlow(when {
        restoreFailed -> InputPersistenceStatus.RESTORE_FAILED
        store == null -> InputPersistenceStatus.MEMORY_ONLY
        else -> InputPersistenceStatus.SAVED
    })
    val persistence: StateFlow<InputPersistenceStatus> = _persistence
    private val updates = Channel<Unit>(Channel.CONFLATED)
    private val writer = scope?.launch {
        for (ignored in updates) {
            try { flush() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: InputPersistenceException) {
                // flush published the fixed failure state; a new edit or explicit retry requests the next write.
            }
        }
    }

    /** Publish an in-memory edit and schedule durability; an unreadable snapshot requires explicit recovery first. */
    fun update(transform: (CompanionInputSnapshot) -> CompanionInputSnapshot) = synchronized(lock) {
        if (blocked || closing) throw InputPersistenceException()
        if (store != null && writer?.isActive != true) throw InputPersistenceException()
        val next = transform(_state.value)
        if (next == _state.value) return@synchronized
        generation++
        _state.value = next
        if (store != null) {
            _persistence.value = InputPersistenceStatus.SAVING
            updates.trySend(Unit).getOrThrow()
        }
    }

    /** Wait until all edits visible at entry are durable. Later edits remain separately marked as saving. */
    suspend fun flush() {
        val target = synchronized(lock) {
            if (blocked || closing) throw InputPersistenceException()
            generation
        }
        val destination = store ?: return
        writeLock.withLock {
            val snapshot = synchronized(lock) {
                if (persisted >= target) return
                generation to _state.value
            }
            try {
                withContext(dispatcher) { destination.save(snapshot.second) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                synchronized(lock) { _persistence.value = InputPersistenceStatus.WRITE_FAILED }
                throw InputPersistenceException(failure)
            }
            synchronized(lock) {
                persisted = snapshot.first
                _persistence.value = if (persisted == generation) InputPersistenceStatus.SAVED else InputPersistenceStatus.SAVING
            }
        }
    }

    /** Explicit recovery keeps the unreadable bytes and publishes empty input only after its replacement is durable. */
    suspend fun startFresh() {
        val destination = store ?: return
        writeLock.withLock {
            synchronized(lock) { check(blocked && !closing) { "input restoration is not awaiting recovery" } }
            currentCoroutineContext().ensureActive()
            withContext(NonCancellable) {
                try { withContext(dispatcher) { destination.preserveAndStartFresh() } }
                catch (failure: Exception) { throw InputPersistenceException(failure) }
                synchronized(lock) {
                    blocked = false
                    generation++
                    persisted = generation
                    _state.value = CompanionInputSnapshot()
                    _persistence.value = InputPersistenceStatus.SAVED
                }
            }
        }
    }

    /** Retire after producers have stopped and their checkpoint has completed; this performs no recovery or replacement. */
    suspend fun retireAndAwait() = withContext(NonCancellable) {
        synchronized(lock) { closing = true }
        updates.close()
        writer?.join()
    }

    companion object {
        /** Tests and non-application consumers can own input without claiming disk durability. */
        fun memory(): CompanionInputState = CompanionInputState(CompanionInputSnapshot(), null, null, Dispatchers.IO, false)

        /** Restore one principal without replacing unreadable bytes or submitting a business operation. */
        suspend fun restore(store: CompanionInputStoring, scope: CoroutineScope,
                            dispatcher: CoroutineDispatcher = Dispatchers.IO): CompanionInputState {
            return try {
                val snapshot = withContext(dispatcher) { store.load() ?: CompanionInputSnapshot() }
                CompanionInputState(snapshot, store, scope, dispatcher, false)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { CompanionInputState(CompanionInputSnapshot(), store, scope, dispatcher, true) }
        }
    }
}
