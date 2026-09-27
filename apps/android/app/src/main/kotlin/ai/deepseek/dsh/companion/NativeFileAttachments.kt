package ai.deepseek.dsh.companion

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import java.io.IOException
import java.io.InputStream

/** Select one readable document without requesting persistent URI authority or modifying its source. */
internal class NativeFileDocument : ActivityResultContract<Unit, Uri?>() {
    override fun createIntent(context: Context, input: Unit): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? =
        intent?.takeIf { resultCode == Activity.RESULT_OK && (it.clipData?.itemCount ?: 0) <= 1 }?.data
}

/** Provider access occurs only when the captured core model invokes these methods on its I/O dispatcher. */
internal class AndroidNativeFileAttachmentSource(private val resolver: ContentResolver, private val uri: Uri) : NativeFileAttachmentSource {
    init { require(uri.scheme == ContentResolver.SCHEME_CONTENT) }
    override fun name(): String? = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
    }
    override fun open(): InputStream = resolver.openInputStream(uri) ?: throw IOException("Selected document is unavailable")
}

/** Keeps the original model and one selection across rotation. Process restoration has no upload authority. */
internal class NativeFileAttachmentPicker : ViewModel() {
    private data class Pending(val model: NativeFileAttachmentsModel, val selection: NativeFileSelection,
                               val sessionId: String?, val cancelled: Boolean = false)
    private data class Failure(val model: NativeFileAttachmentsModel, val sessionId: String?)
    private var pending: Pending? = null
    private var failure by mutableStateOf<Failure?>(null)
    var busy by mutableStateOf(false)
        private set

    fun begin(model: NativeFileAttachmentsModel): NativeFileSelection? {
        if (pending != null) return null
        val selection = model.prepare() ?: return null
        pending = Pending(model, selection, model.state.value.sessionId)
        failure = null
        busy = true
        return selection
    }

    /** A duplicate or process-restored result has no captured selection and never opens the source. */
    fun complete(source: NativeFileAttachmentSource?) {
        val selected = pending ?: return
        pending = null
        busy = false
        if (source == null || selected.cancelled) selected.model.cancelSelection(selected.selection)
        else selected.model.accept(selected.selection, source)
    }

    /** Invalid URIs and launch failures expose fixed local copy, never provider paths or exception messages. */
    fun invalidResult() {
        val selected = pending ?: return
        pending = null
        busy = false
        selected.model.cancelSelection(selected.selection)
        if (!selected.cancelled) failure = Failure(selected.model, selected.sessionId)
    }

    fun failedFor(model: NativeFileAttachmentsModel, sessionId: String): Boolean =
        failure?.let { it.model === model && it.sessionId == sessionId } == true

    /** Keep a cancelled picker occupied until its callback arrives so it cannot consume another selection. */
    fun cancel(model: NativeFileAttachmentsModel) {
        pending?.takeIf { it.model === model }?.let {
            pending = it.copy(cancelled = true)
            it.model.cancelSelection(it.selection)
        }
        model.cancel()
    }

    override fun onCleared() {
        pending?.let { it.model.cancelSelection(it.selection) }
        pending = null
    }
}

/** The application root owns registration so a late result retains its original Host and Session owner. */
@Composable
internal fun rememberNativeFileAttachmentLauncher(owner: NativeFileAttachmentPicker): (NativeFileAttachmentsModel) -> Unit {
    val resolver = LocalContext.current.contentResolver
    val launcher = rememberLauncherForActivityResult(NativeFileDocument()) { uri ->
        if (uri != null && uri.scheme != ContentResolver.SCHEME_CONTENT) owner.invalidResult()
        else owner.complete(uri?.let { AndroidNativeFileAttachmentSource(resolver, it) })
    }
    return { model ->
        if (owner.begin(model) != null) {
            try { launcher.launch(Unit) }
            catch (_: android.content.ActivityNotFoundException) { owner.invalidResult() }
            catch (_: SecurityException) { owner.invalidResult() }
        }
    }
}

