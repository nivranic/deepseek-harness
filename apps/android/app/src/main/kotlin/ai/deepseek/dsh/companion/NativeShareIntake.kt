package ai.deepseek.dsh.companion

import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

/** A displayed target captures one Host model and one ordinary Session generation. */
internal data class NativeShareTarget(
    val model: NativeFileAttachmentsModel,
    val inputs: CompanionInputState,
    val hostKey: NativeHostKey,
    val hostGeneration: Long,
    val sessionId: String,
    val sessionGeneration: Long,
)

internal enum class NativeSharePhase { NONE, REVIEW, IMPORTING, ADOPTED, SAVE_FAILED, FAILED, INTERRUPTED, REJECTED }

/** Intake holds untrusted provider references only in memory; restoring its marker cannot restart import. */
internal class NativeShareIntake(private val savedState: SavedStateHandle = SavedStateHandle()) : ViewModel() {
    private var created = false
    private var active: NativeShareImport? = null
    private var capturedTarget: NativeShareTarget? = null
    private var adoptedInputs: CompanionInputState? = null
    private var discardRequested = false
    private var targetChanged = false
    var arrival: Long = 0
        private set
    var payload by mutableStateOf<NativeSharePayload?>(null)
        private set
    var phase by mutableStateOf(if (savedState.get<String>(DISPOSITION) == "pending") NativeSharePhase.INTERRUPTED else NativeSharePhase.NONE)
        private set
    var rejection by mutableStateOf<NativeShareRejection?>(null)
        private set
    var issue by mutableStateOf<NativeShareIssue?>(null)
        private set
    var attachmentIssue by mutableStateOf<NativeFileAttachmentIssue?>(null)
        private set
    var incomingRejected by mutableStateOf(false)
        private set
    val occupied: Boolean get() = payload != null || active != null

    /** Rotation retains this instance; a reconstructed Activity never replays its original share Intent. */
    fun onActivityCreated(intent: Intent, restored: Boolean, ownPackage: String) {
        if (created) return
        created = true
        if (restored || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
            if (savedState.get<String>(DISPOSITION) == null && intent.action in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) {
                phase = NativeSharePhase.INTERRUPTED
            }
            return
        }
        receive(intent, ownPackage)
    }

    /** Each explicit new delivery is distinct, including another share of the same URI. */
    fun receive(intent: Intent, ownPackage: String) {
        if (intent.action !in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return
        if (payload != null || active != null) { incomingRejected = true; return }
        arrival++
        adoptedInputs = null
        incomingRejected = false
        rejection = null; issue = null; attachmentIssue = null
        when (val parsed = parseNativeShareIntent(intent, ownPackage)) {
            NativeShareParseResult.Ignored -> Unit
            is NativeShareParseResult.Rejected -> {
                rejection = parsed.issue; phase = NativeSharePhase.REJECTED; savedState[DISPOSITION] = "done"
            }
            is NativeShareParseResult.Accepted -> {
                payload = parsed.payload; phase = NativeSharePhase.REVIEW; savedState[DISPOSITION] = "pending"
            }
        }
    }

    /** Only a still-displayed target may start an import; source factories do not open provider data. */
    fun confirm(target: NativeShareTarget, allowedKinds: Set<NativeAttachmentKind>,
                currentTarget: () -> NativeShareTarget?, admitted: () -> Boolean,
                source: (NativeSharedUri) -> NativeFileAttachmentSource) {
        val selected = payload ?: return
        if (active != null) return
        if (currentTarget() != target) { issue = NativeShareIssue.STALE_TARGET; phase = NativeSharePhase.FAILED; return }
        if (!admitted()) { issue = NativeShareIssue.BUSY; phase = NativeSharePhase.FAILED; return }
        val request = NativeShareRequest(target.sessionId, target.sessionGeneration, selected.text,
            selected.items.map { NativeShareItem(source(it), it.requireImage) }, allowedKinds)
        val operation = target.model.importShare(request, NativeShareLimits(65_536))
        active = operation; capturedTarget = target; discardRequested = false; targetChanged = false
        issue = null; attachmentIssue = null; phase = NativeSharePhase.IMPORTING
        viewModelScope.launch {
            val result = operation.awaitResult()
            if (active !== operation) return@launch
            active = null; capturedTarget = null
            when (result) {
                is NativeShareResult.Adopted -> {
                    adoptedInputs = target.inputs
                    payload = null; savedState[DISPOSITION] = "done"
                    phase = if (result.saved) NativeSharePhase.ADOPTED else NativeSharePhase.SAVE_FAILED
                }
                is NativeShareResult.NotAdopted -> {
                    if (discardRequested) clear()
                    else {
                        issue = if (targetChanged) NativeShareIssue.STALE_TARGET else result.issue
                        attachmentIssue = result.attachmentIssue
                        phase = NativeSharePhase.FAILED
                    }
                }
            }
        }
    }

    /** A Host or Session change cancels the captured import without selecting a replacement target. */
    fun observeTarget(target: NativeShareTarget?) {
        if (active != null && capturedTarget != target) { targetChanged = true; active?.cancel() }
    }

    /** Only the adopting input owner's successful checkpoint resolves its save notice. */
    fun observePersistence(inputs: CompanionInputState, status: InputPersistenceStatus) {
        if (phase == NativeSharePhase.SAVE_FAILED && adoptedInputs === inputs && status == InputPersistenceStatus.SAVED) phase = NativeSharePhase.ADOPTED
    }

    fun dismiss() {
        val operation = active
        if (operation == null) clear()
        else { discardRequested = true; operation.cancel() }
    }

    private fun clear() {
        payload = null; phase = NativeSharePhase.NONE; rejection = null; issue = null; attachmentIssue = null
        incomingRejected = false; savedState[DISPOSITION] = "done"
        adoptedInputs = null
    }

    override fun onCleared() { active?.cancel(); payload = null }

    private companion object { const val DISPOSITION = "native-share-disposition" }
}
