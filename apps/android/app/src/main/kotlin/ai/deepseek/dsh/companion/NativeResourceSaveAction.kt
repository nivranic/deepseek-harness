package ai.deepseek.dsh.companion

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*

/** The system creates a new document; the selected provider owns its final name and location. */
internal class NativeResourceDocument : ActivityResultContract<NativeResourceSaveRequest, Uri?>() {
    override fun createIntent(context: Context, input: NativeResourceSaveRequest): Intent =
        Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(input.mediaType).putExtra(Intent.EXTRA_TITLE, input.filename)

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? =
        intent?.data?.takeIf { resultCode == Activity.RESULT_OK }
}

/** Owns only the newly created URI returned by ACTION_CREATE_DOCUMENT. */
internal class AndroidNativeResourceDestination(private val resolver: ContentResolver, private val uri: Uri) : NativeResourceSaveDestination {
    init { require(uri.scheme == ContentResolver.SCHEME_CONTENT) }
    override fun write(bytes: ByteArray) {
        checkNotNull(resolver.openOutputStream(uri, "wt")).use { output -> output.write(bytes); output.flush() }
    }
    override fun discard() { check(DocumentsContract.deleteDocument(resolver, uri)) }
}

/** Keeps the exact Host owner across Activity recreation; process restoration retains no resource bytes or selection. */
internal class NativeResourceSavePicker : ViewModel() {
    private data class Pending(val saver: NativeResourceSaver, val request: NativeResourceSaveRequest)
    private var pending: Pending? = null
    private var hasHandledResult = false
    var busy by mutableStateOf(false)
        private set
    var result by mutableStateOf<NativeResourceSavePhase?>(null)
        private set

    fun begin(source: NativeResourceState, saver: NativeResourceSaver): NativeResourceSaveRequest? {
        if (busy) return null
        val request = saver.prepare(source) ?: return null
        pending = Pending(saver, request)
        hasHandledResult = false
        busy = true
        result = NativeResourceSavePhase.CHOOSING
        return request
    }

    /** Call once for either cancellation or the returned new document; all writes remain owned by the captured Host model. */
    fun complete(destination: NativeResourceSaveDestination?) {
        if (pending == null && hasHandledResult) return
        hasHandledResult = true
        val selected = pending
        pending = null
        busy = true
        result = NativeResourceSavePhase.SAVING
        viewModelScope.launch {
            try {
                result = if (selected == null) {
                    withContext(NonCancellable + Dispatchers.IO) {
                        try { destination?.discard(); NativeResourceSavePhase.EXPIRED }
                        catch (_: Exception) { NativeResourceSavePhase.CLEANUP_FAILED }
                    }
                } else selected.saver.save(selected.request, destination)
            } catch (cancelled: CancellationException) {
                result = selected?.request?.result ?: NativeResourceSavePhase.CANCELLED
                throw cancelled
            } finally { busy = false }
        }
    }

    /** An invalid provider URI cannot become a filesystem target. */
    fun invalidResult() {
        hasHandledResult = true
        pending?.saver?.invalidate()
        pending = null
        busy = false
        result = NativeResourceSavePhase.FAILED
    }

    override fun onCleared() { pending?.saver?.invalidate(); pending = null }

    /** Completed notices belong to the previous selection; clearing presentation never permits a duplicate result. */
    fun selectionChanged() { if (!busy) result = null }
}

/** Register at the application root so tab navigation and Host replacement cannot redirect a picker result. */
@Composable
internal fun rememberNativeResourceSaveLauncher(owner: NativeResourceSavePicker): (NativeResourceState, NativeResourceSaver) -> Unit {
    val resolver = LocalContext.current.contentResolver
    val launcher = rememberLauncherForActivityResult(NativeResourceDocument()) { uri ->
        if (uri != null && uri.scheme != ContentResolver.SCHEME_CONTENT) owner.invalidResult()
        else owner.complete(uri?.let { AndroidNativeResourceDestination(resolver, it) })
    }
    return { source, saver ->
        owner.begin(source, saver)?.let { request ->
            try { launcher.launch(request) }
            catch (_: android.content.ActivityNotFoundException) { owner.invalidResult() }
            catch (_: SecurityException) { owner.invalidResult() }
        }
    }
}

/** Fixed local status never displays provider exception text or a destination URI. */
@Composable
internal fun NativeResourceSaveNotice(owner: NativeResourceSavePicker) {
    val message = when (owner.result) {
        NativeResourceSavePhase.CHOOSING -> R.string.native_resource_save_choosing
        NativeResourceSavePhase.SAVING, NativeResourceSavePhase.RETIRING -> R.string.native_resource_saving
        NativeResourceSavePhase.SAVED -> R.string.native_resource_saved
        NativeResourceSavePhase.CANCELLED -> R.string.native_resource_save_cancelled
        NativeResourceSavePhase.EXPIRED -> R.string.native_resource_save_expired
        NativeResourceSavePhase.FAILED -> R.string.native_resource_save_failed
        NativeResourceSavePhase.CLEANUP_FAILED -> R.string.native_resource_save_cleanup_failed
        NativeResourceSavePhase.IDLE, null -> null
    }
    message?.let { Text(stringResource(it), Modifier.testTag("resource-save-status")) }
}
