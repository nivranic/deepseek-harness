package ai.deepseek.dsh.companion

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** A complete source copied in bounded chunks. Consumers must discard their output if copying fails. */
class NativeResourceContent internal constructor(private val copy: ((ByteArray) -> Unit) -> Unit) {
    fun copyTo(write: (ByteArray) -> Unit) = copy(write)
}

/** A newly created, user-selected document. Both methods return only after their I/O has closed. */
interface NativeResourceSaveDestination {
    fun write(content: NativeResourceContent)
    fun discard()
}

enum class NativeResourceSavePhase { IDLE, CHOOSING, SAVING, RETIRING, SAVED, CANCELLED, EXPIRED, FAILED, CLEANUP_FAILED }

/** Memory-only selection consumed once by a system-picker result; it cannot survive process restoration. */
class NativeResourceSaveRequest internal constructor(val filename: String, val mediaType: String) {
    internal val consumed = AtomicBoolean()
    internal val outcome = AtomicReference<NativeResourceSavePhase?>(null)
    /** Includes failed cleanup even if Host retirement cancelled the caller's save. */
    val result: NativeResourceSavePhase? get() = outcome.get()
}

/** Saves only complete accepted bytes. Selection changes cancel owned writes and reject late picker results. */
class NativeResourceSaver(private val scope: CoroutineScope, private val current: () -> NativeResourceState? = { null }) {
    private data class Selection(val request: NativeResourceSaveRequest, val valid: () -> Boolean, val content: NativeResourceContent)
    private val lock = Any()
    private var generation = 0L
    private var pending: Selection? = null
    private val jobs = ConcurrentHashMap.newKeySet<Deferred<NativeResourceSavePhase>>()
    private val mutablePhase = MutableStateFlow(NativeResourceSavePhase.IDLE)
    val phase: StateFlow<NativeResourceSavePhase> = mutablePhase

    /** Capture this exact READY observation before opening a picker; partial previews never qualify. */
    fun prepare(source: NativeResourceState): NativeResourceSaveRequest? = synchronized(lock) {
        if (scope.coroutineContext[Job]?.isActive == false || pending != null || jobs.isNotEmpty() || current() !== source) return null
        if (source.phase != NativeResourcePhase.READY) return null
        val content = source.content ?: return null
        if (source.descriptor == null || source.receivedBytes != content.size) return null
        val bytes = content.copyOf()
        val type = nativeResourceMedia(bytes) ?: if (nativeResourceText(bytes) != null) "text/plain" else "application/octet-stream"
        prepareContent(source.target.path, type, { current() === source }, NativeResourceContent { it(bytes) })
    }

    /** Own one complete disk source without retaining its bytes or persisting a destination approval. */
    internal fun prepareContent(path: String, mediaType: String, valid: () -> Boolean,
                                content: NativeResourceContent): NativeResourceSaveRequest? = synchronized(lock) {
        if (scope.coroutineContext[Job]?.isActive == false || pending != null || jobs.isNotEmpty() || !valid()) return null
        val name = path.substringAfterLast('/').substringAfterLast('\\')
            .filterNot { it.code < 32 || it.code == 127 }.takeIf { it.isNotBlank() && it !in setOf(".", "..") } ?: "download"
        val request = NativeResourceSaveRequest(name, mediaType)
        pending = Selection(request, valid, content)
        mutablePhase.value = NativeResourceSavePhase.CHOOSING
        request
    }

    /** Consume a picker result once. A cancelled picker has no destination; expired results discard only their new document. */
    suspend fun save(request: NativeResourceSaveRequest, destination: NativeResourceSaveDestination?): NativeResourceSavePhase {
        if (!request.consumed.compareAndSet(false, true)) return NativeResourceSavePhase.EXPIRED
        val task = synchronized(lock) {
            val captured = pending?.takeIf { it.request === request && it.valid() }
            if (pending?.request === request) pending = null
            val stamp = generation
            if (captured != null) mutablePhase.value = NativeResourceSavePhase.SAVING
            // UNDISPATCHED enters finally even when Host retirement has already cancelled the parent scope.
            val task = scope.async(start = CoroutineStart.UNDISPATCHED) {
                var completed = false
                var result = if (captured == null) NativeResourceSavePhase.EXPIRED else NativeResourceSavePhase.FAILED
                try {
                    if (captured != null) {
                        if (destination == null) result = NativeResourceSavePhase.CANCELLED
                        else {
                            yield()
                            synchronized(lock) {
                                if (generation != stamp || !captured.valid()) throw CancellationException("resource selection retired")
                            }
                            withContext(Dispatchers.IO) {
                                val context = currentCoroutineContext()
                                context.ensureActive()
                                destination.write(NativeResourceContent { write ->
                                    captured.content.copyTo { bytes -> context.ensureActive(); write(bytes) }
                                })
                            }
                            currentCoroutineContext().ensureActive()
                            synchronized(lock) {
                                if (generation != stamp || !captured.valid()) throw CancellationException("resource selection retired")
                                completed = true
                                result = NativeResourceSavePhase.SAVED
                            }
                        }
                    }
                } catch (cancelled: CancellationException) {
                    result = NativeResourceSavePhase.CANCELLED
                    throw cancelled
                } catch (_: Exception) {
                    result = NativeResourceSavePhase.FAILED
                } finally {
                    withContext(NonCancellable) {
                        if (!completed && destination != null) withContext(Dispatchers.IO) {
                            try { destination.discard() }
                            catch (_: Exception) { result = NativeResourceSavePhase.CLEANUP_FAILED }
                        }
                        request.outcome.set(result)
                        synchronized(lock) {
                            if (captured != null && generation == stamp) mutablePhase.value = result
                        }
                    }
                }
                result
            }
            jobs.add(task)
            task.invokeOnCompletion {
                synchronized(lock) {
                    jobs.remove(task)
                    if (jobs.isEmpty() && phase.value == NativeResourceSavePhase.RETIRING) mutablePhase.value = NativeResourceSavePhase.IDLE
                }
            }
            if (generation != stamp) task.cancel()
            task
        }
        try { return task.await() }
        finally { withContext(NonCancellable) { task.join() } }
    }

    /** Invalidate pending selection immediately and retain every cancelled write until cleanup finishes. */
    fun invalidate(): List<Job> = synchronized(lock) {
        generation++
        pending = null
        val retiring = jobs.toList()
        mutablePhase.value = if (retiring.isEmpty()) NativeResourceSavePhase.IDLE else NativeResourceSavePhase.RETIRING
        retiring.forEach { it.cancel() }
        retiring
    }

    /** Await destination cleanup before another Host model is adopted. */
    suspend fun invalidateAndAwait() {
        val retiring = invalidate()
        withContext(NonCancellable) { retiring.joinAll() }
    }

}