@Composable
internal fun NativeFileAttachmentAddButton(enabled: Boolean, select: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val label = stringResource(R.string.native_attachment_add)
    Box {
        FilledTonalIconButton(onClick = { expanded = true }, enabled = enabled,
            modifier = Modifier.testTag("session-attach").semantics { contentDescription = label }) {
            Text(stringResource(R.string.native_attachment_plus), style = MaterialTheme.typography.titleLarge)
        }
        DropdownMenu(expanded = expanded && enabled, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.native_attachment_file)) },
                modifier = Modifier.testTag("session-attach-file"), onClick = { expanded = false; select() })
        }
    }
}

/** Completed receipts remain part of the current draft until explicit removal or submission. */
@Composable
internal fun NativeFileAttachmentCards(files: List<SessionFileAttachment>, enabled: Boolean, remove: (String) -> Unit) {
    if (files.isEmpty()) return
    Column(Modifier.fillMaxWidth().heightIn(max = 176.dp).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        files.forEach { file ->
            OutlinedCard(Modifier.fillMaxWidth().testTag("session-attachment-${file.receiptId}")) {
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(file.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(stringResource(R.string.native_attachment_bytes, file.bytes), style = MaterialTheme.typography.bodySmall)
                    }
                    TextButton(onClick = { remove(file.receiptId) }, enabled = enabled,
                        modifier = Modifier.testTag("session-attachment-remove-${file.receiptId}")) {
                        Text(stringResource(R.string.native_attachment_remove))
                    }
                }
            }
        }
    }
}

/** A pending prompt keeps its captured attachments visible without editing the submitted receipt set. */
@Composable
internal fun NativePendingFileAttachments(files: List<SessionFileAttachment>) {
    files.forEach { file ->
        Text(stringResource(R.string.native_attachment_detail, file.name, file.bytes), style = MaterialTheme.typography.bodySmall)
    }
}

/** Upload failures expose local categories; raw refusals and provider exceptions may contain private paths. */
@Composable
internal fun NativeFileAttachmentNotice(model: NativeFileAttachmentsModel, state: NativeFileAttachmentState,
                                       sessionId: String, picker: NativeFileAttachmentPicker) {
    val current = state.takeIf { it.sessionId == sessionId }
    val failed = picker.failedFor(model, sessionId) || current?.phase == NativeFileAttachmentPhase.FAILED
    val message = if (picker.failedFor(model, sessionId)) R.string.native_attachment_source_failed
    else when (current?.phase) {
        NativeFileAttachmentPhase.SELECTING -> R.string.native_attachment_selecting
        NativeFileAttachmentPhase.READING -> R.string.native_attachment_reading
        NativeFileAttachmentPhase.UPLOADING -> R.string.native_attachment_uploading
        NativeFileAttachmentPhase.FAILED -> when (current?.issue) {
            NativeFileAttachmentIssue.TOO_LARGE -> R.string.native_attachment_too_large
            NativeFileAttachmentIssue.TOO_MANY_FILES -> R.string.native_attachment_too_many
            NativeFileAttachmentIssue.INVALID_FILE -> R.string.native_attachment_invalid
            NativeFileAttachmentIssue.REQUEST_TOO_LARGE -> R.string.native_attachment_request_too_large
            NativeFileAttachmentIssue.SOURCE_FAILED -> R.string.native_attachment_source_failed
            NativeFileAttachmentIssue.UPLOAD_FAILED -> R.string.native_attachment_upload_failed
            NativeFileAttachmentIssue.PERSISTENCE_FAILED -> R.string.native_attachment_persistence_failed
            null -> R.string.native_attachment_upload_failed
        }
        NativeFileAttachmentPhase.IDLE, null -> null
    }
    message?.let {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (it == R.string.native_attachment_too_large) stringResource(it, model.maxFileBytes) else stringResource(it),
                Modifier.weight(1f).testTag(if (failed) "session-attachment-error" else "session-attachment-status"),
                color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.bodySmall)
            if (current?.phase in setOf(NativeFileAttachmentPhase.SELECTING, NativeFileAttachmentPhase.READING, NativeFileAttachmentPhase.UPLOADING)) {
                TextButton(onClick = { picker.cancel(model) }, modifier = Modifier.testTag("session-attachment-cancel")) {
                    Text(stringResource(R.string.native_attachment_cancel))
                }
            }
        }
    }
}
