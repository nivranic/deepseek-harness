package ai.deepseek.dsh.companion

import android.content.Context
import android.content.ContentResolver
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

private enum class ExportStage { IDLE, SCANNING, CHOOSING, SAVING, SAVED, CANCELLED, FAILED }

/** Locale-owned labels never include an exception, scanner output or destination path. */
private data class SupportExportCopy(val export: String, val cancel: String, val scanning: String, val choosing: String,
                                     val saving: String, val saved: String, val cancelled: String, val failed: String) {
    companion object {
        fun forLocale(locale: Locale) = if (locale.language == "zh") {
            SupportExportCopy("导出诊断", "取消", "正在检查诊断内容", "请选择本地保存位置", "正在保存", "诊断已保存", "已取消导出", "无法导出诊断")
        } else {
            SupportExportCopy("Export diagnostics", "Cancel", "Checking diagnostics", "Choose a local destination", "Saving", "Diagnostics saved", "Export cancelled", "Diagnostics unavailable")
        }
    }
}

private class LocalSupportDocument : ActivityResultContracts.CreateDocument("application/json") {
    override fun createIntent(context: Context, input: String): Intent =
        super.createIntent(context, input).putExtra(Intent.EXTRA_LOCAL_ONLY, true)
}

private class AndroidSupportDestination(private val resolver: ContentResolver, private val uri: Uri) : SupportSaveDestination {
    override fun write(bytes: ByteArray) {
        val output = resolver.openOutputStream(uri, "wt")
            ?: throw SupportExportException(SupportExportFailure.SAVE_FAILED)
        output.use { it.write(bytes); it.flush() }
    }

    override fun discard() {
        if (!DocumentsContract.deleteDocument(resolver, uri)) throw SupportExportException(SupportExportFailure.SAVE_FAILED)
    }
}

/** Available before pairing; only an admitted in-memory document can reach the selected local destination. */
@Composable
fun SupportExportAction() {
    val context = LocalContext.current
    val copy = SupportExportCopy.forLocale(context.resources.configuration.locales[0])
    val scope = rememberCoroutineScope()
    val exporter = remember(context) { SupportDocumentExporter(AndroidSupportScanner(context), SupportExportPolicy(1024 * 1024, 10_000)) }
    var stage by remember { mutableStateOf(ExportStage.IDLE) }
    var pending by remember { mutableStateOf<ApprovedSupportDocument?>(null) }
    var work by remember { mutableStateOf<Job?>(null) }
    val destination = rememberLauncherForActivityResult(LocalSupportDocument()) { uri ->
        val document = pending
        pending = null
        if (uri == null) {
            stage = ExportStage.CANCELLED
        } else if (document == null) {
            // Process or activity recreation discards approval; the new owner cannot deliver bytes.
            stage = ExportStage.FAILED
        } else {
            work = scope.launch {
                stage = ExportStage.SAVING
                try {
                    deliverSupportDocument(document, AndroidSupportDestination(context.contentResolver, uri))
                    stage = ExportStage.SAVED
                } catch (cancelled: CancellationException) {
                    stage = ExportStage.CANCELLED
                    throw cancelled
                } catch (_: Exception) {
                    stage = ExportStage.FAILED
                }
            }
        }
    }
    Column {
        Button(modifier = Modifier.testTag("support-export"), enabled = stage !in setOf(ExportStage.SCANNING, ExportStage.CHOOSING, ExportStage.SAVING), onClick = {
            work = scope.launch {
                pending = null
                stage = ExportStage.SCANNING
                try {
                    val product = withContext(Dispatchers.IO) {
                        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
                        val application = context.packageManager.getApplicationInfo(context.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
                        SupportProductIdentity(info.versionName.orEmpty(), info.longVersionCode,
                            application.metaData?.getString("ai.deepseek.dsh.distributionChannel").orEmpty())
                    }
                    val snapshot = SupportLocalSnapshot(CompanionRuntime.restored, CompanionRuntime.wire.requestSnapshot())
                    val document = exporter.prepare(product, snapshot)
                    currentCoroutineContext().ensureActive()
                    pending = document
                    stage = ExportStage.CHOOSING
                    destination.launch("dsh-support.json")
                } catch (cancelled: CancellationException) {
                    stage = ExportStage.CANCELLED
                    throw cancelled
                } catch (_: Exception) {
                    pending = null
                    stage = ExportStage.FAILED
                }
            }
        }) { Text(copy.export) }
        if (stage == ExportStage.SCANNING) {
            Button(modifier = Modifier.testTag("support-export-cancel"), onClick = { work?.cancel() }) { Text(copy.cancel) }
        }
        val message = when (stage) {
            ExportStage.IDLE -> null
            ExportStage.SCANNING -> copy.scanning
            ExportStage.CHOOSING -> copy.choosing
            ExportStage.SAVING -> copy.saving
            ExportStage.SAVED -> copy.saved
            ExportStage.CANCELLED -> copy.cancelled
            ExportStage.FAILED -> copy.failed
        }
        message?.let { Text(it, modifier = Modifier.testTag("support-export-status")) }
    }
}
