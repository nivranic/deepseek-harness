package ai.deepseek.dsh.companion

import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.withContext

/** Initial registration and foreground return share one request admission after refreshing Android's setting. */
@Composable
internal fun NativeNotificationGrantObserver(
    grant: NotificationGrantController,
    request: () -> Unit,
    onRequestUnavailable: () -> Unit,
) {
    val owner = LocalLifecycleOwner.current
    val requestCurrent by rememberUpdatedState(request)
    val unavailableCurrent by rememberUpdatedState(onRequestUnavailable)
    LaunchedEffect(grant, owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) {
                grant.refresh()
                if (grant.claimRequest()) {
                    try { requestCurrent() }
                    catch (_: ActivityNotFoundException) { unavailableCurrent() }
                }
            }
        }
        try {
            owner.lifecycle.addObserver(observer)
            awaitCancellation()
        } finally {
            withContext(NonCancellable + Dispatchers.Main.immediate) {
                owner.lifecycle.removeObserver(observer)
            }
        }
    }
}

/** Open only this application's notification settings; no permission or Host authority rides the Intent. */
internal fun nativeNotificationSettingsIntent(applicationId: String): Intent =
    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, applicationId)

/** A disabled application setting offers explicit recovery without implying channel or transport health. */
@Composable
internal fun NativeNotificationGrantNotice(
    state: NotificationGrantState,
    requestUnavailable: Boolean,
    openSettings: () -> Unit,
) {
    if (state.systemEnabled) return
    var settingsFailed by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.native_notification_disabled), Modifier.weight(1f).testTag("native-notification-disabled"),
                style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = {
                settingsFailed = false
                try { openSettings() }
                catch (_: ActivityNotFoundException) { settingsFailed = true }
                catch (_: SecurityException) { settingsFailed = true }
            }, modifier = Modifier.testTag("native-notification-settings")) {
                Text(stringResource(R.string.native_notification_settings))
            }
        }
        if (requestUnavailable) Text(stringResource(R.string.native_notification_request_failed),
            Modifier.testTag("native-notification-request-error"), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error)
        if (settingsFailed) Text(stringResource(R.string.native_notification_settings_failed),
            Modifier.testTag("native-notification-settings-error"), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error)
    }
}
