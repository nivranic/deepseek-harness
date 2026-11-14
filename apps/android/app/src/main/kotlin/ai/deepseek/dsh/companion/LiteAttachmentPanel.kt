package ai.deepseek.dsh.companion

import android.content.ContentResolver
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The Lite face's local attachment intake and list (the preset selector's
 * form): one add button opening a two-source picker — documents and photos —
 * whose picked content is read bounded on the IO dispatcher and admitted
 * through the typed intake into the retained store. Bytes stay on this
 * device; the paired face's channel uploads over the wire and keeps nothing,
 * and an independent session has no wire. Intake is store-and-UI state only:
 * nothing admitted here reaches the journal, the fold, or a provider request,
 * and the association with a prompt is a later generation's decision. The
 * list is the store's — deletable row by row, and still there after a
 * relaunch.
 */
@Composable
internal fun LiteAttachmentsPanel(store: LiteAttachmentStoring) {
    var revision by remember { mutableStateOf(0) }
    var picking by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    val resolver = LocalContext.current.contentResolver
    // The list is re-read per revision bump; a corrupt sidecar surfaces as
    // its own line — it never reads as an empty list.
    val listed = remember(store, revision) {
        try {
            LiteAttachmentList(entries = store.list(), failed = false)
        } catch (corrupt: IllegalStateException) {
            LiteAttachmentList(entries = emptyList(), failed = true)
        }
    }

    fun admit(source: NativeFileAttachmentSource?) {
        if (source == null) return
        busy = true
        failure = null
        scope.launch {
            val outcome = withContext(Dispatchers.IO) {
                try {
                    val bytes = source.open().use { input ->
                        input.readNBytes(LiteAttachmentIntake.CONTENT_LIMIT_BYTES + 1)
                    }
                    LiteAttachmentIntake.intake(store, source.name(), bytes, source.mediaType())
                } catch (unreadable: IOException) {
                    // The provider stream refused the read; nothing was retained.
                    null
                }
            }
            failure = when (outcome) {
                null -> R.string.lite_attachment_source_failed
                LiteAttachmentIntake.Outcome.Failure.TOO_LARGE -> R.string.lite_attachment_too_large
                LiteAttachmentIntake.Outcome.Failure.STORE_FAILED -> R.string.lite_attachment_store_failed
                is LiteAttachmentIntake.Outcome.Stored -> null
            }
            busy = false
            revision++
        }
    }

    val documents = rememberLauncherForActivityResult(NativeFileDocument()) { uri ->
        if (uri != null && uri.scheme != ContentResolver.SCHEME_CONTENT) failure = R.string.lite_attachment_source_failed
        else admit(uri?.let { AndroidNativeFileAttachmentSource(resolver, it) })
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null && uri.scheme != ContentResolver.SCHEME_CONTENT) failure = R.string.lite_attachment_source_failed
        else admit(uri?.let { AndroidNativeFileAttachmentSource(resolver, it) })
    }

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedButton(
            onClick = { picking = true },
            modifier = Modifier.fillMaxWidth().testTag("lite-attachment-add"),
        ) { Text(stringResource(R.string.lite_attachment_add)) }
        if (busy) Text(
            stringResource(R.string.lite_attachment_reading),
            Modifier.testTag("lite-attachment-reading"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
        )
        failure?.let { res ->
            Text(
                if (res == R.string.lite_attachment_too_large) {
                    stringResource(res, LiteAttachmentIntake.CONTENT_LIMIT_BYTES)
                } else {
                    stringResource(res)
                },
                Modifier.testTag("lite-attachment-error"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        if (listed.failed) Text(
            stringResource(R.string.lite_attachment_list_failed),
            Modifier.testTag("lite-attachment-list-error"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
        for (entry in listed.entries) {
            Row(
                Modifier.fillMaxWidth().testTag("lite-attachment-${entry.name}"),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    stringResource(R.string.lite_attachment_detail, entry.name, entry.mediaType, entry.sizeBytes),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                )
                TextButton(
                    onClick = {
                        scope.launch {
                            withContext(Dispatchers.IO) { store.remove(entry.name) }
                            revision++
                        }
                    },
                    modifier = Modifier.testTag("lite-attachment-remove-${entry.name}"),
                ) { Text(stringResource(R.string.lite_attachment_remove)) }
            }
        }
    }
    if (picking) AlertDialog(
        onDismissRequest = { picking = false },
        title = { Text(stringResource(R.string.lite_attachment_add)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { picking = false; documents.launch(Unit) },
                    modifier = Modifier.fillMaxWidth().testTag("lite-attachment-pick-file"),
                ) { Text(stringResource(R.string.lite_attachment_file)) }
                Button(
                    onClick = { picking = false; photos.launch(nativePhotoPickerRequest()) },
                    modifier = Modifier.fillMaxWidth().testTag("lite-attachment-pick-photo"),
                ) { Text(stringResource(R.string.lite_attachment_photo)) }
            }
        },
        confirmButton = {
            Button(onClick = { picking = false }) { Text(stringResource(R.string.lite_attachment_close)) }
        },
    )
}

/** One list read: the entries, or why the list could not be read. */
private data class LiteAttachmentList(val entries: List<LiteAttachmentEntry>, val failed: Boolean)
