package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

/** The single-activity companion shell: pairing first, then the six-tab
 * surface (nativization plan chapters 52 and 60 — Minimal Neumorphic only). */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CompanionRuntime.restore(filesDir)
        setContent {
            CompanionTheme {
                CompanionApp()
            }
        }
    }
}

/** The Minimal Neumorphic palette from the core tokens (chapter 60): one
 * style — soft raised cards on an even light ground, dual-tone shadows. */
@Composable
fun CompanionTheme(content: @Composable () -> Unit) {
    val colors = MaterialTheme.colorScheme.copy(
        background = Color(NeumorphicTokens.surface.toULong()),
        surface = Color(NeumorphicTokens.surface.toULong()),
        primary = Color(NeumorphicTokens.textPrimary.toULong()),
        onPrimary = Color(NeumorphicTokens.surface.toULong()),
        onBackground = Color(NeumorphicTokens.textPrimary.toULong()),
        onSurface = Color(NeumorphicTokens.textPrimary.toULong()),
        secondary = Color(NeumorphicTokens.textSecondary.toULong()),
        onSecondary = Color(NeumorphicTokens.textSecondary.toULong()),
    )
    MaterialTheme(colorScheme = colors, content = content)
}

/** A raised card: the baseline's single surface treatment. */
@Composable
fun RaisedCard(content: @Composable () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = NeumorphicTokens.shadowInset.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
    }
}

/** The view-model holder pairing once and hosting the six models. */
class CompanionViewModel : ViewModel() {
    var paired = CompanionRuntime.restored
        private set

    val session = SessionModel(CompanionRuntime.wire, viewModelScope)
    val interactions = InteractionModel(CompanionRuntime.wire, viewModelScope)
    val files = FilesModel(CompanionRuntime.wire, viewModelScope)
    val subagents = SubagentsModel(CompanionRuntime.wire, viewModelScope)

    /** Pair with a scanned payload; returns the failure message, or null. */
    suspend fun pair(payloadText: String, deviceName: String): String? =
        CompanionRuntime.pair(payloadText, deviceName).also {
            if (it == null) paired = true
        }
}

/** The app-level pairing runtime: holds the wire the models drive, swaps
 * it after a successful pairing. */
object CompanionRuntime {
    /** Fails any pre-pairing call loud. */
    private class UnpairedWire : WireDriving {
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue =
            throw IllegalStateException("not paired")

        override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> =
            throw IllegalStateException("not paired")
    }

    @Volatile private var current: WireDriving = UnpairedWire()

    /** True once a stored identity rebuilt the client at launch or a
     * pairing succeeded in this process. */
    @Volatile var restored: Boolean = false
        private set

    val wire: WireDriving get() = current

    /** Where the credentials file lives; MainActivity sets it at launch. */
    @Volatile var restoreDirectory: java.io.File? = null

    /** Rebuild the client from persisted credentials so relaunch skips
     * pairing; returns true when a usable identity existed. The signing key
     * opens through the keystore-held AES key. */
    fun restore(directory: java.io.File): Boolean {
        restoreDirectory = directory
        val store = credentialsStore(directory)
        val client = ai.deepseek.dsh.link.LinkClient.restore(store) ?: return false
        current = LinkWireDriving(client)
        restored = true
        return true
    }

    private fun credentialsStore(directory: java.io.File): ai.deepseek.dsh.link.FileLinkCredentialsStore =
        ai.deepseek.dsh.link.FileLinkCredentialsStore(
            java.io.File(directory, "link-credentials.json"),
            AndroidKeystoreCipher(),
        )

    /** Pair with a scanned payload; returns the failure message, or null. */
    suspend fun pair(payloadText: String, deviceName: String): String? = try {
        val payload = ai.deepseek.dsh.link.LinkPayloadParsing.pairingPayload(payloadText)
            ?: error("配对载荷无法识别")
        val directory = restoreDirectory ?: error("no restore directory configured")
        val store = credentialsStore(directory)
        val client = ai.deepseek.dsh.link.LinkClient(
            baseUrl = payload.endpoint,
            pinnedFingerprint = payload.spkiFingerprint,
            store = store,
        )
        client.pair(payload, deviceName)
        current = LinkWireDriving(client)
        restored = true
        null
    } catch (failure: Exception) {
        failure.message
    }
}

@Composable
fun CompanionApp(model: CompanionViewModel = viewModel()) {
    var tab by remember { mutableStateOf(0) }
    if (!model.paired) {
        PairingScreen(model)
        return
    }
    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEachIndexed { index, label ->
                    NavigationBarItem(
                        selected = tab == index,
                        onClick = { tab = index },
                        icon = { Text(label.first().toString()) },
                        label = { Text(label) },
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                0 -> SessionsTab(model)
                1 -> ApprovalsTab(model)
                2 -> PlanTab(model)
                3 -> ToolsTab(model)
                4 -> FilesTab(model)
                else -> SubagentsTab(model)
            }
        }
    }
}

private val tabs = listOf("会话", "审批", "计划", "工具", "文件", "子代理")

