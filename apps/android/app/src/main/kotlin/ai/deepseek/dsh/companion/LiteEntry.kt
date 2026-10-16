package ai.deepseek.dsh.companion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope

/**
 * The host face of one assembled Lite session (§31's closing UI entry): one
 * disclosure line naming the runtime mode, then the chat surface — or, while
 * no endpoint is configured, an explicit empty state whose send stays
 * disabled and whose config form saves the configuration that assembles the
 * session. No endpoint is ever assumed here; with no store injected the
 * fixed parameters keep the store-less preview face.
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
    configStore: LiteConfigStoring? = null,
) {
    // The configured face reads the store; each save bumps the revision so
    // the next composition reloads from disk. A load failure surfaces as its
    // own line — it never reads as unconfigured, and the form's next save
    // replaces the ailing file.
    var revision by remember { mutableStateOf(0) }
    var editing by remember { mutableStateOf(false) }
    val loaded = remember(configStore, revision) {
        try {
            LiteConfigLoad(config = configStore?.load(), failure = null)
        } catch (failure: Exception) {
            LiteConfigLoad(config = null, failure = "Lite 配置读取失败：${failure.message ?: ""}，可重新保存覆盖")
        }
    }
    val config = loaded.config
    Column(Modifier.fillMaxSize()) {
        Text(
            "受限模式（runtimeMode = lite）",
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).testTag("lite-disclosure"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
        )
        when {
            configStore == null -> if (endpoint.isBlank()) LiteEmptyState() else {
                LiteChatFace(scope, sessionId, endpoint, apiKey, model, presetId = null, execute, store, artifacts)
            }
            config != null && !editing -> {
                Button(
                    onClick = { editing = true },
                    modifier = Modifier.padding(horizontal = 16.dp).testTag("lite-config-edit"),
                ) { Text("修改配置") }
                LiteChatFace(
                    scope, sessionId, config.endpoint, config.apiKey, config.model,
                    presetId = config.presetId, execute, store, artifacts,
                )
            }
            else -> {
                if (config == null) {
                    LiteEmptyState(loadFailure = loaded.failure)
                }
                LiteConfigForm(initial = config) { saved ->
                    configStore.save(saved)
                    revision++
                    editing = false
                }
            }
        }
    }
}

/** One config-read outcome: the loaded configuration, or why it failed. */
private data class LiteConfigLoad(val config: LiteConfig?, val failure: String?)

/** The endpoint-less empty state: an explicit blocked composer, and a load
 * failure line in place of the missing-configuration line when the stored
 * file could not be read. */
@Composable
private fun LiteEmptyState(loadFailure: String? = null) {
    if (loadFailure == null) {
        Text(
            "未配置 Lite 服务端点",
            Modifier.padding(horizontal = 16.dp).testTag("lite-endpoint-missing"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
        )
    } else {
        Text(
            loadFailure,
            Modifier.padding(horizontal = 16.dp).testTag("lite-config-load-failure"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
    }
    Row(Modifier.fillMaxWidth().padding(12.dp)) {
        Button(onClick = {}, enabled = false, modifier = Modifier.testTag("lite-composer-send")) { Text("发送") }
    }
}

/** The configuration form: three fields, the preset row over the bundled
 * projection, and a save gated on all three being filled, the endpoint
 * passing validation, and the picked preset being one the catalog carries
 * (the PairingScreen gate shape). */
@Composable
private fun LiteConfigForm(initial: LiteConfig?, onSave: (LiteConfig) -> Unit) {
    var endpoint by remember(initial) { mutableStateOf(initial?.endpoint ?: "") }
    var apiKey by remember(initial) { mutableStateOf(initial?.apiKey ?: "") }
    var model by remember(initial) { mutableStateOf(initial?.model ?: "") }
    // The BUNDLED projection this form selects from: read the same fail-loud
    // way the assembled session reads it, exactly the presets the APK carries.
    val context = LocalContext.current
    val catalog = remember { LiteAssets.load(context).presets }
    var presetId by remember(initial) { mutableStateOf(initial?.presetId) }
    var showPresetPicker by remember { mutableStateOf(false) }
    // Saving leaves the form; the keyboard has nothing left to edit.
    val keyboard = LocalSoftwareKeyboardController.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = endpoint,
            onValueChange = { endpoint = it },
            label = { Text("端点") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("lite-config-endpoint"),
        )
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it },
            label = { Text("API Key") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("lite-config-api-key"),
        )
        OutlinedTextField(
            value = model,
            onValueChange = { model = it },
            label = { Text("模型") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("lite-config-model"),
        )
        // The row names the preset the next assembly would run: an explicitly
        // picked id as picked, else the default a null selection resolves to.
        // The picker lists exactly what the catalog carries — one preset
        // today, more when the projection grows.
        OutlinedButton(
            onClick = { showPresetPicker = true },
            modifier = Modifier.fillMaxWidth().testTag("lite-config-preset"),
        ) { Text("预设：${presetId ?: catalog.default?.id ?: "无"}") }
        if (showPresetPicker) AlertDialog(
            onDismissRequest = { showPresetPicker = false },
            title = { Text("预设选择") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (preset in catalog.presets) {
                        Button(
                            onClick = {
                                presetId = preset.id
                                showPresetPicker = false
                            },
                            modifier = Modifier.fillMaxWidth().testTag("lite-preset-option-${preset.id}"),
                        ) { Text(preset.id) }
                    }
                }
            },
            confirmButton = {
                Button(onClick = { showPresetPicker = false }) { Text("关闭") }
            },
        )
        // A picked preset must be one the catalog carries: a stale id gates
        // save off until a valid option is picked, without its own error line.
        val pickedPresetId = presetId
        Button(
            onClick = {
                keyboard?.hide()
                onSave(LiteConfig(endpoint = endpoint.trim(), apiKey = apiKey.trim(), model = model.trim(), presetId = presetId))
            },
            enabled = endpoint.isNotBlank() && apiKey.isNotBlank() && model.isNotBlank() &&
                validateLiteEndpoint(endpoint) == null &&
                (pickedPresetId == null || catalog.preset(pickedPresetId) != null),
            modifier = Modifier.testTag("lite-config-save"),
        ) { Text("保存") }
    }
}

@Composable
private fun LiteChatFace(
    scope: CoroutineScope,
    sessionId: String,
    endpoint: String,
    apiKey: String,
    model: String,
    presetId: String?,
    execute: LiteToolExecuting,
    store: LiteSessionStoring?,
    artifacts: LiteArtifactStoring?,
) {
    val context = LocalContext.current
    // The effective preset is part of the assembly identity: a different
    // selection assembles a different session (new facts, new prompt face).
    val chat = remember(endpoint, apiKey, model, sessionId, presetId) {
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
            presetId = presetId,
        )
    }
    LiteChatScreen(chat)
}
