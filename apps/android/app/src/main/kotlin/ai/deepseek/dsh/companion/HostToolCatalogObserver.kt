package ai.deepseek.dsh.companion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.awaitCancellation

/**
 * Observe the paired Host's live tool declarations (§32): one fetch per
 * paired foreground entry or explicit retry, with the last successful catalog
 * retained across null answers and transport failures. The watch — and with
 * it the retained catalog — belongs to one wire and Host generation; an
 * explicit retry keeps it, so a failed retry cannot flap the session back to
 * the bundled union.
 */
@Composable
internal fun HostToolCatalogObserver(
    wire: WireDriving,
    paired: Boolean,
    generation: Long = 0,
    refreshEpoch: Int = 0,
): LiteHostCatalogObservation {
    val lifecycleOwner = LocalLifecycleOwner.current
    val watch = remember(wire, paired, generation) { LiteHostCatalogWatch() }
    var observation by remember(wire, paired, generation) { mutableStateOf(LiteHostCatalogObservation()) }
    LaunchedEffect(paired, wire, lifecycleOwner, generation, refreshEpoch) {
        if (paired) lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            observation = watch.refresh(wire)
            awaitCancellation()
        }
    }
    return observation
}
