package ai.deepseek.dsh.companion

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Process-owned request admission; the current system enablement remains authoritative after every answer. */
class NotificationGrantController internal constructor(private val readSystemEnabled: () -> Boolean) {
    /** Read Android's application-level notification setting without retaining an Activity. */
    constructor(context: Context) : this(systemReader(context.applicationContext))

    private val lock = Any()
    private val _state = MutableStateFlow(NotificationGrantState(systemEnabled = readSystemEnabled()))

    /** The grant projection; UI collects, the ask flow reads. */
    val state: StateFlow<NotificationGrantState> = _state

    /** Refresh the application-level setting without resetting this process's request history. */
    fun refresh() = synchronized(lock) {
        _state.value = _state.value.copy(systemEnabled = readSystemEnabled())
    }

    /** Reserve the only automatic request before launching; a failed launch does not reopen admission.
     * @return Whether the caller owns the request under the most recently refreshed system setting.
     */
    fun claimRequest(): Boolean = synchronized(lock) {
        if (!_state.value.shouldRequest) false
        else {
            _state.value = _state.value.copy(requested = true)
            true
        }
    }

    /** Record the answer while re-reading the system, which may already differ from that answer.
     * @param granted The permission launcher's answer, retained as history rather than presentation authority.
     */
    fun onUserAnswer(granted: Boolean) = synchronized(lock) {
        _state.value = NotificationGrantState(systemEnabled = readSystemEnabled(), requested = true, lastAnswer = granted)
    }

    private companion object {
        fun systemReader(context: Context): () -> Boolean = { PushNotifications.notificationsEnabled(context) }
    }
}
