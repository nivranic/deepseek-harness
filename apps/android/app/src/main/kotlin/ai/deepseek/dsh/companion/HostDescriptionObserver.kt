package ai.deepseek.dsh.companion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.awaitCancellation

/** Refresh once per paired foreground entry; stopping or replacing the owner cancels its in-flight query. */
@Composable
internal fun HostDescriptionObserver(wire: WireDriving, paired: Boolean) {
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(paired, wire, lifecycleOwner) {
        if (paired) lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            wire.refreshHostDescription()
            awaitCancellation()
        }
    }
}
