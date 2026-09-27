package ai.deepseek.dsh.companion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import ai.deepseek.dsh.gateway.NativeGatewayDiagnosticSnapshot
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.awaitCancellation

/** Query progress and retained safe facts belong to one displayed Host generation. */
internal data class NativeHostObservation(
    val refreshing: Boolean = false,
    val snapshot: NativeGatewayDiagnosticSnapshot? = null,
)

/** Refresh per paired foreground entry or explicit retry; replaced generations cannot publish into the new observation. */
@Composable
internal fun HostDescriptionObserver(
    wire: WireDriving,
    paired: Boolean,
    generation: Long = 0,
    refreshEpoch: Int = 0,
): NativeHostObservation {
    val lifecycleOwner = LocalLifecycleOwner.current
    var observation by remember(wire, paired, generation) { mutableStateOf(NativeHostObservation()) }
    LaunchedEffect(paired, wire, lifecycleOwner, generation, refreshEpoch) {
        if (paired) lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            observation = NativeHostObservation(true, (wire.diagnosticSnapshot() as? WireDiagnosticSnapshot.Native)?.value)
            try { wire.refreshHostDescription() }
            finally {
                observation = NativeHostObservation(false, (wire.diagnosticSnapshot() as? WireDiagnosticSnapshot.Native)?.value)
            }
            awaitCancellation()
        }
    }
    return observation
}
