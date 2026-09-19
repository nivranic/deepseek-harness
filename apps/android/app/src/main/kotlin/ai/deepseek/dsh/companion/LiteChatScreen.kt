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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

/**
 * The Lite chat surface: the conversation, the live stream partial, tool
 * rows with phases, artifact references, and the handoff banner — all read
 * from the view model's live StateFlow projection of the folded state.
 */
@Composable
fun LiteChatScreen(model: LiteChatViewModel) {
    var draft by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val state by model.liveState.collectAsStateWithLifecycle(initialValue = model.state)

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
                LiteArtifactRow(model, artifact)
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
                    scope.launch { model.send(prompt) }
                },
                enabled = draft.isNotBlank() && !model.driver.running,
            ) { Text("发送") }
        }
    }
}

/** One artifact reference with its resource-channel content: textual kinds
 * open to their bytes, other kinds show type and size, a missing id shows
 * the empty state. */
@Composable
private fun LiteArtifactRow(model: LiteChatViewModel, artifact: LiteArtifact) {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var open by androidx.compose.runtime.remember(artifact.id) { androidx.compose.runtime.mutableStateOf(false) }
    var content by androidx.compose.runtime.remember(artifact.id) {
        androidx.compose.runtime.mutableStateOf<LiteArtifactContent?>(null)
    }
    Column(Modifier.padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("📄 ${artifact.title}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Button(onClick = {
                open = !open
                if (open && content == null) {
                    scope.launch { content = model.readArtifact(artifact) }
                }
            }) { Text(if (open) "收起" else "内容") }
        }
        if (open) {
            when (val present = content) {
                null -> Text("内容缺失", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                is LiteArtifactContent.Presentation.Text ->
                    Text(present.text, style = MaterialTheme.typography.bodySmall)
                is LiteArtifactContent.Presentation.Binary ->
                    Text(
                        "${present.kind} 类型 · ${present.sizeBytes} 字节",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
                    )
            }
        }
    }
}
