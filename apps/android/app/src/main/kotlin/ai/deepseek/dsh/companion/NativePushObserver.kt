package ai.deepseek.dsh.companion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Foreground entries may recover the model's stream; the consumer remains attached while backgrounded. */
@Composable
internal fun NativePushObserver(pushes: PushModel, active: Boolean, present: (CompanionPush) -> Unit) {
    val owner = LocalLifecycleOwner.current
    val presentCurrent by rememberUpdatedState(present)
    LaunchedEffect(pushes, active, owner) {
        if (!active) return@LaunchedEffect
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) pushes.ensureWatching()
        }
        // Registration replays ON_START when already started, sharing admission with later foreground entries.
        owner.lifecycle.addObserver(observer)
        try {
            pushes.pushes.collect {
                pushes.takePendingNotifications().forEach { push -> presentCurrent(push) }
            }
        } finally {
            // The ViewModel owns producer retirement; rotation only detaches this consumer.
            withContext(NonCancellable + Dispatchers.Main.immediate) {
                owner.lifecycle.removeObserver(observer)
            }
        }
    }
}
