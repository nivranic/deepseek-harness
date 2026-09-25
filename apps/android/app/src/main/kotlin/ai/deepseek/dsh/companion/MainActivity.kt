package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The single-activity companion shell: pairing first, then the seven-tab
 * surface (nativization plan chapters 52 and 60 — Minimal Neumorphic only). */
class MainActivity : ComponentActivity() {
    private val model: CompanionViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            CompanionRuntime.restore(filesDir)
            if (isFinishing || isDestroyed) return@launch
            model.reconcileRuntime()
            if (!isFinishing && !isDestroyed) {
                setContent {
                    CompanionTheme {
                        CompanionApp(model)
                    }
                }
            }
        }
    }
}

/** The Minimal Neumorphic palette from the core tokens (chapter 60): one
 * style — soft raised cards on an even light ground, dual-tone shadows. */
@Composable
fun CompanionTheme(content: @Composable () -> Unit) {
    val colors = MaterialTheme.colorScheme.copy(
        background = Color(NeumorphicTokens.surface.toLong()),
        surface = Color(NeumorphicTokens.surface.toLong()),
        primary = Color(NeumorphicTokens.textPrimary.toLong()),
        onPrimary = Color(NeumorphicTokens.surface.toLong()),
        onBackground = Color(NeumorphicTokens.textPrimary.toLong()),
        onSurface = Color(NeumorphicTokens.textPrimary.toLong()),
        secondary = Color(NeumorphicTokens.textSecondary.toLong()),
        onSecondary = Color(NeumorphicTokens.textSecondary.toLong()),
    )
    MaterialTheme(colorScheme = colors, content = content)
}

/** A raised card: the baseline's single surface treatment. */
@Composable
fun RaisedCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = NeumorphicTokens.shadowInset.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
    }
}

/** The view-model holder pairing once and hosting the companion models. */
class CompanionViewModel : ViewModel() {
    var paired by mutableStateOf(CompanionRuntime.restored)
        private set

    private val transition = Mutex()
    private var models by mutableStateOf(CompanionModelSet(CompanionRuntime.wire, viewModelScope))
    var generation by mutableStateOf(CompanionRuntime.generation)
        private set
    var pairingRequested by mutableStateOf(false)
        private set
    val session get() = models.session
    val interactions get() = models.interactions
    val files get() = models.files
    val subagents get() = models.subagents
    val pushes get() = models.pushes

    /** Hide and retire the current connection's models while retaining its stored identity and transport. */
    suspend fun beginPairing() = transition.withLock {
        if (!paired || pairingRequested) return@withLock
        pairingRequested = true
        models.closeAndAwait()
    }

    /** Resume observations with fresh models; no credential is deleted or redeemed. */
    suspend fun cancelPairing() = transition.withLock {
        if (!paired || !pairingRequested) return@withLock
        models.closeAndAwait()
        publishModels()
    }

    /** Reconcile a durable identity adopted during an Activity recreation. */
    suspend fun reconcileRuntime() = transition.withLock {
        if (CompanionRuntime.restored && generation != CompanionRuntime.generation) {
            models.closeAndAwait()
            publishModels()
        }
    }

    private fun publishModels() {
        models = CompanionModelSet(CompanionRuntime.wire, viewModelScope)
        generation = CompanionRuntime.generation
        paired = CompanionRuntime.restored
        pairingRequested = false
    }

    /** Pair with a scanned payload; returns the failure, or null after adoption. */
    suspend fun pair(payloadText: String, deviceName: String): Exception? = transition.withLock {
        if (paired && !pairingRequested) return@withLock null
        models.closeAndAwait()
        CompanionRuntime.pair(payloadText, deviceName).also {
            if (it == null) publishModels()
        }
    }

    /** Capture each live owner once without opening subscriptions or loading credentials. */
    fun supportSnapshot() = SupportLocalSnapshot(
        CompanionRuntime.restored,
        CompanionRuntime.wire.diagnosticSnapshot(),
        ConnectionSnapshots(session.connectionSnapshot, interactions.connectionSnapshot,
            files.connectionSnapshot, pushes.connectionSnapshot),
        session.sessionDiagnostics,
        ProcessExitDiagnostics.Unavailable,
        null,
    )

    override fun onCleared() {
        models.close()
    }
}

/** The process-owned pairing runtime: holds the wire the models drive and
 * swaps it after restore or successful pairing. View-model teardown stops
 * model streams without closing this process-lifetime transport. */
