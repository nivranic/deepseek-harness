package ai.deepseek.dsh.companion

import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*

/** Navigation remains bound to the original trusted Host model, independently of its changing Session. */
internal data class NativeViewLinkHost(val session: SessionModel, val key: NativeHostKey, val generation: Long, val hostId: String)
internal data class NativeViewLinkAdmission(val host: NativeViewLinkHost? = null, val issue: NativeViewLinkIssue? = null)
internal enum class NativeViewLinkCapability { WAITING, READY, UNAVAILABLE, FAILED }
internal enum class NativeViewLinkPhase { NONE, WAITING, OPENING, OPENED, FAILED, INTERRUPTED }
internal enum class NativeViewLinkIssue { INVALID, UNPAIRED, WRONG_HOST, HOST_UNAVAILABLE, HOST_CHANGED, BUSY, CAPABILITY_UNAVAILABLE, CAPABILITY_FAILED, CANCELLED, NAVIGATION_FAILED }

/** A new VIEW delivery grants one read-only navigation attempt; recovery markers never recreate that grant. */
internal class NativeViewLinkIntake(private val savedState: SavedStateHandle = SavedStateHandle()) : ViewModel() {
    private var created = false
    private var closed = false
    private var boundHost: NativeViewLinkHost? = null
    private var active: Job? = null
    private var terminalIssue: NativeViewLinkIssue? = null
    private var dismissAfter = false
    private var focusedAttempt = 0L
    var arrival by mutableStateOf(0L)
        private set
    var attempt by mutableStateOf(0L)
        private set
    var location by mutableStateOf<NativeViewLocation?>(null)
        private set
    var phase by mutableStateOf(if (savedState.get<String>(DISPOSITION) == "pending") NativeViewLinkPhase.INTERRUPTED else NativeViewLinkPhase.NONE)
        private set
    var issue by mutableStateOf<NativeViewLinkIssue?>(null)
        private set
    var incomingRejected by mutableStateOf(false)
        private set
    var cancelling by mutableStateOf(false)
        private set
    val occupied: Boolean get() = phase == NativeViewLinkPhase.WAITING || active != null

    fun onActivityCreated(intent: Intent, restored: Boolean, admission: NativeViewLinkAdmission) {
        if (created) return
        created = true
        if (restored || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
            if (savedState.get<String>(DISPOSITION) == null && intent.action == Intent.ACTION_VIEW) phase = NativeViewLinkPhase.INTERRUPTED
            return
        }
        receive(intent, admission)
    }

    /** A later delivery cannot replace an outstanding navigation or another source's captured work. */
    fun receive(intent: Intent, admission: NativeViewLinkAdmission) {
        if (intent.action != Intent.ACTION_VIEW || closed || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        if (occupied) { rejectIncoming(); return }
        arrival++
        incomingRejected = false
        when (val parsed = parseNativeViewLinkIntent(intent)) {
            NativeViewLinkParseResult.Ignored -> Unit
            NativeViewLinkParseResult.Invalid -> { location = null; fail(NativeViewLinkIssue.INVALID) }
            is NativeViewLinkParseResult.Accepted -> { location = parsed.location; begin(admission) }
        }
    }

    fun rejectIncoming() { incomingRejected = true }

    /** Configuration recreation cannot clear input focus twice for the same accepted delivery. */
    fun takeFocusReset(): Boolean {
        if (attempt <= focusedAttempt) return false
        focusedAttempt = attempt
        return true
    }

    /** Explicit retry creates new execution authority; changes in Host readiness alone cannot do so. */
    fun retry(admission: NativeViewLinkAdmission) {
        if (closed || occupied || location == null) return
        begin(admission)
    }

    private fun begin(admission: NativeViewLinkAdmission) {
        attempt++; boundHost = null; issue = null; terminalIssue = null; dismissAfter = false; cancelling = false
        phase = NativeViewLinkPhase.WAITING; savedState[DISPOSITION] = "pending"
        admit(admission)
    }

    /** Startup resolution can complete this delivery, but never restarts a failed or cancelled attempt. */
    fun admit(admission: NativeViewLinkAdmission) {
        if (phase != NativeViewLinkPhase.WAITING || active != null) return
        admission.issue?.let { fail(it); return }
        val host = admission.host ?: return
        if (host.hostId != location?.hostId) { fail(NativeViewLinkIssue.WRONG_HOST); return }
        if (boundHost != null && boundHost != host) { fail(NativeViewLinkIssue.HOST_CHANGED); return }
        boundHost = host
    }

    /** Start once after this Host's capability observation completes; stale model callbacks cannot publish success. */
    fun advance(admission: NativeViewLinkAdmission, capability: NativeViewLinkCapability,
                currentHost: () -> NativeViewLinkHost?, onOpening: () -> Unit) {
        if (closed) return
        if (active != null) {
            if (currentHost() != boundHost) stop(NativeViewLinkIssue.HOST_CHANGED)
            return
        }
        if (phase != NativeViewLinkPhase.WAITING) return
        admit(admission)
        if (phase != NativeViewLinkPhase.WAITING) return
        val host = boundHost ?: return
        when (capability) {
            NativeViewLinkCapability.WAITING -> return
            NativeViewLinkCapability.UNAVAILABLE -> { fail(NativeViewLinkIssue.CAPABILITY_UNAVAILABLE); return }
            NativeViewLinkCapability.FAILED -> { fail(NativeViewLinkIssue.CAPABILITY_FAILED); return }
            NativeViewLinkCapability.READY -> Unit
        }
        if (currentHost() != host) { fail(NativeViewLinkIssue.HOST_CHANGED); return }
        val selected = checkNotNull(location)
        var completed = false
        var failure = NativeViewLinkIssue.CANCELLED
        val operation = viewModelScope.launch(start = CoroutineStart.LAZY) {
            try {
                host.session.openViewLocation(selected, host.hostId)
                currentCoroutineContext().ensureActive()
                completed = true
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { failure = NativeViewLinkIssue.NAVIGATION_FAILED }
        }
        active = operation; phase = NativeViewLinkPhase.OPENING
        operation.invokeOnCompletion {
            if (active !== operation) return@invokeOnCompletion
            active = null; cancelling = false
            if (closed) return@invokeOnCompletion
            val retired = currentHost() != host
            if (dismissAfter) clear()
            else if (completed && terminalIssue == null && !retired) {
                phase = NativeViewLinkPhase.OPENED; savedState[DISPOSITION] = "done"; boundHost = null
            } else fail(if (retired) NativeViewLinkIssue.HOST_CHANGED else terminalIssue ?: failure)
        }
        onOpening()
        operation.start()
    }

    /** Cancellation stops anchor loading; the core retains any Session it already opened. */
    fun cancel() { stop(NativeViewLinkIssue.CANCELLED) }

    private fun stop(reason: NativeViewLinkIssue) {
        if (!occupied) return
        terminalIssue = reason
        if (active == null) fail(reason)
        else { cancelling = true; active?.cancel() }
    }

    fun dismiss() {
        if (active == null) clear()
        else { dismissAfter = true; stop(NativeViewLinkIssue.CANCELLED) }
    }

    private fun fail(reason: NativeViewLinkIssue) {
        issue = reason; phase = NativeViewLinkPhase.FAILED; boundHost = null; savedState[DISPOSITION] = "done"
    }

    private fun clear() {
        location = null; issue = null; phase = NativeViewLinkPhase.NONE; boundHost = null
        incomingRejected = false; savedState[DISPOSITION] = "done"
    }

    override fun onCleared() { closed = true; active?.cancel(); location = null }

    private companion object { const val DISPOSITION = "native-view-link-disposition" }
}
