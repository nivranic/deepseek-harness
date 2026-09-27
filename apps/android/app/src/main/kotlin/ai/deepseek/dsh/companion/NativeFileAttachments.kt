package ai.deepseek.dsh.companion

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.PickVisualMediaRequest
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
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
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
    override fun mediaType(): String? = resolver.getType(uri)
}

/** AndroidX selects the system single-image picker or its platform-supported fallback. */
internal fun nativePhotoPickerRequest() = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)

internal enum class NativeAttachmentOrigin { FILES, PHOTOS, CAMERA }

/** Keeps the original model and one selection across rotation. Process restoration has no upload authority. */
internal class NativeFileAttachmentPicker(private val savedState: SavedStateHandle = SavedStateHandle()) : ViewModel() {
    private data class Pending(val model: NativeFileAttachmentsModel, val selection: NativeFileSelection,
                               val sessionId: String?, val origin: NativeAttachmentOrigin, val cancelled: Boolean = false,
                               val camera: NativeCameraOutput? = null, val launched: Boolean = false)
    private data class Failure(val model: NativeFileAttachmentsModel, val sessionId: String?)
    private var pending: Pending? = null
    private var failure by mutableStateOf<Failure?>(null)
    private var cameraOwner: Pair<NativeFileAttachmentsModel, NativeFileSelection>? = null
    private var restorationStarted = false
    private var restorationCleanup = false
    private var awaitingCameraResult = savedState.get<Boolean>(CAMERA_AWAITING) == true
    var cameraName by mutableStateOf(savedState.get<String>(CAMERA_NAME))
        private set
    var cameraCleanupFailed by mutableStateOf(false)
        private set
    var busy by mutableStateOf(cameraName != null)
        private set

    fun begin(model: NativeFileAttachmentsModel, kind: NativeAttachmentKind = NativeAttachmentKind.FILE): NativeFileSelection? {
        return begin(model, if (kind == NativeAttachmentKind.FILE) NativeAttachmentOrigin.FILES else NativeAttachmentOrigin.PHOTOS)
    }

    private fun begin(model: NativeFileAttachmentsModel, origin: NativeAttachmentOrigin, cleanup: (() -> Unit)? = null): NativeFileSelection? {
        if (pending != null || busy) return null
        val selection = model.prepare(if (origin == NativeAttachmentOrigin.FILES) NativeAttachmentKind.FILE else NativeAttachmentKind.IMAGE, cleanup) ?: return null
        pending = Pending(model, selection, model.state.value.sessionId, origin)
        failure = null
        busy = true
        return selection
    }

    fun beginCamera(model: NativeFileAttachmentsModel, files: NativeCameraFiles): NativeCameraOutput? {
        val reservation = NativeCameraReservation()
        val selection = begin(model, NativeAttachmentOrigin.CAMERA, reservation::close) ?: return null
        cameraOwner = model to selection
        var output: NativeCameraOutput? = null
        try {
            output = reservation.create(files)
            pending = pending?.copy(camera = output)
            cameraName = output.name
            savedState[CAMERA_NAME] = output.name
        } catch (_: Exception) { cameraLaunchFailed(cameraName) }
        val name = output?.name
        viewModelScope.launch {
            selection.awaitReleased()
            if (cameraOwner?.second === selection) {
                cameraOwner = null
                val awaitingResult = pending?.let { it.selection === selection && it.launched } == true
                if (!awaitingResult && pending?.selection === selection) pending = null
                if (selection.cleanupFailed) cameraCleanupFailed = true
                else if (!awaitingResult && cameraName == name) clearCameraName()
                busy = pending != null
            }
        }
        return output
    }

    /** Only an in-memory selection can launch; restored names never authorize another camera intent. */
    fun takeCameraLaunch(name: String): Uri? {
        val selected = pending?.takeIf { it.origin == NativeAttachmentOrigin.CAMERA && it.camera?.name == name && !it.launched && !it.cancelled } ?: return null
        pending = selected.copy(launched = true)
        awaitingCameraResult = true
        savedState[CAMERA_AWAITING] = true
        return selected.camera?.uri
    }

    fun completeCamera(name: String?, succeeded: Boolean) {
        val selected = pending?.takeIf { it.origin == NativeAttachmentOrigin.CAMERA && it.camera?.name == name }
        if (selected == null) {
            if (cameraName != name || !awaitingCameraResult || cameraOwner != null) return
            consumeCameraResult()
            if (restorationStarted && !restorationCleanup && !cameraCleanupFailed) clearCameraName()
            busy = !restorationStarted || restorationCleanup
            return
        }
        consumeCameraResult()
        pending = null
        if (!succeeded || selected.cancelled) selected.model.cancelSelection(selected.selection)
        else selected.model.accept(selected.selection, checkNotNull(selected.camera))
        busy = cameraOwner != null
        if (!busy && !selected.selection.cleanupFailed && cameraName == name) clearCameraName()
    }

