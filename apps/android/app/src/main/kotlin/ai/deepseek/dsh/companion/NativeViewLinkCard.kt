package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeDescriptionState
import ai.deepseek.dsh.gateway.NativeObservedCapability
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** The exact live model identity is checked before navigation and again before publishing completion. */
internal fun nativeViewLinkHost(model: CompanionViewModel): NativeViewLinkHost? {
    val state = CompanionRuntime.hostState.value
    val host = state.selected ?: return null
    if (!model.paired || model.switching || model.pairingRequested || state.status != NativeHostStatus.READY || model.generation != state.generation) return null
    return NativeViewLinkHost(model.session, host.key, state.generation, host.hostId)
}

internal fun nativeViewLinkAdmission(model: CompanionViewModel, runtimeResolved: Boolean,
                                     picker: NativeFileAttachmentPicker, share: NativeShareIntake): NativeViewLinkAdmission {
    if (share.occupied || picker.busy || model.session.sending.value || model.attachments.state.value.phase in setOf(
            NativeFileAttachmentPhase.SELECTING, NativeFileAttachmentPhase.READING, NativeFileAttachmentPhase.UPLOADING, NativeFileAttachmentPhase.CLEANING)) {
        return NativeViewLinkAdmission(issue = NativeViewLinkIssue.BUSY)
    }
    if (!runtimeResolved) return NativeViewLinkAdmission()
    val host = nativeViewLinkHost(model)
    if (host != null) return NativeViewLinkAdmission(host)
    return NativeViewLinkAdmission(issue = if (CompanionRuntime.hostState.value.status == NativeHostStatus.EMPTY)
        NativeViewLinkIssue.UNPAIRED else NativeViewLinkIssue.HOST_UNAVAILABLE)
}

/** A failed refresh cannot reuse retained capability facts as a successful observation. */
internal fun nativeViewLinkCapability(observation: NativeHostObservation): NativeViewLinkCapability {
    val snapshot = observation.snapshot
    if (observation.failed) return NativeViewLinkCapability.FAILED
    if (snapshot?.closed == true) return NativeViewLinkCapability.FAILED
    if (observation.refreshing) return NativeViewLinkCapability.WAITING
    if (snapshot == null) return if (observation.completed) NativeViewLinkCapability.FAILED else NativeViewLinkCapability.WAITING
    return when (snapshot.descriptionState) {
        NativeDescriptionState.NOT_REQUESTED, NativeDescriptionState.CHECKING ->
            if (observation.completed) NativeViewLinkCapability.FAILED else NativeViewLinkCapability.WAITING
        NativeDescriptionState.FAILED, NativeDescriptionState.CANCELLED, NativeDescriptionState.RETIRED -> NativeViewLinkCapability.FAILED
        NativeDescriptionState.AVAILABLE -> snapshot.description?.let { description ->
            if (NativeObservedCapability.SESSION_FOLLOW in description.capabilities) NativeViewLinkCapability.READY
            else NativeViewLinkCapability.UNAVAILABLE
        } ?: NativeViewLinkCapability.FAILED
    }
}

/** The root keeps delivery admission alive across tab changes and configuration recreation. */
@Composable
internal fun NativeViewLinkEffects(owner: NativeViewLinkIntake, model: CompanionViewModel,
                                  description: NativeHostObservation, picker: NativeFileAttachmentPicker,
                                  share: NativeShareIntake, onOpening: () -> Unit) {
    val hosts by CompanionRuntime.hostState.collectAsStateWithLifecycle()
    val sending by model.session.sending.collectAsStateWithLifecycle()
    val attachments by model.attachments.state.collectAsStateWithLifecycle()
    val host = nativeViewLinkHost(model)
    val capability = nativeViewLinkCapability(description)
    LaunchedEffect(owner, owner.phase, owner.attempt, hosts, host, model.switching, model.pairingRequested,
        sending, attachments, picker.busy, share.payload, share.phase, capability) {
        owner.advance(nativeViewLinkAdmission(model, true, picker, share), capability, { nativeViewLinkHost(model) }, onOpening)
    }
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(owner, owner.attempt) {
        if (owner.takeFocusReset()) { focus.clearFocus(force = true); keyboard?.hide() }
    }
}

@Composable
internal fun NativeViewLinkCard(owner: NativeViewLinkIntake, retry: () -> Unit) {
    if (owner.phase == NativeViewLinkPhase.NONE) return
    OutlinedCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).testTag("view-link-state")) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.native_view_link_title), style = MaterialTheme.typography.titleSmall)
            if (owner.phase != NativeViewLinkPhase.OPENED) owner.location?.let {
                Text(stringResource(R.string.native_view_link_target, it.hostId, it.sessionId, it.anchorSeq),
                    Modifier.testTag("view-link-target"), maxLines = 3, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
            val message = when (owner.phase) {
                NativeViewLinkPhase.NONE -> null
                NativeViewLinkPhase.WAITING -> R.string.native_view_link_waiting
                NativeViewLinkPhase.OPENING -> if (owner.cancelling) R.string.native_view_link_cancelling else R.string.native_view_link_opening
                NativeViewLinkPhase.OPENED -> R.string.native_view_link_opened
                NativeViewLinkPhase.INTERRUPTED -> R.string.native_view_link_interrupted
                NativeViewLinkPhase.FAILED -> when (owner.issue) {
                    NativeViewLinkIssue.INVALID -> R.string.native_view_link_invalid
                    NativeViewLinkIssue.UNPAIRED -> R.string.native_view_link_unpaired
                    NativeViewLinkIssue.WRONG_HOST -> R.string.native_view_link_wrong_host
                    NativeViewLinkIssue.HOST_UNAVAILABLE -> R.string.native_view_link_host_unavailable
                    NativeViewLinkIssue.HOST_CHANGED -> R.string.native_view_link_host_changed
                    NativeViewLinkIssue.BUSY -> R.string.native_view_link_busy
                    NativeViewLinkIssue.CAPABILITY_UNAVAILABLE -> R.string.native_view_link_unsupported
                    NativeViewLinkIssue.CAPABILITY_FAILED -> R.string.native_view_link_capability_failed
                    NativeViewLinkIssue.CANCELLED -> R.string.native_view_link_cancelled
                    NativeViewLinkIssue.NAVIGATION_FAILED, null -> R.string.native_view_link_failed
                }
            }
            message?.let { Text(stringResource(it), Modifier.testTag(if (owner.phase == NativeViewLinkPhase.FAILED) "view-link-error" else "view-link-status"),
                style = MaterialTheme.typography.bodySmall) }
            if (owner.incomingRejected) Text(stringResource(R.string.native_view_link_incoming_rejected),
                Modifier.testTag("view-link-incoming-rejected"), style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (owner.occupied) TextButton(onClick = owner::cancel, enabled = !owner.cancelling, modifier = Modifier.testTag("view-link-cancel")) {
                    Text(stringResource(R.string.native_view_link_cancel))
                }
                if (owner.phase == NativeViewLinkPhase.FAILED && owner.location != null) TextButton(onClick = retry, modifier = Modifier.testTag("view-link-retry")) {
                    Text(stringResource(R.string.native_view_link_retry))
                }
                TextButton(onClick = owner::dismiss, enabled = !owner.cancelling, modifier = Modifier.testTag("view-link-dismiss")) {
                    Text(stringResource(R.string.native_view_link_dismiss))
                }
            }
        }
    }
}
