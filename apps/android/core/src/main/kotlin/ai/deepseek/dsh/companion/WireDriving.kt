package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.flow.Flow
import java.util.concurrent.atomic.AtomicReference

/** The wire surface the companion models drive — the Kotlin mirror of the
 * Swift `CompanionWireDriving`; tests drive a fake, the app a LinkClient. */
interface WireDriving : AutoCloseable {
    /** Execute one unary call without occupying the caller's dispatcher;
     * cancellation propagates to the transport owner. */
    suspend fun call(method: String, args: Map<String, WireValue> = emptyMap()): WireValue

    fun stream(endpoint: String, payload: Map<String, WireValue> = emptyMap()): Flow<WireValue>

    /** Request retirement of transport resources owned by this wire. Test and
     * stateless wires own none. Use [closeAndAwait] when subsequent work must
     * observe a quiescent transport. */
    override fun close() = Unit

    /** Retire transport resources and return only after their work is quiescent. */
    suspend fun closeAndAwait() = close()
}

/** Stable wire handle whose delegate changes after restore or fresh pairing.
 * Models retain this handle, so replacing credentials cannot leave them bound
 * to the pre-pairing transport. */
class SwitchableWireDriving(initial: WireDriving) : WireDriving {
    private val delegate = AtomicReference(initial)
    private val transitionLock = Any()
    private var closed = false

    /** Route subsequent calls and streams through [next], retiring the previous wire. */
    fun replace(next: WireDriving) {
        val previous = synchronized(transitionLock) {
            if (closed) null else delegate.getAndSet(next)
        }
        if (previous == null) {
            next.close()
        } else if (previous !== next) {
            previous.close()
        }
    }

    /** Route subsequent work through [next] and await complete retirement of
     * the previous wire before returning. */
    suspend fun replaceAndAwait(next: WireDriving) {
        val previous = synchronized(transitionLock) {
            if (closed) null else delegate.getAndSet(next)
        }
        if (previous == null) {
            next.closeAndAwait()
        } else if (previous !== next) {
            previous.closeAndAwait()
        }
    }

    override suspend fun call(method: String, args: Map<String, WireValue>): WireValue =
        delegate.get().call(method, args)

    override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> =
        delegate.get().stream(endpoint, payload)

    override fun close() {
        val current = synchronized(transitionLock) {
            if (closed) null else {
                closed = true
                delegate.get()
            }
        }
        current?.close()
    }

    override suspend fun closeAndAwait() {
        val current = synchronized(transitionLock) {
            closed = true
            delegate.get()
        }
        current.closeAndAwait()
    }
}

/** The wire over one paired [ai.deepseek.dsh.link.LinkClient]. */
class LinkWireDriving(private val client: ai.deepseek.dsh.link.LinkClient) : WireDriving {
    override suspend fun call(method: String, args: Map<String, WireValue>): WireValue =
        client.call(method, args)

    override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> =
        client.stream(endpoint, payload)

    override fun close() {
        client.close()
    }

    override suspend fun closeAndAwait() {
        client.closeAndAwait()
    }
}

/** Wire-shaped field access shared by the models: one level deep, absent or
 * mistyped fields read as null. */
object WireShape {
    fun string(value: WireValue, field: String): String? =
        ((value as? WireValue.ObjectValue)?.entries?.get(field) as? WireValue.StringValue)?.value

    fun number(value: WireValue, field: String): Double? =
        ((value as? WireValue.ObjectValue)?.entries?.get(field) as? WireValue.NumberValue)?.value

    fun boolean(value: WireValue, field: String): Boolean? =
        ((value as? WireValue.ObjectValue)?.entries?.get(field) as? WireValue.BoolValue)?.value

    fun array(value: WireValue, field: String): List<WireValue>? =
        ((value as? WireValue.ObjectValue)?.entries?.get(field) as? WireValue.ArrayValue)?.items

    fun objectValue(value: WireValue, field: String): WireValue? =
        (value as? WireValue.ObjectValue)?.entries?.get(field)?.takeIf { it is WireValue.ObjectValue }
}