    fun cameraLaunchFailed(name: String?) {
        val selected = pending?.takeIf { it.origin == NativeAttachmentOrigin.CAMERA && (it.camera?.name == name || it.camera == null) } ?: return
        consumeCameraResult()
        pending = null
        selected.model.cancelSelection(selected.selection)
        failure = Failure(selected.model, selected.sessionId)
        busy = cameraOwner != null
        if (!busy && !selected.selection.cleanupFailed && cameraName == name) clearCameraName()
    }

    /** Cleanup metadata survives process restoration, without reconstructing a model or selection ticket. */
    fun restoreCamera(files: NativeCameraFiles) {
        cameraCleanupFailed = cameraCleanupFailed || files.orphanCleanupFailed
        if (restorationStarted) return
        restorationStarted = true
        val name = cameraName?.takeIf { cameraOwner == null && pending == null } ?: return
        busy = true
        restorationCleanup = true
        viewModelScope.launch {
            val cleaned = withContext(NonCancellable + Dispatchers.IO) {
                try { files.cleanupRestored(name); true } catch (_: Exception) { false }
            }
            restorationCleanup = false
            if (cleaned && cameraName == name && !awaitingCameraResult) clearCameraName()
            if (!cleaned) cameraCleanupFailed = true
            busy = pending != null || cameraOwner != null || awaitingCameraResult
        }
    }

    private fun consumeCameraResult() { awaitingCameraResult = false; savedState.remove<Boolean>(CAMERA_AWAITING) }
    private fun clearCameraName() { cameraName = null; savedState.remove<String>(CAMERA_NAME); consumeCameraResult() }

    /** A duplicate or process-restored result has no captured selection and never opens the source. */
    fun complete(source: NativeFileAttachmentSource?, kind: NativeAttachmentKind = NativeAttachmentKind.FILE) {
        val selected = pending ?: return
        if (selected.origin != if (kind == NativeAttachmentKind.FILE) NativeAttachmentOrigin.FILES else NativeAttachmentOrigin.PHOTOS) return
        pending = null
        busy = false
        if (source == null || selected.cancelled) selected.model.cancelSelection(selected.selection)
        else selected.model.accept(selected.selection, source)
    }

    /** Invalid URIs and launch failures expose fixed local copy, never provider paths or exception messages. */
    fun invalidResult(kind: NativeAttachmentKind = NativeAttachmentKind.FILE) {
        val selected = pending ?: return
        if (selected.origin != if (kind == NativeAttachmentKind.FILE) NativeAttachmentOrigin.FILES else NativeAttachmentOrigin.PHOTOS) return
        pending = null
        busy = false
        selected.model.cancelSelection(selected.selection)
        if (!selected.cancelled) failure = Failure(selected.model, selected.sessionId)
    }

    fun failedFor(model: NativeFileAttachmentsModel, sessionId: String): Boolean =
        failure?.let { it.model === model && it.sessionId == sessionId } == true

    /** A launched picker retains its callback until the cancelled result is discarded. */
    fun cancel(model: NativeFileAttachmentsModel) {
        pending?.takeIf { it.model === model }?.let {
            pending = it.copy(cancelled = true)
            it.model.cancelSelection(it.selection)
        }
        model.cancel()
    }

    override fun onCleared() {
        pending?.let { it.model.cancelSelection(it.selection) }
        cameraOwner?.first?.cancel()
        pending = null
    }

    private companion object {
        const val CAMERA_NAME = "native-camera-output"
        const val CAMERA_AWAITING = "native-camera-awaiting-result"
    }
}

/** The application root owns registration so a late result retains its original Host and Session owner. */
@Composable
internal fun rememberNativeFileAttachmentLauncher(owner: NativeFileAttachmentPicker): (NativeFileAttachmentsModel, NativeAttachmentOrigin) -> Unit {
    val context = LocalContext.current
    val resolver = context.contentResolver
    val cameraFiles = remember(context.applicationContext) { NativeCameraFiles.get(context) }
    LaunchedEffect(owner, cameraFiles) { owner.restoreCamera(cameraFiles) }
    val cameraName = owner.cameraName
    key(cameraName) {
        val camera = rememberLauncherForActivityResult(NativeCameraPicture()) { succeeded -> owner.completeCamera(cameraName, succeeded) }
        LaunchedEffect(cameraName) {
            cameraName?.let(owner::takeCameraLaunch)?.let { uri ->
                try { camera.launch(uri) }
                catch (_: android.content.ActivityNotFoundException) { owner.cameraLaunchFailed(cameraName) }
                catch (_: SecurityException) { owner.cameraLaunchFailed(cameraName) }
            }
        }
    }
    val launcher = rememberLauncherForActivityResult(NativeFileDocument()) { uri ->
        if (uri != null && uri.scheme != ContentResolver.SCHEME_CONTENT) owner.invalidResult()
        else owner.complete(uri?.let { AndroidNativeFileAttachmentSource(resolver, it) })
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null && uri.scheme != ContentResolver.SCHEME_CONTENT) owner.invalidResult(NativeAttachmentKind.IMAGE)
        else owner.complete(uri?.let { AndroidNativeFileAttachmentSource(resolver, it) }, NativeAttachmentKind.IMAGE)
    }
    return { model, origin ->
        val kind = if (origin == NativeAttachmentOrigin.FILES) NativeAttachmentKind.FILE else NativeAttachmentKind.IMAGE
        if (origin == NativeAttachmentOrigin.CAMERA) owner.beginCamera(model, cameraFiles)
        else if (owner.begin(model, kind) != null) {
            try {
                when (kind) {
                    NativeAttachmentKind.FILE -> launcher.launch(Unit)
                    NativeAttachmentKind.IMAGE -> photos.launch(nativePhotoPickerRequest())
                }
            }
            catch (_: android.content.ActivityNotFoundException) { owner.invalidResult(kind) }
            catch (_: SecurityException) { owner.invalidResult(kind) }
        }
    }
}

