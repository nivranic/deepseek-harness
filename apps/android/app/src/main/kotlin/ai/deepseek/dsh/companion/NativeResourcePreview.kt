package ai.deepseek.dsh.companion

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Shared inert resource preview for workspace entries and durable delivery declarations. */
@Composable
fun NativeResourcePreview(state: NativeResourceState, retry: () -> Unit, restart: () -> Unit, close: () -> Unit,
                          limits: NativeResourcePresentationLimits = NativeResourcePresentationLimits(64 * 1024, 4_000_000),
                          save: (() -> Unit)? = null, saving: Boolean = false) {
    val media = remember(state.prefix) { nativeResourceMedia(state.prefix) }
    val text = remember(state.content, media) { if (media == null) state.content?.let(::nativeResourceText) else null }
    val bytes = state.content
    val totalBytes = state.descriptor?.bytes
    val bitmap by produceState<Pair<ByteArray, Bitmap?>?>(null, bytes, media, limits.maxImagePixels) {
        value = null
        if (bytes != null && media?.startsWith("image/") == true) value = withContext(Dispatchers.Default) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            bytes to if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > limits.maxImagePixels) null
            else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(state.target.path, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            Button(onClick = close, modifier = Modifier.testTag("resource-close")) { Text(stringResource(R.string.native_resource_close)) }
        }
        Text(media ?: if (text != null) "text/plain" else "application/octet-stream", style = MaterialTheme.typography.labelSmall)
        Text(if (totalBytes == null) stringResource(R.string.native_resource_progress_unknown, state.receivedBytes)
            else stringResource(R.string.native_resource_progress, state.receivedBytes, totalBytes), Modifier.testTag("resource-progress"))
        if (state.phase == NativeResourcePhase.READY && state.content != null && save != null) {
            Button(onClick = save, enabled = !saving, modifier = Modifier.testTag("resource-save")) {
                Text(stringResource(R.string.native_resource_save))
            }
        }
        when (state.phase) {
            NativeResourcePhase.LOADING -> Text(stringResource(R.string.native_resource_loading))
            NativeResourcePhase.PREVIEW -> Text(stringResource(R.string.native_resource_bounded_preview), Modifier.testTag("resource-bounded"))
            NativeResourcePhase.FAILED -> {
                Text(stringResource(R.string.native_resource_failed), Modifier.testTag("resource-failure"), color = MaterialTheme.colorScheme.error)
                Button(onClick = retry, modifier = Modifier.testTag("resource-retry")) { Text(stringResource(R.string.native_resource_retry)) }
            }
            NativeResourcePhase.CHANGED -> {
                Text(stringResource(R.string.native_resource_changed), Modifier.testTag("resource-changed"))
                Button(onClick = restart, modifier = Modifier.testTag("resource-restart")) { Text(stringResource(R.string.native_resource_restart)) }
            }
            NativeResourcePhase.READY -> if (state.receivedBytes == 0) Text(stringResource(R.string.native_resource_empty), Modifier.testTag("resource-empty"))
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
            val decoded = bitmap?.takeIf { it.first === bytes }
            val image = decoded?.second
            if (image != null) Image(image.asImageBitmap(), stringResource(R.string.native_resource_image),
                Modifier.fillMaxWidth().heightIn(max = 500.dp).testTag("resource-image"))
            else if (text != null) {
                Text(text.take(limits.maxTextChars), Modifier.testTag("resource-text"), style = MaterialTheme.typography.bodySmall)
                if (text.length > limits.maxTextChars) Text(stringResource(R.string.native_resource_text_limited))
            } else if (state.prefix.isNotEmpty()) {
                if (media?.startsWith("image/") == true && decoded != null) {
                    Text(stringResource(R.string.native_resource_image_unavailable), Modifier.testTag("resource-image-unavailable"))
                }
                Text(nativeResourceHex(state.prefix), Modifier.testTag("resource-hex"), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
