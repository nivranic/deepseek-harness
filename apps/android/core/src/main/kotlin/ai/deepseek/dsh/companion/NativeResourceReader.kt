package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Application-selected byte windows, retained content budget, and large-file preview size. */
data class NativeResourceLimits(val windowBytes: Int, val maxBufferedBytes: Int, val previewBytes: Int) {
    init { require(previewBytes > 0 && windowBytes >= previewBytes && maxBufferedBytes >= windowBytes) }
}

/** Current workspaceFiles stat fields; the Session scope remains the authority for file access. */
data class NativeFileDescriptor(val absolutePath: String, val version: String, val bytes: Long?)

/** Explicit resource selection; a path never supplies a Host identity or device grant. */
data class NativeResourceTarget(val sessionId: String, val path: String)

enum class NativeResourcePhase { LOADING, READY, PREVIEW, FAILED, CHANGED }

/** Published content is bounded; PREVIEW never represents a complete download. */
data class NativeResourceState(
    val target: NativeResourceTarget,
    val phase: NativeResourcePhase,
    val descriptor: NativeFileDescriptor? = null,
    val receivedBytes: Int = 0,
    val prefix: ByteArray = byteArrayOf(),
    val content: ByteArray? = null,
    val failure: ConnectionFailure? = null,
)

/** Sequential Session-scoped byte reads with explicit same-version retry and quiescent retirement.
 * Replacing or closing a selection cancels its reads; late responses cannot publish into a new selection.
 * Files larger than the retention budget expose only a bounded prefix. Version changes discard all bytes.
 */
