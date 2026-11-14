package ai.deepseek.dsh.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

/** Only read operations are available on the child view; replacing it resets viewport state. */
@Composable
internal fun NativeSubagentTimeline(view: SubagentTimeline, back: () -> Unit) = key(view) {
    val open by view.open.collectAsStateWithLifecycle()
    val history by view.history.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().testTag("native-child-timeline")) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(view.row.label ?: view.row.id, style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.native_subagents_read_only), style = MaterialTheme.typography.bodySmall)
            }
            Button(modifier = Modifier.testTag("native-child-back"), onClick = back) {
                Text(stringResource(R.string.native_subagents_back))
            }
        }
        if (!history.ready && history.failure == null) {
            Text(stringResource(R.string.native_subagents_history_loading), Modifier.padding(horizontal = 16.dp))
        }
        if (history.hasMore) Button(modifier = Modifier.testTag("native-child-load-older"), enabled = !history.loading,
            onClick = { scope.launch { view.loadOlderHistory() } }) {
            Text(stringResource(if (history.loading) R.string.native_history_loading else R.string.native_history_load_older))
        }
        if (history.failure != null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                Text(stringResource(R.string.native_subagents_history_failed), Modifier.weight(1f).testTag("native-child-error"),
                    color = MaterialTheme.colorScheme.error)
                Button(modifier = Modifier.testTag("native-child-reconnect"), onClick = { scope.launch { view.reconnect() } }) {
                    Text(stringResource(R.string.native_retry_connection))
                }
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("native-child-rows")) {
            items(open?.state?.items.orEmpty(), key = { it.seq }) { item ->
                RaisedCard(Modifier.testTag("native-child-event-${item.seq}")) {
                    Text(item.kind, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                    if (item.text.isNotEmpty()) Text(item.text)
                }
            }
        }
    }
}
