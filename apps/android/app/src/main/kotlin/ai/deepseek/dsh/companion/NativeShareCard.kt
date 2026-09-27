package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeObservedCapability as Capability
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** Read current ownership synchronously again at confirmation, independently of a rendered target label. */
internal fun nativeShareTarget(model: CompanionViewModel): NativeShareTarget? {
    val hosts = CompanionRuntime.hostState.value
    if (!model.paired || model.pairingRequested || model.switching || hosts.status != NativeHostStatus.READY || model.generation != hosts.generation) return null
    val host = hosts.selected ?: return null
    val session = model.session.open.value ?: return null
    return NativeShareTarget(model.attachments, model.inputs, host.key, model.generation, session.sessionId, model.session.selectionGeneration)
}

/** A share is a local draft proposal; confirming it never submits a prompt. */
@Composable
internal fun NativeShareCard(owner: NativeShareIntake, model: CompanionViewModel,
                             capabilities: Set<Capability>?, picker: NativeFileAttachmentPicker) {
    val hosts by CompanionRuntime.hostState.collectAsStateWithLifecycle()
    val open by model.session.open.collectAsStateWithLifecycle()
    val persistence by model.inputs.persistence.collectAsStateWithLifecycle()
    val sending by model.session.sending.collectAsStateWithLifecycle()
    val attachment by model.attachments.state.collectAsStateWithLifecycle()
    val target = nativeShareTarget(model)
    LaunchedEffect(owner, target) { owner.observeTarget(target) }
    LaunchedEffect(owner, owner.phase, model.inputs, persistence) { owner.observePersistence(model.inputs, persistence) }
    if (owner.phase == NativeSharePhase.NONE) return
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(owner, owner.arrival) {
        if (owner.phase == NativeSharePhase.REVIEW) {
            focus.clearFocus(force = true)
            keyboard?.hide()
        }
    }
    val payload = owner.payload
    val kinds = buildSet {
        if (capabilities?.contains(Capability.FILE_UPLOAD) == true) add(NativeAttachmentKind.FILE)
        if (capabilities?.contains(Capability.IMAGE_UPLOAD) == true) add(NativeAttachmentKind.IMAGE)
    }
    fun admissionReason(): Int? = when {
        nativeShareTarget(model) == null -> R.string.native_share_choose_target
        CompanionRuntime.hostState.value.selected?.role == "viewer" -> R.string.native_share_role_denied
        model.inputs.persistence.value == InputPersistenceStatus.RESTORE_FAILED -> R.string.native_share_input_unavailable
        capabilities?.contains(Capability.SESSION_CONTROL) != true -> R.string.native_share_capability_unavailable
        payload?.items?.isNotEmpty() == true && (kinds.isEmpty() || payload.items.any { it.requireImage } && NativeAttachmentKind.IMAGE !in kinds) -> R.string.native_share_capability_unavailable
        picker.busy || model.session.sending.value || model.attachments.state.value.phase in setOf(
            NativeFileAttachmentPhase.SELECTING, NativeFileAttachmentPhase.READING, NativeFileAttachmentPhase.UPLOADING, NativeFileAttachmentPhase.CLEANING) -> R.string.native_share_wait_operation
        else -> null
    }
    // Reading these observations invalidates the displayed admission reason as their owners change.
    val blocked = remember(hosts, open, persistence, sending, attachment, picker.busy, payload, capabilities, model.generation, model.switching, model.pairingRequested) { admissionReason() }
    OutlinedCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).testTag("share-intake")) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.native_share_title), style = MaterialTheme.typography.titleSmall)
            payload?.let {
                if (it.text.isNotEmpty()) Text(it.text, Modifier.testTag("share-text-preview"), maxLines = 4, overflow = TextOverflow.Ellipsis)
                Text(stringResource(R.string.native_share_count, it.items.size), Modifier.testTag("share-count"))
                hosts.selected?.let { host ->
                    Text(stringResource(R.string.native_share_host, host.name, host.endpoint), Modifier.testTag("share-target-host"), maxLines = 2)
                }
                open?.let { session -> Text(stringResource(R.string.native_share_session, session.sessionId), Modifier.testTag("share-target-session")) }
                Text(stringResource(R.string.native_share_draft_only), style = MaterialTheme.typography.bodySmall)
            }
            if (owner.incomingRejected) Text(stringResource(R.string.native_share_incoming_rejected),
                Modifier.testTag("share-incoming-rejected"), color = MaterialTheme.colorScheme.error)
            val message = when (owner.phase) {
                NativeSharePhase.NONE, NativeSharePhase.REVIEW -> null
                NativeSharePhase.IMPORTING -> R.string.native_share_importing
                NativeSharePhase.ADOPTED -> R.string.native_share_adopted
                NativeSharePhase.SAVE_FAILED -> R.string.native_share_save_failed
                NativeSharePhase.INTERRUPTED -> R.string.native_share_interrupted
                NativeSharePhase.REJECTED -> when (owner.rejection) {
                    NativeShareRejection.TOO_MANY -> R.string.native_share_too_many
                    NativeShareRejection.TEXT_TOO_LARGE -> R.string.native_share_text_too_large
                    NativeShareRejection.EMPTY -> R.string.native_share_empty
                    NativeShareRejection.INVALID, null -> R.string.native_share_invalid
                }
                NativeSharePhase.FAILED -> when (owner.issue) {
                    NativeShareIssue.STALE_TARGET -> R.string.native_share_target_changed
                    NativeShareIssue.CANCELLED -> R.string.native_share_cancelled
                    NativeShareIssue.KIND_UNAVAILABLE -> R.string.native_share_capability_unavailable
                    NativeShareIssue.INPUT_FAILED -> R.string.native_share_input_unavailable
                    NativeShareIssue.TEXT_TOO_LARGE -> R.string.native_share_text_too_large
                    NativeShareIssue.EMPTY -> R.string.native_share_empty
                    NativeShareIssue.BUSY -> R.string.native_share_wait_operation
                    NativeShareIssue.ATTACHMENT_FAILED, null -> when (owner.attachmentIssue) {
                        NativeFileAttachmentIssue.TOO_LARGE -> R.string.native_share_source_too_large
                        NativeFileAttachmentIssue.TOO_MANY_FILES -> R.string.native_attachment_too_many
                        NativeFileAttachmentIssue.UNSUPPORTED_IMAGE -> R.string.native_attachment_unsupported_image
                        NativeFileAttachmentIssue.SOURCE_FAILED, NativeFileAttachmentIssue.INVALID_FILE -> R.string.native_attachment_source_failed
                        NativeFileAttachmentIssue.REQUEST_TOO_LARGE -> R.string.native_attachment_request_too_large
                        else -> R.string.native_share_import_failed
                    }
                }
            }
            message?.let { Text(stringResource(it), Modifier.testTag(when (owner.phase) {
                NativeSharePhase.INTERRUPTED -> "share-interrupted"
                NativeSharePhase.FAILED, NativeSharePhase.REJECTED, NativeSharePhase.SAVE_FAILED -> "share-error"
                else -> "share-status"
            }), style = MaterialTheme.typography.bodySmall) }
            if (payload != null && blocked != null && owner.phase != NativeSharePhase.IMPORTING) Text(stringResource(blocked),
                Modifier.testTag("share-disabled-reason"), style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (payload != null) Button(enabled = blocked == null && target != null && owner.phase != NativeSharePhase.IMPORTING,
                    modifier = Modifier.testTag("share-add-to-draft"), onClick = {
                        target?.let { owner.confirm(it, kinds, { nativeShareTarget(model) }, { admissionReason() == null }) { item ->
                            AndroidNativeFileAttachmentSource(context.contentResolver, item.uri)
                        } }
                    }) { Text(stringResource(if (owner.phase == NativeSharePhase.FAILED) R.string.native_share_retry else R.string.native_share_add)) }
                TextButton(onClick = owner::dismiss, modifier = Modifier.testTag("share-dismiss")) {
                    Text(stringResource(if (owner.phase == NativeSharePhase.IMPORTING) R.string.native_share_cancel else R.string.native_share_dismiss))
                }
            }
        }
    }
}
