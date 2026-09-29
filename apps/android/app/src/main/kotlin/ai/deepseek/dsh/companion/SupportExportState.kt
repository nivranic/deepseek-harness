package ai.deepseek.dsh.companion

import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel

internal enum class SupportExportStage { IDLE, SCANNING, CHOOSING, SAVING, SAVED, CANCELLED, FAILED, APPROVAL_LOST, SAVE_FAILED }

/** Activity-scoped, memory-only approval survives configuration recreation but never process restoration. */
internal class SupportExportState : ViewModel() {
    val stage = mutableStateOf(SupportExportStage.IDLE)
    private var pending: ApprovedSupportDocument? = null

    /** Retain only scanner-admitted bytes while the system picker owns the foreground. */
    fun approve(document: ApprovedSupportDocument) {
        pending = document
        stage.value = SupportExportStage.CHOOSING
    }

    /** Consume once on either save or cancellation; another result cannot reuse approval. */
    fun takeApproval(): ApprovedSupportDocument? {
        val document = pending
        pending = null
        return document
    }

    override fun onCleared() {
        pending = null
    }
}
