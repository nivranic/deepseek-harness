package ai.deepseek.dsh.companion

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

/** Persistent progress belongs to this selected resource; returning to it never resumes network work automatically. */
@Composable
fun NativeDownloadControls(model: NativeDownloadsModel, target: NativeResourceTarget, saving: Boolean, save: () -> Unit) {
    if (!model.available) return
    val selection by model.state.collectAsStateWithLifecycle()
    val selected = selection.takeIf { it.target == target }
    val owner = selected?.controller
    val state = owner?.state?.collectAsStateWithLifecycle()?.value
    val scope = rememberCoroutineScope()
    var removing by remember(target) { mutableStateOf(false) }
    val enabled = selected != null && !selected.busy && !saving && state?.phase !in setOf(NativeDownloadPhase.RESTORING, NativeDownloadPhase.CLOSED)
    val message = when {
        selected == null || selected.busy -> R.string.native_download_restoring
        selected.failed -> R.string.native_download_failed
        else -> when (state?.phase) {
            NativeDownloadPhase.RESTORING -> R.string.native_download_restoring
            NativeDownloadPhase.DOWNLOADING -> R.string.native_download_running
            NativeDownloadPhase.COMPLETE -> R.string.native_download_complete
            NativeDownloadPhase.FAILED -> R.string.native_download_failed
            NativeDownloadPhase.CHANGED -> R.string.native_download_changed
            NativeDownloadPhase.UNAVAILABLE -> R.string.native_download_unavailable
            NativeDownloadPhase.PAUSED -> if (state.checkpoint == null) R.string.native_download_idle else R.string.native_download_paused
            NativeDownloadPhase.CLOSED, null -> R.string.native_download_idle
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.testTag("download-controls")) {
        Text(stringResource(message), Modifier.testTag("download-status"), style = MaterialTheme.typography.bodySmall)
        state?.checkpoint?.let {
            val total = it.descriptor.bytes
            Text(if (total == null) stringResource(R.string.native_download_bytes, it.receivedBytes)
                else stringResource(R.string.native_download_total, it.receivedBytes, total),
                Modifier.testTag("download-progress"), style = MaterialTheme.typography.bodySmall)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when (state?.phase) {
                NativeDownloadPhase.DOWNLOADING -> Button(onClick = { scope.launch { model.pause(target) } }, enabled = enabled,
                    modifier = Modifier.testTag("download-pause")) { Text(stringResource(R.string.native_download_pause)) }
                NativeDownloadPhase.COMPLETE -> Button(onClick = save, enabled = enabled,
                    modifier = Modifier.testTag("download-save")) { Text(stringResource(R.string.native_download_save)) }
                NativeDownloadPhase.CHANGED, NativeDownloadPhase.UNAVAILABLE, NativeDownloadPhase.CLOSED, NativeDownloadPhase.RESTORING -> Unit
                NativeDownloadPhase.PAUSED, NativeDownloadPhase.FAILED, null -> Button(onClick = { scope.launch { model.resume(target) } }, enabled = enabled,
                    modifier = Modifier.testTag("download-resume")) {
                    Text(stringResource(if (state?.checkpoint == null) R.string.native_download_start else R.string.native_download_resume))
                }
            }
            if (owner != null && state?.phase != NativeDownloadPhase.CLOSED) {
                OutlinedButton(onClick = { removing = true }, enabled = enabled, modifier = Modifier.testTag("download-remove")) {
                    Text(stringResource(R.string.native_download_remove))
                }
            }
        }
    }
    if (removing) AlertDialog(onDismissRequest = { removing = false },
        title = { Text(stringResource(R.string.native_download_remove)) },
        text = { Text(stringResource(R.string.native_download_remove_help)) },
        confirmButton = { TextButton(onClick = { removing = false; scope.launch { model.discard(target) } },
            modifier = Modifier.testTag("download-remove-confirm")) { Text(stringResource(R.string.native_download_remove)) } },
        dismissButton = { TextButton(onClick = { removing = false }) { Text(stringResource(R.string.native_pairing_cancel)) } })
}
