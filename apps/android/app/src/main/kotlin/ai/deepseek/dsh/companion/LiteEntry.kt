package ai.deepseek.dsh.companion

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope

/**
 * The host face of one assembled Lite session (§31's closing UI entry): one
 * disclosure line naming the runtime mode, then the chat surface — or, while
 * the caller injects no endpoint, an explicit empty state whose send stays
 * disabled. No endpoint is ever assumed here.
 */
@Composable
fun LiteEntry(
    scope: CoroutineScope,
    sessionId: String,
    endpoint: String,
    apiKey: String,
    model: String,
    execute: LiteToolExecuting,
    store: LiteSessionStoring? = null,
    artifacts: LiteArtifactStoring? = null,
) {
    Column(Modifier.fillMaxSize()) {
        Text(
            "受限模式（runtimeMode = lite）",
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag("lite-disclosure"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
        )
        if (endpoint.isBlank()) {
            Text(
                "未配置 Lite 服务端点",
                Modifier.padding(horizontal = 16.dp).testTag("lite-endpoint-missing"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
            )
            Row(Modifier.fillMaxWidth().padding(12.dp)) {
                Button(onClick = {}, enabled = false, modifier = Modifier.testTag("lite-composer-send")) { Text("发送") }
            }
        } else {
            val context = LocalContext.current
            val chat = remember(endpoint, apiKey, model, sessionId) {
                LiteSessionAssembler.assemble(
                    context = context,
                    scope = scope,
                    sessionId = sessionId,
                    endpoint = endpoint,
                    apiKey = apiKey,
                    model = model,
                    execute = execute,
                    store = store,
                    artifacts = artifacts,
                )
            }
            LiteChatScreen(chat)
        }
    }
}