@Composable
fun PairingScreen(model: CompanionViewModel) {
    var payload by remember { mutableStateOf("") }
    var deviceName by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<String?>(null) }
    var pairing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("配对到宿主", style = MaterialTheme.typography.titleLarge)
        Text("在 Windows 宿主的设置页点击“配对新设备”，把二维码下方的内容粘贴到这里。", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(value = payload, onValueChange = { payload = it }, label = { Text("配对载荷（二维码内容）") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = deviceName, onValueChange = { deviceName = it }, label = { Text("设备名称") }, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = {
                pairing = true
                scope.launch {
                    failure = model.pair(payload, deviceName)
                    pairing = false
                }
            },
            enabled = payload.isNotEmpty() && deviceName.isNotEmpty() && !pairing,
        ) { Text("配对") }
        failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
fun SessionsTab(model: CompanionViewModel) {
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf("") }
    val sessions by model.session.sessions.collectAsState()
    val open by model.session.open.collectAsState()
    val sending by model.session.sending.collectAsState()
    LaunchedEffect(model.paired) { model.session.loadSessions() }
    Column(Modifier.fillMaxSize()) {
        Text(
            open?.let { "已打开会话 ${it.sessionId}" } ?: "会话",
            Modifier.padding(16.dp),
            style = MaterialTheme.typography.titleMedium,
        )
        LazyColumn(Modifier.weight(1f)) {
            if (open == null) {
                items(sessions) { row ->
                    RaisedCard {
                        Text(row.title, style = MaterialTheme.typography.bodyLarge)
                        Button(onClick = { scope.launch { model.session.openSession(row.id) } }) { Text("打开") }
                    }
                }
            } else {
                items(open!!.state.items) { item ->
                    RaisedCard {
                        Text(item.kind, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                        if (item.text.isNotEmpty()) Text(item.text)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = draft, onValueChange = { draft = it }, label = { Text("发消息给宿主…") }, modifier = Modifier.weight(1f))
            Button(onClick = {
                val text = draft
                draft = ""
                scope.launch { model.session.send(text) }
            }, enabled = draft.isNotEmpty() && !sending) { Text("发送") }
            Button(onClick = { scope.launch { model.session.cancelActive() } }) { Text("停止") }
        }
    }
}

@Composable
fun ApprovalsTab(model: CompanionViewModel) {
    LaunchedEffect(model.paired) { model.interactions.startWatching() }
    val scope = rememberCoroutineScope()
    val inbox by model.interactions.inbox.collectAsState()
    LazyColumn(Modifier.fillMaxSize()) {
        items(inbox) { pending ->
            RaisedCard {
                Text(pending.title, style = MaterialTheme.typography.bodyLarge)
                if (pending.detail.isNotEmpty()) Text(pending.detail, style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { scope.launch { model.interactions.answer(pending, allowedOnce = true) } }) { Text("允许一次") }
                    Button(onClick = { scope.launch { model.interactions.answer(pending, allowedOnce = false) } }) { Text("拒绝") }
                }
            }
        }
    }
}

@Composable
fun PlanTab(model: CompanionViewModel) {
    val open by model.session.open.collectAsState()
    val folded = open?.state ?: DomainState()
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            RaisedCard {
                Text(if (folded.planActive) "计划模式：开启" else "计划模式：关闭", style = MaterialTheme.typography.titleSmall)
            }
        }
        items(folded.todos) { todo ->
            RaisedCard {
                Text("[${todo.status}] ${todo.text}")
            }
        }
        items(folded.goals) { goal ->
            RaisedCard {
                Text("目标：${goal.title}（${goal.state}）", style = MaterialTheme.typography.titleSmall)
            }
        }
    }
}

@Composable
fun ToolsTab(model: CompanionViewModel) {
    val open by model.session.open.collectAsState()
    LazyColumn(Modifier.fillMaxSize()) {
        items(open?.state?.toolCalls ?: emptyList()) { call ->
            RaisedCard {
                Text("${call.name} — ${call.phase}", style = MaterialTheme.typography.titleSmall)
                Text(call.arguments, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                if (call.resultText.isNotEmpty()) Text(call.resultText, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
fun FilesTab(model: CompanionViewModel) {
    val scope = rememberCoroutineScope()
    val directory by model.files.directory.collectAsState()
    val entries by model.files.entries.collectAsState()
    val selected by model.files.selectedWorkspace.collectAsState()
    LaunchedEffect(model.paired, selected) { model.files.list() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                model.files.goUp()
                scope.launch { model.files.list() }
            }, enabled = directory.isNotEmpty()) { Text("上一级") }
            Text(directory.joinToString("/") .ifEmpty { "（根目录）" }, style = MaterialTheme.typography.titleSmall)
        }
        LazyColumn(Modifier.weight(1f)) {
            items(entries) { entry ->
                RaisedCard {
                    Text(if (entry.isDirectory) "📁 ${entry.name}" else "📄 ${entry.name}")
                }
            }
        }
    }
}

@Composable
fun SubagentsTab(model: CompanionViewModel) {
    val scope = rememberCoroutineScope()
    val sessions by model.session.sessions.collectAsState()
    val rows by model.subagents.rows.collectAsState()
    LaunchedEffect(model.paired, sessions) {
        sessions.firstOrNull()?.let { model.subagents.load(it.id) }
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(rows) { row ->
            RaisedCard {
                Text(row.label ?: row.id, style = MaterialTheme.typography.bodyLarge)
                Text(row.reason ?: row.mode ?: "", style = MaterialTheme.typography.bodySmall)
                if (row.mode != null) {
                    Button(onClick = {
                        val parent = sessions.firstOrNull()?.id ?: return@Button
                        scope.launch { model.subagents.openChild(parent, row) }
                    }) { Text("打开时间线") }
                }
            }
        }
    }
}