class NativeResourceReader(private val wire: WireDriving, private val scope: CoroutineScope,
                           private val limits: NativeResourceLimits) {
    private val lock = Any()
    private var generation = 0L
    private var active: Job? = null
    private val jobs = ConcurrentHashMap.newKeySet<Job>()
    private var chunks = mutableListOf<ByteArray>()
    private val mutableState = MutableStateFlow<NativeResourceState?>(null)
    val state: StateFlow<NativeResourceState?> = mutableState
    val saves = NativeResourceSaver(scope) { state.value }

    /** Begin a fresh observation without carrying bytes from another selection. */
    fun open(sessionId: String, path: String) = synchronized(lock) {
        saves.invalidate()
        require(sessionId.isNotBlank() && path.isNotBlank())
        generation++
        active?.cancel()
        chunks = mutableListOf()
        mutableState.value = NativeResourceState(NativeResourceTarget(sessionId, path), NativeResourcePhase.LOADING)
        start(generation)
    }

    /** Re-stat before resuming the first missing byte; changed content requires a fresh open. */
    fun retry() = synchronized(lock) {
        val current = state.value ?: return@synchronized
        if (current.phase != NativeResourcePhase.FAILED || active?.isActive == true) return@synchronized
        mutableState.value = current.copy(phase = NativeResourcePhase.LOADING, failure = null)
        start(generation)
    }

    /** Cancel every owned request and return the jobs that a suspending owner must await. */
    fun close(): List<Job> = synchronized(lock) {
        val saving = saves.invalidate()
        generation++
        active = null
        chunks = mutableListOf()
        mutableState.value = null
        jobs.toList().also { pending -> pending.forEach { it.cancel() } } + saving
    }

    suspend fun closeAndAwait() { val pending = close(); withContext(NonCancellable) { pending.joinAll() } }

    private fun start(stamp: Long) {
        val task = scope.launch(start = CoroutineStart.LAZY) { read(stamp) }
        active = task
        jobs.add(task)
        task.invokeOnCompletion { jobs.remove(task) }
        task.start()
    }

    private suspend fun read(stamp: Long) {
        try {
            val initial = synchronized(lock) { state.value?.takeIf { stamp == generation } } ?: return
            val args = mapOf("workspaceFileScopeId" to WireValue.StringValue(initial.target.sessionId),
                "path" to WireValue.StringValue(initial.target.path))
            val observed = descriptor(wire.call("workspaceFiles/stat", args))
            synchronized(lock) {
                if (stamp != generation) return
                if (initial.descriptor != null && initial.descriptor != observed) throw ResourceChanged()
                mutableState.value = checkNotNull(state.value).copy(descriptor = observed)
            }
            val budget = if (observed.bytes != null && observed.bytes > limits.maxBufferedBytes) limits.previewBytes else limits.maxBufferedBytes
            while (true) {
                val current = synchronized(lock) { state.value?.takeIf { stamp == generation } } ?: return
                val offset = current.receivedBytes
                val length = minOf(limits.windowBytes, budget - offset)
                if (length <= 0) invalid("resource read budget exhausted without a terminal state")
                val result = wire.call("workspaceFiles/readBytes", args + ("range" to WireValue.ObjectValue(mapOf(
                    "offset" to WireValue.NumberValue(offset.toDouble()), "length" to WireValue.NumberValue(length.toDouble()),
                ))))
                synchronized(lock) {
                    if (stamp != generation) return
                    if (descriptor(result) != observed) throw ResourceChanged()
                    if (integer(result, "offset") != offset.toLong()) invalid("resource byte offset differs")
                    val eof = WireShape.boolean(result, "eof") ?: invalid("resource EOF is missing")
                    val encoded = WireShape.string(result, "data") ?: invalid("resource bytes are missing")
                    if (encoded.length.toLong() > ((length.toLong() + 2) / 3) * 4) invalid("resource window exceeds requested size")
                    val bytes = try { Base64.getDecoder().decode(encoded) }
                    catch (_: IllegalArgumentException) { invalid("resource base64 is invalid") }
                    if (Base64.getEncoder().encodeToString(bytes) != encoded) invalid("resource base64 is not canonical")
                    if (bytes.size > length || bytes.isEmpty() && !eof) invalid("resource window makes no bounded progress")
                    val total = offset + bytes.size
                    if (observed.bytes != null && (total > observed.bytes || eof != (total.toLong() == observed.bytes))) {
                        invalid("resource EOF differs from its size")
                    }
                    chunks.add(bytes)
                    val prefix = if (offset >= limits.previewBytes) current.prefix else join(minOf(total, limits.previewBytes))
                    val phase = if (eof) NativeResourcePhase.READY else if (total == budget) NativeResourcePhase.PREVIEW else NativeResourcePhase.LOADING
                    val content = if (eof) join(total) else null
                    mutableState.value = checkNotNull(state.value).copy(phase = phase, receivedBytes = total, prefix = prefix, content = content)
                    if (phase != NativeResourcePhase.LOADING) { chunks.clear(); return }
                }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: ResourceChanged) {
            synchronized(lock) {
                if (stamp == generation) {
                    chunks.clear()
                    mutableState.value = checkNotNull(state.value).copy(phase = NativeResourcePhase.CHANGED,
                        receivedBytes = 0, prefix = byteArrayOf(), content = null)
                }
            }
        } catch (failure: Exception) {
            synchronized(lock) {
                if (stamp == generation) mutableState.value = checkNotNull(state.value).copy(
                    phase = NativeResourcePhase.FAILED, failure = ConnectionFailure.from(failure))
            }
        }
    }

    private fun join(size: Int): ByteArray {
        val result = ByteArray(size)
        var offset = 0
        for (chunk in chunks) {
            val count = minOf(chunk.size, size - offset)
            chunk.copyInto(result, offset, 0, count)
            offset += count
            if (offset == size) break
        }
        return result
    }

    private fun descriptor(value: WireValue): NativeFileDescriptor {
        val path = WireShape.string(value, "absolutePath")?.takeIf(String::isNotBlank) ?: invalid("resource path is missing")
        val version = WireShape.string(value, "version")?.takeIf(String::isNotBlank) ?: invalid("resource version is missing")
        val fields = (value as? WireValue.ObjectValue)?.entries ?: invalid("resource descriptor required")
        return NativeFileDescriptor(path, version, if (fields.containsKey("bytes")) integer(value, "bytes") else null)
    }

    private fun integer(value: WireValue, field: String): Long {
        val number = WireShape.number(value, field) ?: invalid("resource $field is missing")
        if (!number.isFinite() || number < 0 || number > 9_007_199_254_740_991.0 || number != kotlin.math.floor(number)) {
            invalid("resource $field must be a nonnegative safe integer")
        }
        return number.toLong()
    }

    private class ResourceChanged : Exception()
    private fun invalid(message: String): Nothing = throw LinkClientException.BadWire(message)
}
