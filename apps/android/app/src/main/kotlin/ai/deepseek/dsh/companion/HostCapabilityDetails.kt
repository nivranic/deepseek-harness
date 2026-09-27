package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeDescriptionState
import ai.deepseek.dsh.gateway.NativeObservedCapability
import ai.deepseek.dsh.gateway.NativeObservedRole
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/** A bounded, read-only capability observation; advertised support never grants a business permission. */
@Composable
internal fun HostCapabilityDetails(observation: NativeHostObservation, generation: Long, refresh: () -> Unit) {
    var expanded by remember(generation) { mutableStateOf(false) }
    TextButton(onClick = { expanded = true }, modifier = Modifier.padding(horizontal = 8.dp).testTag("native-capabilities-open")) {
        Text(stringResource(R.string.native_capabilities_title))
    }
    if (!expanded) return
    val snapshot = observation.snapshot?.takeUnless { it.closed }
    val protocol = snapshot?.description
    val state = when {
        observation.refreshing -> R.string.native_capabilities_checking
        snapshot?.descriptionState == NativeDescriptionState.AVAILABLE -> R.string.native_capabilities_available
        snapshot?.descriptionState == NativeDescriptionState.FAILED ->
            if (protocol == null) R.string.native_capabilities_failed_empty else R.string.native_capabilities_failed
        snapshot?.descriptionState == NativeDescriptionState.CANCELLED -> R.string.native_capabilities_cancelled
        else -> R.string.native_capabilities_unknown
    }
    AlertDialog(
        onDismissRequest = { expanded = false },
        title = { Text(stringResource(R.string.native_capabilities_title)) },
        text = {
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()).testTag("native-capabilities-content"),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(state), Modifier.testTag("native-capabilities-state"), style = MaterialTheme.typography.titleSmall)
                Text(stringResource(R.string.native_capabilities_notice))
                val role = when (snapshot?.lastKnownRole) {
                    NativeObservedRole.VIEWER -> R.string.native_capabilities_viewer
                    NativeObservedRole.COLLABORATOR -> R.string.native_capabilities_collaborator
                    NativeObservedRole.CONTROLLER -> R.string.native_capabilities_controller
                    NativeObservedRole.OWNER -> R.string.native_capabilities_owner
                    null -> R.string.native_capabilities_role_unknown
                }
                Text(stringResource(R.string.native_capabilities_role, stringResource(role)))
                if (protocol != null) {
                    Text(stringResource(R.string.native_capabilities_versions, protocol.sessionFormatVersion))
                    Text(stringResource(R.string.native_capabilities_scope))
                    NativeObservedCapability.entries.forEach { capability ->
                        val label = when (capability) {
                            NativeObservedCapability.SESSION_FOLLOW -> R.string.native_capabilities_session_follow
                            NativeObservedCapability.SESSION_CONTROL -> R.string.native_capabilities_session_control
                            NativeObservedCapability.SESSION_LIST -> R.string.native_capabilities_session_list
                            NativeObservedCapability.SESSION_MANAGE -> R.string.native_capabilities_session_manage
                            NativeObservedCapability.WORKSPACE_FOLLOW -> R.string.native_capabilities_workspace_follow
                            NativeObservedCapability.FILE_STAT -> R.string.native_capabilities_file_stat
                            NativeObservedCapability.FILE_LIST -> R.string.native_capabilities_file_list
                            NativeObservedCapability.FILE_TEXT -> R.string.native_capabilities_file_text
                            NativeObservedCapability.FILE_BYTES -> R.string.native_capabilities_file_bytes
                            NativeObservedCapability.FILE_UPLOAD -> R.string.native_capabilities_file_upload
                            NativeObservedCapability.SUBAGENT_CATALOG -> R.string.native_capabilities_subagent_catalog
                        }
                        val support = if (capability in protocol.capabilities) R.string.native_capabilities_supported else R.string.native_capabilities_absent
                        Text(stringResource(R.string.native_capabilities_entry, stringResource(label), stringResource(support)),
                            Modifier.testTag("native-capability-${capability.wire}"))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = !observation.refreshing, onClick = refresh, modifier = Modifier.testTag("native-capabilities-refresh")) {
                Text(stringResource(R.string.native_capabilities_refresh))
            }
        },
        dismissButton = {
            TextButton(onClick = { expanded = false }, modifier = Modifier.testTag("native-capabilities-close")) {
                Text(stringResource(R.string.native_resource_close))
            }
        },
    )
}
