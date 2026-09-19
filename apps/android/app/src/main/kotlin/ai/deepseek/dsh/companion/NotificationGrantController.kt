package ai.deepseek.dsh.companion

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * The runtime grant flow's app half (chapter 70's Android leg): holds the
 * [NotificationGrantState] projection the UI and tests read, records the
 * user's answer when the system dialog returns, and refreshes the system
 * enablement read — the observer of a settings change the user makes
 * outside the app.
 */
class NotificationGrantController(context: Context) {
    private val appContext = context.applicationContext

    private val _state = MutableStateFlow(NotificationGrantState(systemEnabled = PushNotifications.notificationsEnabled(appContext)))

    /** The grant projection; UI collects, the ask flow reads. */
    val state: StateFlow<NotificationGrantState> = _state

    /** Re-read the system enablement — the recovery path after the user
     * changes the grant in system settings. */
    fun refresh() {
        _state.update { current ->
            current.copy(systemEnabled = PushNotifications.notificationsEnabled(appContext))
        }
    }

    /** Record the system dialog's answer. */
    fun onUserAnswer(granted: Boolean) {
        _state.update { current ->
            NotificationGrantState(
                systemEnabled = PushNotifications.notificationsEnabled(appContext),
                requested = true,
                lastAnswer = granted,
            )
        }
    }
}
