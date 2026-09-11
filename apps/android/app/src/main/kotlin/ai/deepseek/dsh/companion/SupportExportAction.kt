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
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

/** Locale-owned labels never include an exception, scanner output or destination path. */
private data class SupportExportCopy(val export: String, val cancel: String, val scanning: String, val choosing: String,
                                     val saving: String, val saved: String, val cancelled: String, val failed: String,
                                     val approvalLost: String, val saveFailed: String) {
    companion object {
        fun forLocale(locale: Locale) = if (locale.language == "zh") {
            SupportExportCopy("导出诊断", "取消", "正在检查诊断内容", "请选择本地保存位置", "正在保存", "诊断已保存", "已取消导出", "无法导出诊断",
                "诊断内容已失效，请重新导出", "无法写入所选位置，请重新导出")
        } else {
            SupportExportCopy("Export diagnostics", "Cancel", "Checking diagnostics", "Choose a local destination", "Saving", "Diagnostics saved", "Export cancelled", "Diagnostics unavailable",
                "Diagnostics expired. Export again", "Cannot write to the selected destination. Export again")
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
fun SupportExportAction(readSnapshot: () -> SupportLocalSnapshot) {
    val context = LocalContext.current
    val copy = SupportExportCopy.forLocale(context.resources.configuration.locales[0])
    val scope = rememberCoroutineScope()
    val exporter = remember(context) { SupportDocumentExporter(AndroidSupportScanner(context), SupportExportPolicy(1024 * 1024, 10_000)) }
    val owner: SupportExportState = viewModel()
    var stage by owner.stage
    var work by remember { mutableStateOf<Job?>(null) }
    val destination = rememberLauncherForActivityResult(LocalSupportDocument()) { uri ->
        val document = owner.takeApproval()
        if (uri == null) {
            stage = SupportExportStage.CANCELLED
        } else if (document == null) {
            // A new process or cleared owner has no approval to deliver.
            stage = SupportExportStage.APPROVAL_LOST
        } else {
            work = scope.launch {
                stage = SupportExportStage.SAVING
                try {
                    deliverSupportDocument(document, AndroidSupportDestination(context.contentResolver, uri))
                    stage = SupportExportStage.SAVED
                } catch (cancelled: CancellationException) {
                    stage = SupportExportStage.CANCELLED
                    throw cancelled
                } catch (_: Exception) {
                    stage = SupportExportStage.SAVE_FAILED
                }
            }
        }
    }
    Column {
        Button(modifier = Modifier.testTag("support-export"), enabled = stage !in setOf(SupportExportStage.SCANNING, SupportExportStage.CHOOSING, SupportExportStage.SAVING), onClick = {
            work = scope.launch {
                owner.takeApproval()
                stage = SupportExportStage.SCANNING
                try {
                    val snapshot = readSnapshot()
                    val product = withContext(Dispatchers.IO) {
                        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
                        val application = context.packageManager.getApplicationInfo(context.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
                        SupportProductIdentity(info.versionName.orEmpty(), info.longVersionCode,
                            application.metaData?.getString("ai.deepseek.dsh.distributionChannel").orEmpty())
                    }
                    val document = exporter.prepare(product, snapshot)
                    currentCoroutineContext().ensureActive()
                    owner.approve(document)
                    destination.launch("dsh-support.json")
                } catch (cancelled: CancellationException) {
                    stage = SupportExportStage.CANCELLED
                    throw cancelled
                } catch (_: Exception) {
                    owner.takeApproval()
                    stage = SupportExportStage.FAILED
                }
            }
        }) { Text(copy.export) }
        if (stage == SupportExportStage.SCANNING) {
            Button(modifier = Modifier.testTag("support-export-cancel"), onClick = { work?.cancel() }) { Text(copy.cancel) }
        }
        val message = when (stage) {
            SupportExportStage.IDLE -> null
            SupportExportStage.SCANNING -> copy.scanning
            SupportExportStage.CHOOSING -> copy.choosing
            SupportExportStage.SAVING -> copy.saving
            SupportExportStage.SAVED -> copy.saved
            SupportExportStage.CANCELLED -> copy.cancelled
            SupportExportStage.FAILED -> copy.failed
            SupportExportStage.APPROVAL_LOST -> copy.approvalLost
            SupportExportStage.SAVE_FAILED -> copy.saveFailed
        }
        message?.let { Text(it, modifier = Modifier.testTag("support-export-status")) }
    }
}
