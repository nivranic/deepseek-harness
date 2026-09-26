package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Application-selected message page size and total retained serialized-record byte limit. */
data class NativeHistoryLimits(val pageMessages: Int, val maxBufferedBytes: Int) {
    init { require(pageMessages > 0 && maxBufferedBytes > 0) }
}

/** A history failure keeps the already loaded window readable and allows an explicit retry. */
data class NativeHistoryState(
    val ready: Boolean = false,
    val hasMore: Boolean = false,
    val loading: Boolean = false,
    val failure: ConnectionFailure? = null,
)

/** One Session observation's bounded records. Backward pages retain the snapshot cut while live
 * events advance independently. Replacing a snapshot or Session cancels old paging and rejects
 * any late result before it can publish into the new window. Publication supplies the complete
 * window when its final argument is true, otherwise one newly appended live record.
 */
class NativeSessionJournal(
    private val wire: WireDriving,
    private val scope: CoroutineScope,
    private val limits: NativeHistoryLimits,
    private val publish: (Long, String, List<WireValue>, Boolean) -> Unit,
) {
    private data class Window(val cut: Long, val records: List<WireValue>, val hasMore: Boolean, val bytes: Long)
    private val lock = Any()
    private var epoch = 0L
    private var owner = 0L
    private var sessionId = ""
    private var address: WireValue.ObjectValue? = null
    private var window: Window? = null
    private var awaitingSnapshot = true
    private var requestedCursor: Long? = null
    private var page: Deferred<Boolean>? = null
    private val reads = ConcurrentHashMap.newKeySet<Deferred<Boolean>>()
    private val mutableState = MutableStateFlow(NativeHistoryState())
    val state: StateFlow<NativeHistoryState> = mutableState

    /** Resume only records retained by this owner; every new transport must begin with a snapshot. */
    fun beginFollow(generation: Long): Long? = synchronized(lock) {
        if (generation != owner || address == null) return@synchronized null
        awaitingSnapshot = true
        requestedCursor = window?.records?.lastOrNull()?.let(::sequence)
        requestedCursor
    }

    /** Invalidate old requests before the next follow generation is published. */
    fun reset(generation: Long, id: String, target: WireValue.ObjectValue) = synchronized(lock) {
        invalidate()
        owner = generation
        sessionId = id
        address = target
    }

    /** Cancel all owned reads and return the jobs a suspending owner must await; transport ownership stays outside. */
    fun close(): List<Job> = synchronized(lock) {
        invalidate()
        address = null
        reads.toList().also { pending -> pending.forEach { it.cancel() } }
    }

    /** Publish an observation failure so a pending explicit jump cannot wait forever for its first snapshot. */
    fun observationFailed(failure: Exception, generation: Long) = synchronized(lock) {
        if (generation == owner && address != null) mutableState.value = state.value.copy(failure = ConnectionFailure.from(failure))
    }

    private fun invalidate() {
        epoch++
        page?.cancel()
        page = null
        window = null
        awaitingSnapshot = true
        requestedCursor = null
        mutableState.value = NativeHistoryState()
    }

    /** Accept a snapshot or gap-free live event from the current follow owner. */
    fun accept(frame: WireValue, generation: Long) = synchronized(lock) {
        if (generation != owner || address == null) return@synchronized
        when (WireShape.string(frame, "type")) {
            "snapshot" -> {
                val header = WireShape.objectValue(frame, "header") ?: invalid("snapshot header is missing")
                if (WireShape.string(header, "id") != sessionId) invalid("snapshot belongs to another Session")
                val cut = integer(frame, "cursor", minimum = -1)
                val records = records(frame)
                val more = WireShape.boolean(frame, "hasMore") ?: invalid("snapshot hasMore is missing")
                validateRecords(records)
                if (records.isNotEmpty() && sequence(records.last()) != cut || more && records.isEmpty()) invalid("snapshot cursor differs")
                val next = mergeSnapshot(cut, records, more)
                val bytes = measure(next.records)
                checkLimit(bytes)
                epoch++
                page?.cancel(); page = null
                window = next.copy(bytes = bytes)
                awaitingSnapshot = false
                requestedCursor = null
            }
            "event" -> {
                if (awaitingSnapshot) invalid("live event precedes snapshot")
                val previous = window ?: invalid("live event precedes snapshot")
                val last = previous.records.lastOrNull()?.let(::sequence) ?: previous.cut
                if (sequence(frame) != last + 1) invalid("live event is not contiguous")
                val bytes = previous.bytes + measure(listOf(frame))
                checkLimit(bytes)
                window = previous.copy(records = previous.records + frame, bytes = bytes)
            }
            else -> invalid("unsupported Session follow frame")
        }
        val current = checkNotNull(window)
        mutableState.value = if (WireShape.string(frame, "type") == "snapshot") {
            NativeHistoryState(ready = true, hasMore = current.hasMore)
        } else state.value.copy(ready = true, hasMore = current.hasMore)
        val replacement = WireShape.string(frame, "type") == "snapshot"
        publish(owner, sessionId, if (replacement) current.records else listOf(frame), replacement)
    }

    private fun mergeSnapshot(cut: Long, records: List<WireValue>, more: Boolean): Window {
        val replacement = Window(cut, records, more, 0)
        val cursor = requestedCursor ?: return replacement
        val previous = window ?: return replacement
        if (cut < cursor) invalid("snapshot cursor moved backwards")
        val first = records.firstOrNull()?.let(::sequence) ?: invalid("resumed snapshot has no records")
        if (first > cursor + 1) return replacement
        val oldFirst = sequence(previous.records.first())
        for (record in records) {
            val seq = sequence(record)
            if (seq >= oldFirst && seq <= cursor && record != previous.records[(seq - oldFirst).toInt()]) {
                invalid("snapshot contradicts retained Session records")
            }
        }
        val prefix = previous.records.takeWhile { sequence(it) < first }
        return Window(cut, prefix + records, if (prefix.isEmpty()) more else previous.hasMore, 0)
    }

    /** Load one previous page; concurrent callers share the owned read and its outcome. */
    suspend fun loadOlder(): Boolean {
        val pending = synchronized(lock) {
            page?.takeIf { it.isActive } ?: run {
                val current = window ?: return false
                if (!current.hasMore) return false
                val target = checkNotNull(address)
                val stamp = epoch
                val before = sequence(current.records.first())
                val request = WireValue.ObjectValue(mapOf(
                    "address" to target,
                    "throughSeq" to WireValue.NumberValue(current.cut.toDouble()),
                    "beforeSeq" to WireValue.NumberValue(before.toDouble()),
                    "maxMessages" to WireValue.NumberValue(limits.pageMessages.toDouble()),
                ))
                mutableState.value = state.value.copy(loading = true, failure = null)
                scope.async(start = CoroutineStart.LAZY) { readPage(stamp, before, request) }.also { pending ->
                    page = pending
                    reads.add(pending)
                    pending.invokeOnCompletion { reads.remove(pending) }
                    pending.start()
                }
            }
        }
        return pending.await()
    }

    /** Explicitly load back to an anchor; stale windows, exhausted history, and failed reads reject the jump. */
    suspend fun loadThrough(anchor: Long): Boolean {
        require(anchor in 0..9_007_199_254_740_991L)
        val stamp = synchronized(lock) { epoch }
        while (true) {
            val covered = synchronized(lock) {
                if (epoch != stamp) return false
                val current = window ?: return false
                val first = current.records.firstOrNull()?.let(::sequence) ?: return false
                val last = sequence(current.records.last())
                if (anchor > last) return false
                anchor >= first
            }
            if (covered) return true
            if (!loadOlder()) return false
        }
    }

    private suspend fun readPage(stamp: Long, before: Long, request: WireValue.ObjectValue): Boolean {
        try {
            val result = wire.call("session/page", mapOf("request" to request))
            val older = records(result)
            val more = WireShape.boolean(result, "hasMore") ?: invalid("page hasMore is missing")
            validateRecords(older)
            if (older.isEmpty() || sequence(older.last()) != before - 1) invalid("history page makes no contiguous progress")
            val addedBytes = measure(older)
            return synchronized(lock) {
                if (epoch != stamp) return@synchronized false
                val current = window ?: return@synchronized false
                if (sequence(current.records.first()) != before) invalid("history page base changed")
                val bytes = current.bytes + addedBytes
                checkLimit(bytes)
                val next = current.copy(records = older + current.records, hasMore = more, bytes = bytes)
                window = next
                mutableState.value = NativeHistoryState(ready = true, hasMore = more)
                publish(owner, sessionId, next.records, true)
                true
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            synchronized(lock) {
                if (epoch == stamp) mutableState.value = state.value.copy(loading = false, failure = ConnectionFailure.from(failure))
            }
            return false
        } finally {
            synchronized(lock) {
                if (epoch == stamp) mutableState.value = state.value.copy(loading = false)
            }
        }
    }

    private fun checkLimit(bytes: Long) {
        if (bytes > limits.maxBufferedBytes) invalid("Session history exceeds the retained byte limit")
    }

    private fun records(value: WireValue): List<WireValue> = WireShape.array(value, "records") ?: invalid("Session records are missing")

    private fun measure(records: List<WireValue>): Long = records.sumOf { it.toJsonElement().toString().toByteArray(Charsets.UTF_8).size.toLong() }

    private fun validateRecords(records: List<WireValue>) {
        var previous: Long? = null
        for (record in records) {
            val seq = sequence(record)
            if (previous != null && seq != previous + 1) invalid("Session records are not contiguous")
            previous = seq
        }
    }

    private fun sequence(record: WireValue): Long {
        if (WireShape.string(record, "type") != "event") invalid("Session event record required")
        val event = WireShape.objectValue(record, "event") ?: invalid("Session event is missing")
        return integer(event, "seq")
    }

    private fun integer(value: WireValue, field: String, minimum: Long = 0): Long {
        val number = WireShape.number(value, field) ?: invalid("Session $field is missing")
        if (!number.isFinite() || number < minimum || number > 9_007_199_254_740_991.0 || number != kotlin.math.floor(number)) {
            invalid("Session $field must be a safe integer")
        }
        return number.toLong()
    }

    private fun invalid(message: String): Nothing = throw LinkClientException.BadWire(message)
}