object CompanionRuntime {
    private val transition = Mutex()
    @Volatile var generation: Long = 0
        private set
    private val linkTransportConfig = ai.deepseek.dsh.link.LinkTransportConfig(
        connectTimeoutMillis = 10_000,
        writeTimeoutMillis = 30_000,
        unaryReadTimeoutMillis = 30_000,
        unaryCallTimeoutMillis = 60_000,
        streamReadTimeoutMillis = 0,
        streamCallTimeoutMillis = 0,
    )

    private val nativeConfig = ai.deepseek.dsh.gateway.NativeGatewayConfig(linkTransportConfig, bufferedFramesPerStream = 64)

    /** Fails any pre-pairing call loud. */
    private class UnpairedWire : WireDriving {
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue =
            throw IllegalStateException("not paired")

        override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> =
            throw IllegalStateException("not paired")
    }

    private val switchingWire = SwitchableWireDriving(UnpairedWire())

    /** True once a stored identity rebuilt the client at launch or a
     * pairing succeeded in this process. */
    @Volatile var restored: Boolean = false
        private set

    @Volatile var restoreNeedsPairing: Boolean = false
        private set

    val wire: WireDriving get() = switchingWire

    /** Where the credentials file lives; MainActivity sets it at launch. */
    @Volatile var restoreDirectory: java.io.File? = null

    /** Rebuild the client from persisted credentials so relaunch skips
     * pairing; returns true when a usable identity existed. The signing key
     * opens through the keystore-held AES key. */
    suspend fun restore(directory: java.io.File): Boolean = transition.withLock {
        restoreDirectory = directory
        if (restored) return@withLock true
        val store = credentialsStore(directory)
        var candidate: ai.deepseek.dsh.gateway.NativeGatewayClient? = null
        try {
            withContext(Dispatchers.IO) {
                candidate = ai.deepseek.dsh.gateway.NativeGatewayClient.restore(store, nativeConfig)
            }
            val client = candidate ?: run {
                restoreNeedsPairing = java.io.File(directory, "link-credentials.json").exists() ||
                    java.io.File(directory, "native-gateway-credentials.json").exists()
                return@withLock false
            }
            candidate = null
            switchingWire.replaceAndAwait(client)
            restored = true
            generation++
            restoreNeedsPairing = false
            true
        } catch (_: ai.deepseek.dsh.link.LinkClientException) {
            restoreNeedsPairing = true
            false
        } finally {
            candidate?.closeAndAwait()
        }
    }

    private fun credentialsStore(directory: java.io.File): ai.deepseek.dsh.link.FileLinkCredentialsStore =
        ai.deepseek.dsh.link.FileLinkCredentialsStore(
            java.io.File(directory, "native-gateway-credentials.json"),
            AndroidKeystoreCipher(),
        )

    /** Pair with a scanned payload; returns the failure, or null after adoption. */
    suspend fun pair(payloadText: String, deviceName: String): Exception? = transition.withLock {
        var candidate: ai.deepseek.dsh.gateway.NativeGatewayClient? = null
        val staged = ai.deepseek.dsh.link.MemoryLinkCredentialsStore()
        try {
            val payload = ai.deepseek.dsh.gateway.NativePairing.parse(payloadText)
            val directory = restoreDirectory ?: error("no restore directory configured")
            val store = credentialsStore(directory)
            val client = ai.deepseek.dsh.gateway.NativeGatewayClient.pair(payload, deviceName, staged, nativeConfig)
            candidate = client
            currentCoroutineContext().ensureActive()
            // Once the verified identity is durable, adoption completes even if the Activity is replaced.
            withContext(NonCancellable) {
                withContext(Dispatchers.IO) { store.save(checkNotNull(staged.load())) }
                candidate = null
                switchingWire.replaceAndAwait(client)
                restored = true
                restoreNeedsPairing = false
                generation++
            }
            null
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            failure
        } finally {
            staged.clear()
            candidate?.closeAndAwait()
        }
    }
}

