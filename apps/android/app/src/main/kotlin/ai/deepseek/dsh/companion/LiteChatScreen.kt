package ai.deepseek.dsh.companion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

/**
 * The Lite chat surface: the conversation, the live stream partial, tool
 * rows with phases, artifact references, and the handoff banner — all read
 * from the view model's folded Lite domain state.
 */
@Composable
fun LiteChatScreen(model: LiteChatViewModel) {
    var draft by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    // The folded state re-reads whenever a persisted turn grows the
    // journal, so the surface re-renders per turn.
    var journalSize by remember { mutableStateOf(model.session.events.size) }
    val state = model.state

    Column(Modifier.fillMaxSize()) {
        model.lastHandoff?.let { handoff ->
            Text(
                "此能力需要完整运行时（$handoff），已在宿主上继续。",
                Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
            )
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(state.conversation) { message ->
                Column(Modifier.padding(horizontal = 16.dp)) {
                    Text(
                        if (message.role == "user") "你" else "助手",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                    Text(message.text, style = MaterialTheme.typography.bodyMedium)
                    if (message.interrupted) {
                        Text("已中断", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            if (state.streaming.active) {
                item {
                    Text(
                        if (state.streaming.partialText.isEmpty()) "正在思考…" else state.streaming.partialText,
                        Modifier.padding(horizontal = 16.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }
            items(state.toolCalls) { call ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(call.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    Text(
                        when (call.phase) {
                            "running" -> "执行中"
                            "failed" -> "失败"
                            else -> "完成"
                        },
                        style = MaterialTheme.typography.labelMedium,
                        color = if (call.phase == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary,
                    )
                }
            }
            items(state.artifacts) { artifact ->
                Text("📄 ${artifact.title}", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                label = { Text("输入…") },
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = {
                    val prompt = draft.trim()
                    if (prompt.isEmpty()) return@Button
                    draft = ""
                    scope.launch {
                        model.send(prompt)
                        journalSize = model.session.events.size
                    }
                },
                enabled = draft.isNotBlank() && !model.driver.running,
            ) { Text("发送") }
        }
    }
}
