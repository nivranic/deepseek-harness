package ai.deepseek.dsh.companion

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume

/** One approval-gated call waiting on the user: the facts §38's dialog shows. */
data class LiteApprovalRequest(val name: String, val arguments: String, val risk: String)

/**
 * The app face of §38's approval seam: the loop driver's ask call suspends
 * here while the pending request surfaces to the UI as [pending], and the
 * dialog's buttons resolve it through [respond]. One call waits at a time —
 * the loop serves its tool calls serially, so a single slot is the whole
 * queue — and cancelling the turn (a new submission replaces the in-flight
 * one) clears the pending dialog through the seam's cancellation handler.
 */
class LiteApprovalAsks {
    private val lock = Any()
    private var waiter: Continuation<Boolean>? = null
    private val _pending = MutableStateFlow<LiteApprovalRequest?>(null)

    /** The call awaiting the user's answer, null when none is pending. */
    val pending: StateFlow<LiteApprovalRequest?> = _pending

    /**
     * Suspend until the user answers this call's approval dialog.
     * @param name the tool name the dialog's action row shows.
     * @param arguments the call's arguments JSON as the dialog's command preview.
     * @param risk the declaration's risk wire word as the dialog's risk fact.
     * @return true to execute the call on-device, false to fold the denial.
     */
    suspend fun ask(name: String, arguments: String, risk: String): Boolean =
        suspendCancellableCoroutine { continuation ->
            synchronized(lock) {
                waiter = continuation
                _pending.value = LiteApprovalRequest(name, arguments, risk)
            }
            continuation.invokeOnCancellation {
                synchronized(lock) {
                    waiter = null
                    _pending.value = null
                }
            }
        }

    /**
     * Resolve the pending dialog.
     * @param granted true executes the call on-device, false folds the denial.
     */
    fun respond(granted: Boolean) {
        val continuation = synchronized(lock) {
            val waiting = waiter ?: return
            waiter = null
            _pending.value = null
            waiting
        }
        // Resumed outside the lock: the continuation's continuation may run
        // synchronously and must never re-enter this class's lock.
        continuation.resume(granted)
    }
}
