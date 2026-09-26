package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow

/** One connection's disposable UI state. Retiring it cancels model requests and observations;
 * the process-owned transport remains available for cancellation of a pairing change.
 * A replacement receives new models rather than cached data from the previous connection.
 */
class CompanionModelSet(wire: WireDriving, parent: CoroutineScope,
                        val inputs: CompanionInputState = CompanionInputState.memory()) {
    private val lifetime = SupervisorJob(parent.coroutineContext[Job])
    private val scope = CoroutineScope(parent.coroutineContext + lifetime)
    private val ownedWire = object : WireDriving {
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
            val request = scope.async { wire.call(method, args) }
            try { return request.await() }
            finally { withContext(NonCancellable) { request.cancelAndJoin() } }
        }

        override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
            lifetime.ensureActive()
            emitAll(wire.stream(endpoint, payload))
        }
    }

    val session = SessionModel(ownedWire, scope, inputs = inputs)
    val interactions = InteractionModel(ownedWire, scope, inputs = inputs)
    val files = FilesModel(ownedWire, scope)
    val subagents = SubagentsModel(ownedWire, scope)
    val pushes = PushModel(ownedWire, scope)

    /** Retire model work without closing the process transport or cancelling a Host task. */
    fun close() {
        lifetime.cancel()
        session.close()
        interactions.stopWatching()
        files.stop()
        pushes.stopWatching()
    }

    /** Wait for model requests and stream cleanup before publishing a different connection's UI state. */
    suspend fun closeAndAwait() {
        close()
        withContext(NonCancellable) { lifetime.join() }
    }
}