@Composable
internal fun NativeFileAttachmentAddButton(enabled: Boolean, allowFiles: Boolean, allowImages: Boolean,
                                          select: (NativeAttachmentOrigin) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val label = stringResource(R.string.native_attachment_add)
    Box {
        FilledTonalIconButton(onClick = { expanded = true }, enabled = enabled,
            modifier = Modifier.testTag("session-attach").semantics { contentDescription = label }) {
            Text(stringResource(R.string.native_attachment_plus), style = MaterialTheme.typography.titleLarge)
        }
        DropdownMenu(expanded = expanded && enabled, onDismissRequest = { expanded = false }) {
            if (allowFiles) DropdownMenuItem(text = { Text(stringResource(R.string.native_attachment_file)) },
                modifier = Modifier.testTag("session-attach-file"), onClick = { expanded = false; select(NativeAttachmentOrigin.FILES) })
            if (allowImages) DropdownMenuItem(text = { Text(stringResource(R.string.native_attachment_photo)) },
                modifier = Modifier.testTag("session-attach-photo"), onClick = { expanded = false; select(NativeAttachmentOrigin.PHOTOS) })
            if (allowImages) DropdownMenuItem(text = { Text(stringResource(R.string.native_attachment_camera)) },
                modifier = Modifier.testTag("session-attach-camera"), onClick = { expanded = false; select(NativeAttachmentOrigin.CAMERA) })
        }
    }
}

/** Completed receipts remain part of the current draft until explicit removal or submission. */
@Composable
internal fun NativeFileAttachmentCards(files: List<SessionAttachment>, enabled: Boolean, remove: (String) -> Unit) {
    if (files.isEmpty()) return
    Column(Modifier.fillMaxWidth().heightIn(max = 176.dp).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        files.forEach { file ->
            OutlinedCard(Modifier.fillMaxWidth().testTag("session-attachment-${file.receiptId}")) {
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(file.name ?: stringResource(R.string.native_attachment_image), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(when (file) {
                            is SessionFileAttachment -> stringResource(R.string.native_attachment_bytes, file.bytes)
                            is SessionImageAttachment -> stringResource(R.string.native_attachment_image_detail, file.mediaType, file.width, file.height, file.bytes)
                        }, style = MaterialTheme.typography.bodySmall)
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
internal fun NativePendingFileAttachments(files: List<SessionAttachment>) {
    files.forEach { file ->
        Text(stringResource(R.string.native_attachment_detail, file.name ?: stringResource(R.string.native_attachment_image), file.bytes), style = MaterialTheme.typography.bodySmall)
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
        NativeFileAttachmentPhase.CLEANING -> R.string.native_camera_cleaning
        NativeFileAttachmentPhase.FAILED -> when (current?.issue) {
            NativeFileAttachmentIssue.TOO_LARGE -> R.string.native_attachment_too_large
            NativeFileAttachmentIssue.TOO_MANY_FILES -> R.string.native_attachment_too_many
            NativeFileAttachmentIssue.INVALID_FILE -> R.string.native_attachment_invalid
            NativeFileAttachmentIssue.UNSUPPORTED_IMAGE -> R.string.native_attachment_unsupported_image
            NativeFileAttachmentIssue.REQUEST_TOO_LARGE -> R.string.native_attachment_request_too_large
            NativeFileAttachmentIssue.SOURCE_FAILED -> R.string.native_attachment_source_failed
            NativeFileAttachmentIssue.UPLOAD_FAILED -> R.string.native_attachment_upload_failed
            NativeFileAttachmentIssue.PERSISTENCE_FAILED -> R.string.native_attachment_persistence_failed
            NativeFileAttachmentIssue.CLEANUP_FAILED -> R.string.native_camera_cleanup_failed
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