@Composable
fun CompanionApp(model: CompanionViewModel = viewModel()) {
    var tab by remember(model.generation) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    val active = model.paired && !model.pairingRequested
    val pushes = model.pushes
    val context = androidx.compose.ui.platform.LocalContext.current
    HostDescriptionObserver(CompanionRuntime.wire, active)
    // The chapter-70 runtime grant: Android 13+ asks for POST_NOTIFICATIONS
    // at runtime — once per process while the grant is missing — and the
    // answer lands in the projection the push chain reads.
    val grant = remember { NotificationGrantController(context) }
    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { answered -> grant.onUserAnswer(answered) }
    LaunchedEffect(model.paired) {
        grant.refresh()
        if (grant.state.value.shouldRequest) {
            permissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    // The chapter-70 push chain: each forward the live stream delivers
    // becomes one minimized local notification; details stay behind the
    // secure link the app opens into.
    LaunchedEffect(active, pushes) {
        if (!active) return@LaunchedEffect
        pushes.startWatching()
        try {
            pushes.pushes.collect { latest ->
                latest.lastOrNull()?.let { PushNotifications.present(context, it) }
            }
        } finally {
            pushes.stopWatching()
        }
    }
    if (!active) {
        Column(Modifier.fillMaxSize().safeDrawingPadding()) {
            SupportExportAction(model::supportSnapshot)
            PairingScreen(model)
        }
        return
    }
    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEachIndexed { index, label ->
                    NavigationBarItem(
                        modifier = Modifier.testTag("native-tab-$index"),
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
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) { SupportExportAction(model::supportSnapshot) }
                Button(modifier = Modifier.testTag("native-repair"), onClick = { scope.launch { model.beginPairing() } }) {
                    Text(androidx.compose.ui.res.stringResource(R.string.native_repair))
                }
            }
            when (tab) {
                0 -> SessionsTab(model)
                1 -> ApprovalsTab(model)
                2 -> PlanTab(model)
                3 -> ToolsTab(model)
                4 -> FilesTab(model)
                5 -> ArtifactsTab(model)
                else -> SubagentsTab(model)
            }
        }
    }
}

private val tabs = listOf("会话", "审批", "计划", "工具", "文件", "工件", "子代理")

@Composable
fun PairingScreen(model: CompanionViewModel) {
    var payload by remember { mutableStateOf("") }
    var deviceName by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<String?>(null) }
    var pairing by remember { mutableStateOf(false) }
    val genericFailure = androidx.compose.ui.res.stringResource(R.string.native_pairing_failed)
    val scope = rememberCoroutineScope()
    Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("配对到宿主", style = MaterialTheme.typography.titleLarge)
        Text(androidx.compose.ui.res.stringResource(R.string.native_pairing_help), style = MaterialTheme.typography.bodySmall)
        if (model.paired) Text(androidx.compose.ui.res.stringResource(R.string.native_repair_help), style = MaterialTheme.typography.bodySmall)
        if (CompanionRuntime.restoreNeedsPairing) {
            Text(androidx.compose.ui.res.stringResource(R.string.native_pairing_restore_required), color = MaterialTheme.colorScheme.error)
        }
        OutlinedTextField(value = payload, onValueChange = { payload = it }, label = { Text("配对载荷（二维码内容）") }, maxLines = 5, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = deviceName, onValueChange = { deviceName = it }, label = { Text("设备名称") }, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = {
                pairing = true
                scope.launch {
                    try { failure = model.pair(payload, deviceName)?.let { it.message ?: genericFailure } }
                    finally { pairing = false }
                }
            },
            enabled = payload.isNotEmpty() && deviceName.isNotEmpty() && !pairing,
        ) { Text("配对") }
        if (model.paired) Button(enabled = !pairing, onClick = { scope.launch { model.cancelPairing() } }) {
            Text(androidx.compose.ui.res.stringResource(R.string.native_pairing_cancel))
        }
        failure?.let { Text(it, Modifier.testTag("pairing-error"), color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
fun SessionsTab(model: CompanionViewModel) {
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf("") }
    val sessions by model.session.sessions.collectAsStateWithLifecycle()
    val open by model.session.open.collectAsStateWithLifecycle()
    val sending by model.session.sending.collectAsStateWithLifecycle()
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
                        Button(modifier = Modifier.testTag("session-open-${row.id}"), onClick = { scope.launch { model.session.openSession(row.id) } }) { Text("打开") }
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
    val inbox by model.interactions.inbox.collectAsStateWithLifecycle()
    val streamFailure by model.interactions.streamFailure.collectAsStateWithLifecycle()
    val lastRefusal by model.interactions.lastRefusal.collectAsStateWithLifecycle()
    val clientId by model.interactions.clientId.collectAsStateWithLifecycle()
    val answering by model.interactions.answering.collectAsStateWithLifecycle()
    LazyColumn(Modifier.fillMaxSize()) {
        streamFailure?.let { message -> item {
            RaisedCard {
                Text(message, color = MaterialTheme.colorScheme.error)
                Button(onClick = { model.interactions.startWatching() }) {
                    Text(androidx.compose.ui.res.stringResource(R.string.native_retry_connection))
                }
            }
        } }
        lastRefusal?.let { message -> item { Text(message, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) } }
        items(inbox) { pending ->
            RaisedCard {
                Text(pending.title, style = MaterialTheme.typography.bodyLarge)
                if (pending.detail.isNotEmpty()) Text(pending.detail, style = MaterialTheme.typography.bodySmall)
                if (pending.kind == PendingInteraction.Kind.APPROVAL) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !answering && clientId.isNotEmpty(), onClick = { scope.launch { model.interactions.answer(pending, allowedOnce = true) } }) { Text("允许一次") }
                        Button(enabled = !answering && clientId.isNotEmpty(), onClick = { scope.launch { model.interactions.answer(pending, allowedOnce = false) } }) { Text("拒绝") }
                    }
                } else QuestionAnswers(pending, model.interactions)
            }
        }
    }
}

@Composable
private fun QuestionAnswers(pending: PendingInteraction, model: InteractionModel) {
    val scope = rememberCoroutineScope()
    val answering by model.answering.collectAsStateWithLifecycle()
    val clientId by model.clientId.collectAsStateWithLifecycle()
    var selections by remember(pending.id, pending.revision) { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    var custom by remember(pending.id, pending.revision) { mutableStateOf<Map<String, String>>(emptyMap()) }
    for (question in pending.questions) {
        Text(question.question, style = MaterialTheme.typography.titleSmall)
        question.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        for (option in question.options) {
            val selected = option.label in selections[question.id].orEmpty()
            val choose = {
                val previous = selections[question.id].orEmpty()
                selections = selections + (question.id to if (question.multiSelect)
                    (if (selected) previous - option.label else previous + option.label) else listOf(option.label))
                if (!question.multiSelect) custom = custom - question.id
            }
            val choiceModifier = if (question.multiSelect)
                Modifier.toggleable(value = selected, role = Role.Checkbox, onValueChange = { choose() })
            else Modifier.selectable(selected = selected, role = Role.RadioButton, onClick = { choose() })
            Row(choiceModifier.fillMaxWidth()) {
                if (question.multiSelect) androidx.compose.material3.Checkbox(checked = selected, onCheckedChange = null)
                else androidx.compose.material3.RadioButton(selected = selected, onClick = null)
                Column(Modifier.weight(1f)) {
                    Text(option.label)
                    option.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        OutlinedTextField(value = custom[question.id].orEmpty(), onValueChange = { value ->
            custom = custom + (question.id to value)
            if (!question.multiSelect && value.isNotBlank()) selections = selections - question.id
        }, label = { Text(androidx.compose.ui.res.stringResource(R.string.native_answer_custom)) }, modifier = Modifier.fillMaxWidth())
    }
    Button(enabled = !answering && clientId.isNotEmpty() && pending.questions.all { selections[it.id].orEmpty().isNotEmpty() || !custom[it.id].isNullOrBlank() },
        onClick = { scope.launch {
            model.answerQuestions(pending, pending.questions.map {
                CompanionQuestionAnswer(it.id, selections[it.id].orEmpty(), custom[it.id])
            })
        } }) { Text(androidx.compose.ui.res.stringResource(R.string.native_answer_submit)) }
}

@Composable
fun PlanTab(model: CompanionViewModel) {
    val open by model.session.open.collectAsStateWithLifecycle()
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
    val open by model.session.open.collectAsStateWithLifecycle()
    LazyColumn(Modifier.fillMaxSize()) {
        items(open?.state?.toolCalls ?: emptyList()) { call ->
            RaisedCard {
                Text("${call.name} — ${call.phase}", style = MaterialTheme.typography.titleSmall)
                Text(call.arguments, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                if (call.resultText.isNotEmpty()) Text(call.resultText, style = MaterialTheme.typography.bodySmall)
                fileChanges(listOf(call)).firstOrNull()?.let { change -> DiffReview(change) }
            }
        }
    }
}

/** The added-line tone of the diff presentation; the baseline palette
 * carries no semantic colors, so the review surface owns this one. */
private val DiffAddedColor = Color(0xFF2E7D32)

/** The chapter-55 collapsed diff card: path and +/− counts always visible,
 * hunk lines behind the expand toggle. */
@Composable
fun DiffReview(change: FileChange) {
    var expanded by remember(change.path) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(change.path, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
        Text("+${change.added}", style = MaterialTheme.typography.labelLarge, color = DiffAddedColor)
        Text("−${change.removed}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
        Button(onClick = { expanded = !expanded }) { Text(if (expanded) "收起" else "展开") }
    }
    if (expanded) {
        change.lines.forEach { line ->
            Text(
                (if (line.added) "+ " else "− ") + line.text,
                style = MaterialTheme.typography.bodySmall,
                color = if (line.added) DiffAddedColor else MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
fun FilesTab(model: CompanionViewModel) {
    val scope = rememberCoroutineScope()
    val directory by model.files.directory.collectAsStateWithLifecycle()
    val entries by model.files.entries.collectAsStateWithLifecycle()
    val selected by model.files.selectedSession.collectAsStateWithLifecycle()
    val openSession by model.session.open.collectAsStateWithLifecycle()
    val openFile by model.files.openFile.collectAsStateWithLifecycle()
    val openFileError by model.files.openFileError.collectAsStateWithLifecycle()
    // The workspace list arrives over the follow stream; without this start
    // the tab renders entries of a stream nobody opened.
    LaunchedEffect(model.paired) { if (model.paired) model.files.start() }
    LaunchedEffect(openSession?.sessionId) { openSession?.let { model.files.selectSession(it.sessionId) } }
    LaunchedEffect(model.paired, selected) { model.files.list() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                model.files.goUp()
                model.files.closeFile()
                scope.launch { model.files.list() }
            }, enabled = directory.isNotEmpty()) { Text("上一级") }
            Text(directory.joinToString("/") .ifEmpty { "（根目录）" }, style = MaterialTheme.typography.titleSmall)
        }
        openFileError?.let { error ->
            Text(error, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        }
        val file = openFile
        if (file != null) {
            Column(Modifier.weight(1f).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(file.path, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    Text(file.mediaType, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                    Button(onClick = { model.files.closeFile() }) { Text("关闭") }
                }
                Text(
                    androidx.compose.ui.res.stringResource(R.string.loaded_file_lines, file.loadedLines),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
                Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                    Text(file.text, Modifier.testTag("file-content"), style = MaterialTheme.typography.bodySmall)
                }
                if (file.hasMore) {
                    Button(onClick = { scope.launch { model.files.loadMore() } }) { Text("加载更多") }
                }
            }
        } else LazyColumn(Modifier.weight(1f)) {
            items(entries) { entry ->
                RaisedCard(Modifier.testTag("file-entry-${entry.name}")) {
                    Text(if (entry.isDirectory) "📁 ${entry.name}" else "📄 ${entry.name}")
                    if (entry.isDirectory) {
                        Button(onClick = { model.files.openEntry(entry.name); scope.launch { model.files.list() } }) { Text(androidx.compose.ui.res.stringResource(R.string.native_open_directory)) }
                    } else {
                        Button(onClick = { scope.launch { model.files.readFile(entry.name) } }) { Text("查看") }
                    }
                }
            }
        }
    }
}

@Composable
fun ArtifactsTab(model: CompanionViewModel) {
    val open by model.session.open.collectAsStateWithLifecycle()
    LazyColumn(Modifier.fillMaxSize()) {
        items(open?.state?.artifacts ?: emptyList()) { artifact ->
            RaisedCard {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(artifact.title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    Text(
                        artifactStatusLabel(artifact.status),
                        style = MaterialTheme.typography.labelLarge,
                        color = when (artifact.status) {
                            "ready" -> DiffAddedColor
                            "failed" -> MaterialTheme.colorScheme.error
                            else -> MaterialTheme.colorScheme.secondary
                        },
                    )
                }
                Text(artifact.kind, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
            }
        }
    }
}

@Composable
fun SubagentsTab(model: CompanionViewModel) {
    val scope = rememberCoroutineScope()
    val sessions by model.session.sessions.collectAsStateWithLifecycle()
    val rows by model.subagents.rows.collectAsStateWithLifecycle()
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
