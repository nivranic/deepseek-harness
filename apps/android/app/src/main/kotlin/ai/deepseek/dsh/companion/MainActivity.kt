package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import ai.deepseek.dsh.gateway.NativeObservedCapability as NativeCapability

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
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
    internal val shareIntake: NativeShareIntake by viewModels()
    internal val viewLinkIntake: NativeViewLinkIntake by viewModels()
    private val attachmentPicker: NativeFileAttachmentPicker by viewModels()
    private var runtimeResolved = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        shareIntake.onActivityCreated(intent, savedInstanceState != null, packageName)
        viewLinkIntake.onActivityCreated(intent, savedInstanceState != null,
            nativeViewLinkAdmission(model, runtimeResolved, attachmentPicker, shareIntake))
        lifecycleScope.launch {
            CompanionRuntime.restore(filesDir)
            if (isFinishing || isDestroyed) return@launch
            model.reconcileRuntime()
            runtimeResolved = true
            viewLinkIntake.admit(nativeViewLinkAdmission(model, true, attachmentPicker, shareIntake))
            if (!isFinishing && !isDestroyed) {
                setContent {
                    CompanionTheme {
                        CompanionApp(model)
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        routeNativeIncomingIntent(intent, packageName, shareIntake, viewLinkIntake,
            nativeViewLinkAdmission(model, runtimeResolved, attachmentPicker, shareIntake))
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
    private var models by mutableStateOf(CompanionModelSet(CompanionRuntime.wire, viewModelScope, CompanionRuntime.inputs, CompanionRuntime.downloadFiles(), CompanionRuntime.uploadDigests))
    var generation by mutableStateOf(CompanionRuntime.generation)
        private set
    var pairingRequested by mutableStateOf(false)
        private set
    var switching by mutableStateOf(false)
        private set
    var hostOperationFailed by mutableStateOf(false)
        private set
    val session get() = models.session
    val interactions get() = models.interactions
    val files get() = models.files
    val downloads get() = models.downloads
    val attachments get() = models.attachments
    val subagents get() = models.subagents
    val pushes get() = models.pushes
    val inputs get() = models.inputs
    var inputRecoveryFailed by mutableStateOf(false)
        private set

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
        models = CompanionModelSet(CompanionRuntime.wire, viewModelScope, CompanionRuntime.inputs, CompanionRuntime.downloadFiles(), CompanionRuntime.uploadDigests)
        generation = CompanionRuntime.generation
        paired = CompanionRuntime.restored
        pairingRequested = false
        inputRecoveryFailed = false
    }

    /** Disable business UI before draining its producers, then rebuild against the resulting identity. */
    private fun changeHost(operation: suspend () -> Unit) = viewModelScope.launch {
        transition.withLock {
            switching = true
            hostOperationFailed = false
            try {
                models.closeAndAwait()
                operation()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { hostOperationFailed = true }
            finally {
                withContext(NonCancellable) {
                    publishModels()
                    switching = false
                }
            }
        }
    }

    fun selectHost(key: NativeHostKey) = changeHost { CompanionRuntime.selectHost(key) }
    fun recoverHosts() = changeHost { CompanionRuntime.recoverHosts() }
    fun importLegacyHost() = changeHost { CompanionRuntime.importLegacy() }

    /** Explicit local recovery never submits a prompt or an interaction reply. */
    fun recoverInputs() = viewModelScope.launch {
        transition.withLock {
            if (inputs.persistence.value != InputPersistenceStatus.RESTORE_FAILED) return@withLock
            inputRecoveryFailed = false
            try {
                inputs.startFresh()
                models.closeAndAwait()
                publishModels()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: InputPersistenceException) { inputRecoveryFailed = true }
        }
    }

    fun retryInputSave() = viewModelScope.launch {
        try { inputs.flush() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: InputPersistenceException) {
            // The persistence state already exposes the failed checkpoint; this does not retry a Host mutation.
        }
    }

    /** Pair with a scanned payload; returns the failure, or null after adoption. */
    suspend fun pair(payloadText: String, deviceName: String): Exception? = transition.withLock {
        if (paired && !pairingRequested) return@withLock null
        models.closeAndAwait()
        val priorGeneration = CompanionRuntime.generation
        try {
            CompanionRuntime.pair(payloadText, deviceName).also {
                if (it == null) publishModels()
            }
        } finally {
            if (generation != CompanionRuntime.generation && priorGeneration != CompanionRuntime.generation) {
                withContext(NonCancellable) { publishModels() }
            }
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
    private val inputScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val nativeConfig = ai.deepseek.dsh.gateway.NativeGatewayConfig(
        ai.deepseek.dsh.link.LinkTransportConfig(
            connectTimeoutMillis = 10_000, writeTimeoutMillis = 30_000,
            unaryReadTimeoutMillis = 30_000, unaryCallTimeoutMillis = 60_000,
            streamReadTimeoutMillis = 0, streamCallTimeoutMillis = 0,
        ), bufferedFramesPerStream = 64,
    )
    private var controller: CompanionHostController? = null
    private val emptyState = kotlinx.coroutines.flow.MutableStateFlow(NativeHostState())
    private val emptyInputs = CompanionInputState.memory()
    private val unpairedWire = object : WireDriving {
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("not paired")
        override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> = error("not paired")
    }
    val hostState: kotlinx.coroutines.flow.StateFlow<NativeHostState> get() = controller?.state ?: emptyState
    val generation: Long get() = hostState.value.generation
    val restored: Boolean get() = hostState.value.status == NativeHostStatus.READY
    val inputs: CompanionInputState get() = controller?.inputs ?: emptyInputs
    val wire: WireDriving get() = controller?.wire ?: unpairedWire
    var restoreDirectory: java.io.File? = null
        private set
    private var digestMemory: NativeUploadDigestMemory? = null
    /** One durable digest memory per restored installation; unpaired state reads as none. */
    val uploadDigests: NativeUploadDigestMemory? get() {
        val directory = restoreDirectory ?: return null
        return digestMemory ?: FileNativeUploadDigestMemory(java.io.File(directory, "upload-digests.json")).also { digestMemory = it }
    }
    var legacyImportAvailable by mutableStateOf(false)
        private set
    var restoreNeedsPairing by mutableStateOf(false)
        private set

    /** Restore the encrypted catalog once; legacy single-Host credentials require explicit import. */
    suspend fun restore(directory: java.io.File): Boolean = transition.withLock {
        restoreDirectory = directory
        val owner = controller ?: CompanionHostController(
            FileNativeHostStore(java.io.File(directory, "native-hosts.enc"), AndroidKeystoreCipher("dsh-native-hosts"), 1_048_576),
            { credentials ->
                val staged = ai.deepseek.dsh.link.MemoryLinkCredentialsStore()
                try {
                    staged.save(credentials)
                    checkNotNull(ai.deepseek.dsh.gateway.NativeGatewayClient.restore(staged, nativeConfig))
                } finally { staged.clear() }
            },
            { credentials -> restoreInputs(directory, credentials) },
        ).also { controller = it }
        owner.restore()
        refreshLegacyAvailability(directory)
        restored
    }

    /** Storage selection captures the verified grant; signed requests remain owned by the matching model set. */
    fun downloadFiles(): NativeDownloadFiles? {
        if (!restored) return null
        val principal = controller?.principal ?: return null
        val directory = java.io.File(restoreDirectory ?: return null, "native-downloads")
        return NativeDownloadFiles(directory, principal, AndroidKeystoreCipher("dsh-native-downloads"),
            NativeDownloadLimits(64 * 1024, 1_073_741_824), NativeDownloadQuota(directory, 2_147_483_648, 128))
    }

    private fun refreshLegacyAvailability(directory: java.io.File) {
        legacyImportAvailable = hostState.value.status == NativeHostStatus.EMPTY &&
            !java.io.File(directory, "native-hosts.enc").exists() && java.io.File(directory, "native-gateway-credentials.json").isFile
        restoreNeedsPairing = hostState.value.status == NativeHostStatus.EMPTY &&
            java.io.File(directory, "link-credentials.json").exists()
    }

    private suspend fun restoreInputs(directory: java.io.File, credentials: ai.deepseek.dsh.link.LinkCredentials): CompanionInputState =
        CompanionInputState.restore(FileCompanionInputStore(
            java.io.File(directory, "native-input"),
            CompanionInputPrincipal(credentials.hostId, credentials.pinnedFingerprint, credentials.deviceId),
            AndroidKeystoreCipher("dsh-native-input"), maxBytes = 1_048_576,
        ), inputScope)

    suspend fun selectHost(key: NativeHostKey) = transition.withLock { checkNotNull(controller).select(key) }

    suspend fun recoverHosts() = transition.withLock {
        checkNotNull(controller).startFresh()
        refreshLegacyAvailability(checkNotNull(restoreDirectory))
    }

    /** Import only the native-format single-Host identity; preserve the original file on every outcome. */
    suspend fun importLegacy() = transition.withLock {
        check(legacyImportAvailable)
        val staged = ai.deepseek.dsh.link.MemoryLinkCredentialsStore()
        var candidate: ai.deepseek.dsh.gateway.NativeGatewayClient? = null
        try {
            val credentials = withContext(Dispatchers.IO) {
                ai.deepseek.dsh.link.FileLinkCredentialsStore(
                    java.io.File(checkNotNull(restoreDirectory), "native-gateway-credentials.json"), AndroidKeystoreCipher(),
                ).load()
            } ?: throw NativeHostException()
            staged.save(credentials)
            withContext(Dispatchers.IO) { candidate = ai.deepseek.dsh.gateway.NativeGatewayClient.restore(staged, nativeConfig) }
            val client = candidate ?: throw NativeHostException()
            candidate = null
            checkNotNull(controller).remember(credentials, client)
        } finally {
            staged.clear()
            withContext(NonCancellable) { candidate?.closeAndAwait() }
            refreshLegacyAvailability(checkNotNull(restoreDirectory))
        }
    }

    /** Pairing verifies a new grant before the catalog controller takes ownership. */
    suspend fun pair(payloadText: String, deviceName: String): Exception? = transition.withLock {
        var candidate: ai.deepseek.dsh.gateway.NativeGatewayClient? = null
        val staged = ai.deepseek.dsh.link.MemoryLinkCredentialsStore()
        try {
            if (inputs.persistence.value != InputPersistenceStatus.RESTORE_FAILED) inputs.flush()
            val payload = ai.deepseek.dsh.gateway.NativePairing.parse(payloadText)
            val client = ai.deepseek.dsh.gateway.NativeGatewayClient.pair(payload, deviceName, staged, nativeConfig)
            candidate = client
            val credentials = checkNotNull(staged.load())
            candidate = null
            checkNotNull(controller).remember(credentials, client)
            null
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { failure }
        finally {
            staged.clear()
            withContext(NonCancellable) { candidate?.closeAndAwait() }
            restoreDirectory?.let(::refreshLegacyAvailability)
        }
    }
}

@Composable
fun CompanionApp(model: CompanionViewModel = viewModel()) {
    var tab by remember(model.generation) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    val hosts by CompanionRuntime.hostState.collectAsStateWithLifecycle()
    val active = model.paired && !model.pairingRequested && !model.switching && hosts.status == NativeHostStatus.READY
    val pushes = model.pushes
    val context = androidx.compose.ui.platform.LocalContext.current
    val resourceSavePicker: NativeResourceSavePicker = viewModel()
    val saveContent = rememberNativeResourceSaveLauncher(resourceSavePicker)
    val fileAttachmentPicker: NativeFileAttachmentPicker = viewModel()
    val shareIntake: NativeShareIntake = viewModel()
    val viewLinkIntake: NativeViewLinkIntake = viewModel()
    val attachFile = rememberNativeFileAttachmentLauncher(fileAttachmentPicker)
    val saveResource: (NativeResourceState) -> Unit = { resource ->
        model.files.resource.saves.prepare(resource)?.let { saveContent(it, model.files.resource.saves) }
    }
    val saveDownload: (NativeResourceTarget) -> Unit = { target ->
        model.downloads.prepareSave(target)?.let { saveContent(it.first, it.second) }
    }
    val selectedResource by model.files.resource.state.collectAsStateWithLifecycle()
    LaunchedEffect(model.generation, selectedResource?.target, selectedResource?.phase == NativeResourcePhase.LOADING) {
        resourceSavePicker.selectionChanged()
    }
    var descriptionRefresh by remember(model.generation) { mutableStateOf(0) }
    val description = HostDescriptionObserver(CompanionRuntime.wire, active, model.generation, descriptionRefresh)
    val capabilities = description.snapshot?.takeUnless { it.closed }?.description?.capabilities
    NativeViewLinkEffects(viewLinkIntake, model, description, fileAttachmentPicker, shareIntake) { tab = 0 }
    val retryViewLink = {
        descriptionRefresh++
        viewLinkIntake.retry(nativeViewLinkAdmission(model, true, fileAttachmentPicker, shareIntake))
    }
    val grant = (context.applicationContext as CompanionApplication).notificationGrant
    val notificationGrant by grant.state.collectAsStateWithLifecycle()
    var notificationRequestUnavailable by remember { mutableStateOf(false) }
    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { answered -> grant.onUserAnswer(answered) }
    NativeNotificationGrantObserver(grant,
        request = { permissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS) },
        onRequestUnavailable = { notificationRequestUnavailable = true })
    val openNotificationSettings = { context.startActivity(nativeNotificationSettingsIntent(context.packageName)) }
    NativePushObserver(pushes, active) { PushNotifications.present(context, it) }
    if (!active) {
        Column(Modifier.fillMaxSize().safeDrawingPadding()) {
            NativeNotificationGrantNotice(notificationGrant, notificationRequestUnavailable, openNotificationSettings)
            NativeViewLinkCard(viewLinkIntake, retryViewLink)
            NativeShareCard(shareIntake, model, capabilities, fileAttachmentPicker)
            NativeResourceSaveNotice(resourceSavePicker)
            if (fileAttachmentPicker.cameraCleanupFailed) Text(androidx.compose.ui.res.stringResource(R.string.native_camera_cleanup_failed),
                Modifier.testTag("camera-cleanup-error"), color = MaterialTheme.colorScheme.error)
            SupportExportAction(model::supportSnapshot)
            NativeHostControls(model, hosts)
            if (!model.switching && hosts.status !in setOf(NativeHostStatus.RESTORE_FAILED, NativeHostStatus.RETIREMENT_FAILED)) {
                PairingScreen(model)
            }
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
            NativeNotificationGrantNotice(notificationGrant, notificationRequestUnavailable, openNotificationSettings)
            NativeViewLinkCard(viewLinkIntake, retryViewLink)
            NativeShareCard(shareIntake, model, capabilities, fileAttachmentPicker)
            NativeHostControls(model, hosts)
            HostCapabilityDetails(description, model.generation) { descriptionRefresh++ }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) { SupportExportAction(model::supportSnapshot) }
                Button(modifier = Modifier.testTag("native-repair"), onClick = { scope.launch { model.beginPairing() } }) {
                    Text(androidx.compose.ui.res.stringResource(R.string.native_repair))
                }
            }
            InputPersistenceNotice(model)
            NativeResourceSaveNotice(resourceSavePicker)
            if (fileAttachmentPicker.cameraCleanupFailed) Text(androidx.compose.ui.res.stringResource(R.string.native_camera_cleanup_failed),
                Modifier.testTag("camera-cleanup-error"), color = MaterialTheme.colorScheme.error)
            when (tab) {
                0 -> SessionsTab(model, capabilities, fileAttachmentPicker, attachFile)
                1 -> ApprovalsTab(model)
                2 -> PlanTab(model)
                3 -> ToolsTab(model)
                4 -> FilesTab(model, capabilities, resourceSavePicker.busy, saveResource, saveDownload)
                5 -> ArtifactsTab(model, capabilities, resourceSavePicker.busy, saveResource, saveDownload)
                else -> SubagentsTab(model, capabilities)
            }
        }
    }
}

@Composable
private fun NativeHostControls(model: CompanionViewModel, hosts: NativeHostState) {
    var expanded by remember { mutableStateOf(false) }
    val busy = model.switching || hosts.status == NativeHostStatus.SWITCHING
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        hosts.selected?.let { selected ->
            Text(androidx.compose.ui.res.stringResource(R.string.native_host_current, selected.name),
                Modifier.testTag("native-host-current"), style = MaterialTheme.typography.titleMedium)
            Text(selected.endpoint, style = MaterialTheme.typography.bodySmall)
        }
        if (busy) Text(androidx.compose.ui.res.stringResource(R.string.native_host_switching), Modifier.testTag("native-host-switching"))
        if (hosts.hosts.size > 1 && !model.pairingRequested) {
            Button(enabled = !busy && hosts.status == NativeHostStatus.READY, onClick = { expanded = !expanded },
                modifier = Modifier.testTag("native-host-chooser")) {
                Text(androidx.compose.ui.res.stringResource(R.string.native_host_choose))
            }
            if (expanded) Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 200.dp)) {
                hosts.hosts.forEach { host ->
                    Button(enabled = !busy && host.key != hosts.active && hosts.status == NativeHostStatus.READY,
                        modifier = Modifier.testTag("native-host-select-${host.key.value}"),
                        onClick = { expanded = false; model.selectHost(host.key) }) {
                        Column { Text(host.name); Text(host.endpoint, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
        if (hosts.status == NativeHostStatus.RESTORE_FAILED) {
            Text(androidx.compose.ui.res.stringResource(R.string.native_host_restore_failed), Modifier.testTag("native-host-restore-failed"),
                color = MaterialTheme.colorScheme.error)
            Button(enabled = !busy, onClick = { model.recoverHosts() }, modifier = Modifier.testTag("native-host-start-fresh")) {
                Text(androidx.compose.ui.res.stringResource(R.string.native_host_start_fresh))
            }
        }
        if (hosts.status == NativeHostStatus.RETIREMENT_FAILED) {
            Text(androidx.compose.ui.res.stringResource(R.string.native_host_retirement_failed), color = MaterialTheme.colorScheme.error)
        }
        if (CompanionRuntime.legacyImportAvailable) {
            Button(enabled = !busy, onClick = { model.importLegacyHost() }, modifier = Modifier.testTag("native-host-import")) {
                Text(androidx.compose.ui.res.stringResource(R.string.native_host_import))
            }
        }
        if (model.hostOperationFailed) Text(androidx.compose.ui.res.stringResource(R.string.native_host_operation_failed),
            Modifier.testTag("native-host-operation-failed"), color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun InputPersistenceNotice(model: CompanionViewModel) {
    val status by model.inputs.persistence.collectAsStateWithLifecycle()
    when (status) {
        InputPersistenceStatus.MEMORY_ONLY, InputPersistenceStatus.SAVED -> Unit
        InputPersistenceStatus.SAVING -> Text(androidx.compose.ui.res.stringResource(R.string.native_input_saving),
            Modifier.testTag("input-saving").padding(horizontal = 16.dp))
        InputPersistenceStatus.WRITE_FAILED -> Row(Modifier.padding(horizontal = 16.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.native_input_save_failed), Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
            Button(onClick = { model.retryInputSave() }) { Text(androidx.compose.ui.res.stringResource(R.string.native_input_retry_save)) }
        }
        InputPersistenceStatus.RESTORE_FAILED -> Column(Modifier.padding(horizontal = 16.dp).testTag("input-restore-failed")) {
            Text(androidx.compose.ui.res.stringResource(R.string.native_input_restore_failed), color = MaterialTheme.colorScheme.error)
            Button(onClick = { model.recoverInputs() }, modifier = Modifier.testTag("input-start-fresh")) {
                Text(androidx.compose.ui.res.stringResource(R.string.native_input_start_fresh))
            }
            if (model.inputRecoveryFailed) Text(androidx.compose.ui.res.stringResource(R.string.native_input_recovery_failed), color = MaterialTheme.colorScheme.error)
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

private fun Set<NativeCapability>?.supports(capability: NativeCapability): Boolean = this?.contains(capability) == true

@Composable
private fun MissingNativeCapability(capabilities: Set<NativeCapability>?) {
    Text(androidx.compose.ui.res.stringResource(if (capabilities == null) R.string.native_capabilities_waiting
        else R.string.native_capabilities_operation_absent), Modifier.padding(16.dp).testTag("native-operation-unavailable"))
}

@Composable
internal fun SessionsTab(model: CompanionViewModel, capabilities: Set<NativeCapability>?,
                         fileAttachmentPicker: NativeFileAttachmentPicker, attachFile: (NativeFileAttachmentsModel, NativeAttachmentOrigin) -> Unit) {
    val canList = capabilities.supports(NativeCapability.SESSION_LIST)
    val canFollow = capabilities.supports(NativeCapability.SESSION_FOLLOW)
    val canControl = capabilities.supports(NativeCapability.SESSION_CONTROL)
    val canUpload = capabilities.supports(NativeCapability.FILE_UPLOAD) && capabilities.supports(NativeCapability.HTTP_REQUEST_BUDGET)
    val canUploadImages = capabilities.supports(NativeCapability.IMAGE_UPLOAD) && capabilities.supports(NativeCapability.HTTP_REQUEST_BUDGET)
    val scope = rememberCoroutineScope()
    val sessions by model.session.sessions.collectAsStateWithLifecycle()
    val listState by model.session.listState.collectAsStateWithLifecycle()
    val open by model.session.open.collectAsStateWithLifecycle()
    val input by model.session.input.collectAsStateWithLifecycle()
    val persistence by model.inputs.persistence.collectAsStateWithLifecycle()
    val editable = persistence != InputPersistenceStatus.RESTORE_FAILED
    val sendFailure by model.session.sendFailure.collectAsStateWithLifecycle()
    val draft = open?.sessionId?.let { input.drafts[it]?.text }.orEmpty()
    val attachedFiles = open?.sessionId?.let { input.drafts[it]?.attachments }.orEmpty()
    val attachmentState by model.attachments.state.collectAsStateWithLifecycle()
    val attachmentBusy = attachmentState.phase in setOf(NativeFileAttachmentPhase.SELECTING,
        NativeFileAttachmentPhase.READING, NativeFileAttachmentPhase.UPLOADING, NativeFileAttachmentPhase.CLEANING)
    val sending by model.session.sending.collectAsStateWithLifecycle()
    var cancelFailed by remember(model.session, open?.sessionId) { mutableStateOf(false) }
    val history by model.session.history.collectAsStateWithLifecycle()
    val anchor by model.session.viewAnchor.collectAsStateWithLifecycle()
    val timeline = rememberLazyListState()
    var revealed by remember(model.session) { mutableStateOf<NativeViewAnchor?>(null) }
    LaunchedEffect(model.session, anchor, open?.state?.items?.firstOrNull()?.seq) {
        val target = anchor ?: run { revealed = null; return@LaunchedEffect }
        if (target == revealed) return@LaunchedEffect
        val index = open?.state?.items?.indexOfFirst { it.seq == target.seq } ?: -1
        if (index >= 0) {
            timeline.scrollToItem(index + input.pendingPrompts.values.count { it.sessionId == open?.sessionId })
            revealed = target
        }
    }
    LaunchedEffect(model.session, canList, canFollow) {
        if (!canFollow) model.session.closeAndAwait()
        if (canList) model.session.loadSessions()
        if (canFollow && model.session.open.value == null) model.session.restoreSelection()
    }
    Column(Modifier.fillMaxSize()) {
        if (canFollow) SessionViewLocationActions(model, timeline)
        SessionModelSelection(model, capabilities)
        if (!canList && open == null || !canFollow) MissingNativeCapability(capabilities)
        Row(Modifier.fillMaxWidth()) {
            Text(
                open?.let { "已打开会话 ${it.sessionId}" } ?: "会话",
                Modifier.weight(1f).padding(16.dp),
                style = MaterialTheme.typography.titleMedium,
            )
            if (open == null && canList) Button(
                modifier = Modifier.testTag("session-list-refresh").padding(horizontal = 16.dp),
                enabled = listState != SessionListState.Loading,
                onClick = { scope.launch { model.session.loadSessions() } },
            ) {
                Text(androidx.compose.ui.res.stringResource(if (listState is SessionListState.Failed)
                    R.string.native_sessions_retry else R.string.native_sessions_refresh))
            }
            if (open != null) Button(modifier = Modifier.testTag("session-return-list"), onClick = {
                scope.launch { model.session.returnToList() }
            }) { Text(androidx.compose.ui.res.stringResource(R.string.native_session_return_list)) }
        }
        if (open != null) SessionLocationFacts(model)
        if (open == null && canList) when (val state = listState) {
            SessionListState.Idle -> Unit
            SessionListState.Loading -> Text(androidx.compose.ui.res.stringResource(R.string.native_sessions_loading), Modifier.padding(16.dp))
            SessionListState.Ready -> if (sessions.isEmpty()) Text(androidx.compose.ui.res.stringResource(R.string.native_sessions_empty), Modifier.padding(16.dp))
            is SessionListState.Failed -> Text(sessionListFailureText(state),
                Modifier.testTag("session-list-error").padding(16.dp), color = MaterialTheme.colorScheme.error)
        }
        if (open != null) {
            if (canFollow && history.hasMore) Button(modifier = Modifier.testTag("session-load-older"), enabled = !history.loading,
                onClick = { scope.launch { model.session.loadOlderHistory() } }) {
                Text(androidx.compose.ui.res.stringResource(if (history.loading) R.string.native_history_loading else R.string.native_history_load_older))
            }
            if (history.failure != null) Text(androidx.compose.ui.res.stringResource(R.string.native_history_failed),
                Modifier.testTag("session-history-error"), color = MaterialTheme.colorScheme.error)
        }
        LazyColumn(Modifier.weight(1f).testTag("session-rows"), state = timeline) {
            if (open == null) {
                items(if (canList) sessions else emptyList()) { row ->
                    RaisedCard {
                        Text(row.title, style = MaterialTheme.typography.bodyLarge)
                        if (canFollow) Button(modifier = Modifier.testTag("session-open-${row.id}"), onClick = { scope.launch { model.session.openSession(row.id) } }) { Text("打开") }
                    }
                }
            } else {
                items(input.pendingPrompts.values.filter { it.sessionId == open?.sessionId }, key = { "pending-" + it.draft.requestId }) { pending ->
                    RaisedCard {
                        Text(androidx.compose.ui.res.stringResource(R.string.native_prompt_unconfirmed))
                        Text(pending.draft.text)
                        NativePendingFileAttachments(pending.draft.attachments)
                        Text(androidx.compose.ui.res.stringResource(R.string.native_prompt_discard_notice), style = MaterialTheme.typography.bodySmall)
                        Row {
                            if (canControl) Button(enabled = !sending && !attachmentBusy && editable, onClick = { model.session.retryPrompt(pending.draft.requestId) }) {
                                Text(androidx.compose.ui.res.stringResource(R.string.native_prompt_retry))
                            }
                            Button(enabled = !sending && editable, onClick = { model.session.discardPending(pending.draft.requestId) }) {
                                Text(androidx.compose.ui.res.stringResource(R.string.native_prompt_discard))
                            }
                        }
                    }
                }
                items(open!!.state.items, key = { "event-${it.seq}" }) { item ->
                    RaisedCard(Modifier.testTag("session-event-${item.seq}")) {
                        Text(item.kind, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                        if (item.text.isNotEmpty()) Text(item.text)
                    }
                }
            }
        }
        sendFailure?.takeIf { it.sessionId == open?.sessionId }?.let { failure ->
            val detail = if (failure.attachmentReceiptUnavailable) {
                androidx.compose.ui.res.stringResource(R.string.native_prompt_attachment_unavailable)
            } else {
                failure.refusal?.let { GatewayFailurePresenter.present(it).text }
                    ?: androidx.compose.ui.res.stringResource(R.string.native_prompt_failed)
            }
            Text(detail, Modifier.testTag("session-send-error").padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        }
        if (open != null && !canControl) MissingNativeCapability(capabilities)
        if (cancelFailed) Text(androidx.compose.ui.res.stringResource(R.string.native_stop_unconfirmed),
            Modifier.testTag("session-cancel-error").padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        open?.sessionId?.let { sessionId ->
            NativeFileAttachmentCards(attachedFiles, editable && !sending && !attachmentBusy) {
                model.session.removeAttachment(sessionId, it)
            }
            NativeFileAttachmentNotice(model.attachments, attachmentState, sessionId, fileAttachmentPicker)
            if (!canUpload) Text(androidx.compose.ui.res.stringResource(
                if (capabilities.supports(NativeCapability.FILE_UPLOAD)) R.string.native_attachment_budget_unavailable
                else R.string.native_attachment_unsupported),
                Modifier.padding(horizontal = 12.dp).testTag("session-attachment-unavailable"), style = MaterialTheme.typography.bodySmall)
            if (!canUploadImages) Text(androidx.compose.ui.res.stringResource(
                if (capabilities.supports(NativeCapability.IMAGE_UPLOAD)) R.string.native_attachment_photo_budget_unavailable
                else R.string.native_attachment_photo_unavailable),
                Modifier.padding(horizontal = 12.dp).testTag("session-photo-unavailable"), style = MaterialTheme.typography.bodySmall)
        }
        // §30 adds the steer submission beside the queue send with a two-character label: the
        // one-row composer is the layout the acceptance lanes exercise against the soft keyboard,
        // and a longer label would overflow the row on phone widths and collapse the session list.
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canControl && (canUpload || canUploadImages)) NativeFileAttachmentAddButton(
                enabled = open != null && editable && !sending && !attachmentBusy && !fileAttachmentPicker.busy,
                allowFiles = canUpload, allowImages = canUploadImages, select = { attachFile(model.attachments, it) })
            OutlinedTextField(value = draft, onValueChange = { text -> open?.sessionId?.let { model.session.updateDraft(it, text) } },
                label = { Text("发消息给宿主…") }, enabled = open != null && editable, modifier = Modifier.weight(1f).testTag("session-draft"))
            if (canControl) Button(modifier = Modifier.testTag("session-send"), onClick = {
                model.session.submitDraft()
            }, enabled = open != null && editable && (draft.isNotEmpty() || attachedFiles.isNotEmpty()) && !sending && !attachmentBusy) { Text("发送") }
            if (canControl && capabilities.supports(NativeCapability.MODEL_STEER)) Button(modifier = Modifier.testTag("session-steer"), onClick = {
                model.session.submitDraft(steer = true)
            }, enabled = open != null && editable && (draft.isNotEmpty() || attachedFiles.isNotEmpty()) && !sending && !attachmentBusy) { Text("转向") }
            if (canControl) Button(modifier = Modifier.testTag("session-cancel"), enabled = open != null, onClick = { scope.launch {
                cancelFailed = false
                try { model.session.cancelActive() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { cancelFailed = true }
            } }) { Text("停止") }
        }
    }
}

@Composable
private fun SessionViewLocationActions(model: CompanionViewModel, timeline: LazyListState) {
    val session = model.session
    val open by session.open.collectAsStateWithLifecycle()
    val host by CompanionRuntime.hostState.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var showImport by remember(session) { mutableStateOf(false) }
    var encoded by remember(session) { mutableStateOf("") }
    var importing by remember(session) { mutableStateOf(false) }
    var importJob by remember(session) { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    var importGeneration by remember(session) { mutableStateOf(0L) }
    var failed by remember(session) { mutableStateOf(false) }
    var copied by remember(session) { mutableStateOf(false) }
    var copiedLink by remember(session) { mutableStateOf(false) }
    val copyLabel = androidx.compose.ui.res.stringResource(R.string.native_view_copy)
    val copyLinkLabel = androidx.compose.ui.res.stringResource(R.string.native_view_link_copy)
    val visibleAnchor = timeline.layoutInfo.visibleItemsInfo.firstNotNullOfOrNull { row ->
        (row.key as? String)?.takeIf { it.startsWith("event-") }?.removePrefix("event-")?.toLongOrNull()
    }
    fun copyLocation(deepLink: Boolean) {
        val current = open ?: return
        val selected = host.selected ?: return
        val visible = visibleAnchor ?: return
        val location = NativeViewLocation(selected.hostId, current.sessionId, visible)
        val payload = if (deepLink) NativeViewLocations.encodeDeepLink(location) else NativeViewLocations.encode(location)
        val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText(if (deepLink) copyLinkLabel else copyLabel, payload))
        copied = !deepLink; copiedLink = deepLink
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(enabled = host.status == NativeHostStatus.READY && visibleAnchor != null,
            modifier = Modifier.testTag("session-view-copy"), onClick = { copyLocation(false) }) { Text(copyLabel) }
        Button(enabled = host.status == NativeHostStatus.READY, modifier = Modifier.testTag("session-view-import"),
            onClick = { failed = false; copied = false; copiedLink = false; showImport = true }) {
            Text(androidx.compose.ui.res.stringResource(R.string.native_view_open))
        }
    }
    TextButton(enabled = host.status == NativeHostStatus.READY && visibleAnchor != null,
        modifier = Modifier.padding(horizontal = 12.dp).testTag("session-view-link-copy"), onClick = { copyLocation(true) }) {
        Text(copyLinkLabel)
    }
    if (copied) Text(androidx.compose.ui.res.stringResource(R.string.native_view_copied), Modifier.padding(horizontal = 16.dp))
    if (copiedLink) Text(androidx.compose.ui.res.stringResource(R.string.native_view_link_copied), Modifier.padding(horizontal = 16.dp))
    if (showImport) AlertDialog(
        onDismissRequest = { importGeneration++; importJob?.cancel(); importing = false; showImport = false; encoded = "" },
        title = { Text(androidx.compose.ui.res.stringResource(R.string.native_view_open)) },
        text = {
            Column {
                Text(androidx.compose.ui.res.stringResource(R.string.native_view_help))
                OutlinedTextField(value = encoded, onValueChange = { encoded = it }, enabled = !importing,
                    label = { Text(androidx.compose.ui.res.stringResource(R.string.native_view_payload)) },
                    modifier = Modifier.testTag("session-view-payload"), maxLines = 4)
                if (failed) Text(androidx.compose.ui.res.stringResource(R.string.native_view_failed),
                    Modifier.testTag("session-view-error"), color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            Button(enabled = encoded.isNotEmpty() && !importing, modifier = Modifier.testTag("session-view-confirm"), onClick = {
                importing = true
                failed = false
                val generation = ++importGeneration
                importJob = scope.launch {
                    try {
                        val location = NativeViewLocations.decode(encoded, maxCharacters = 4096)
                        session.openViewLocation(location, host.selected?.hostId)
                        if (generation == importGeneration) { showImport = false; encoded = "" }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { if (generation == importGeneration) failed = true }
                    finally { if (generation == importGeneration) importing = false }
                }
            }) { Text(androidx.compose.ui.res.stringResource(if (importing) R.string.native_view_opening else R.string.native_view_open)) }
        },
        dismissButton = {
            Button(modifier = Modifier.testTag("session-view-cancel"),
                onClick = { importGeneration++; importJob?.cancel(); importing = false; showImport = false; encoded = "" }) {
                Text(androidx.compose.ui.res.stringResource(R.string.native_pairing_cancel))
            }
        },
    )
}

/** §30 model selection: an advertised model.select.v1 opens the Host catalog picker; the
 * Host resolves and normalizes every selection, the device only sends the intent. */
@Composable
private fun SessionModelSelection(model: CompanionViewModel, capabilities: Set<NativeCapability>?) {
    val session = model.session
    val scope = rememberCoroutineScope()
    val open by session.open.collectAsStateWithLifecycle()
    var showPicker by remember(session) { mutableStateOf(false) }
    var catalog by remember(session) { mutableStateOf<NativeModelCatalog?>(null) }
    var loading by remember(session) { mutableStateOf(false) }
    var failed by remember(session) { mutableStateOf(false) }
    var selected by remember(session) { mutableStateOf<String?>(null) }
    if (open == null || !capabilities.supports(NativeCapability.MODEL_SELECT)) return
    Button(modifier = Modifier.padding(horizontal = 12.dp).testTag("session-model-select"), onClick = {
        if (!showPicker && catalog == null) {
            loading = true; failed = false
            scope.launch {
                try { catalog = session.modelCatalog() }
                catch (_: Exception) { failed = true }
                finally { loading = false }
            }
        }
        showPicker = true
    }) { Text("模型") }
    if (selected != null) Text("已选择 $selected", Modifier.padding(horizontal = 16.dp).testTag("session-model-selected"))
    if (showPicker) AlertDialog(
        onDismissRequest = { showPicker = false },
        title = { Text("模型选择") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (loading) Text("正在加载目录…")
                if (failed) Text("目录加载失败", color = MaterialTheme.colorScheme.error)
                catalog?.let { loaded ->
                    for (group in loaded.groups) {
                        Text(group.name, style = MaterialTheme.typography.titleSmall)
                        for (entry in group.models) {
                            Button(modifier = Modifier.fillMaxWidth().testTag("catalog-model-${entry.id}"),
                                enabled = !loading, onClick = {
                                    failed = false
                                    scope.launch {
                                        try {
                                            session.selectModel(group.id, entry.id, entry.reasoning?.defaultEffort)
                                            selected = entry.name
                                            showPicker = false
                                        } catch (cancelled: CancellationException) { throw cancelled }
                                        catch (_: Exception) { failed = true }
                                    }
                                }) { Text(entry.name) }
                            // Effort choices ride the model row: tapping an effort selects the
                            // model at that effort; a model without reasoning offers none.
                            entry.reasoning?.let { reasoning ->
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    for (effort in reasoning.efforts) {
                                        Button(modifier = Modifier.weight(1f).testTag("catalog-effort-${effort.id}"),
                                            enabled = !loading, onClick = {
                                                failed = false
                                                scope.launch {
                                                    try {
                                                        session.selectModel(group.id, entry.id, effort.id)
                                                        selected = "${entry.name} · ${effort.name}"
                                                        showPicker = false
                                                    } catch (cancelled: CancellationException) { throw cancelled }
                                                    catch (_: Exception) { failed = true }
                                                }
                                            }) { Text(effort.name) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { showPicker = false }) { Text("关闭") }
        },
    )
}

/** §29 session-location facts: one line naming the Host, workspace, permission tier, and any
 * non-open connection state word; a second line publishes the runtime mode and full workspace path. */
@Composable
private fun SessionLocationFacts(model: CompanionViewModel) {
    val session = model.session.open.collectAsStateWithLifecycle().value ?: return
    val hosts by CompanionRuntime.hostState.collectAsStateWithLifecycle()
    val sessions by model.session.sessions.collectAsStateWithLifecycle()
    val preset by model.session.permissionPreset.collectAsStateWithLifecycle()
    val snapshot by model.session.connectionSnapshots.collectAsStateWithLifecycle()
    val cwd = sessions.firstOrNull { it.id == session.sessionId }?.cwd
    val segments = buildList {
        hosts.selected?.let { add(it.name.ifBlank { it.hostId }) }
        cwd?.let { add(workspaceBasename(it)) }
        preset?.let { add(permissionPresetLabel(it)) }
        sessionLocationStateWord(snapshot.state).takeIf { it.isNotEmpty() }?.let { add(it) }
    }
    if (segments.isEmpty()) return
    Text(segments.joinToString(" · "), Modifier.fillMaxWidth().padding(horizontal = 16.dp)
        .testTag("session-location-facts"), style = MaterialTheme.typography.bodySmall)
    if (cwd != null) Text(
        androidx.compose.ui.res.stringResource(R.string.native_session_location_runtime) + " · " + cwd,
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).testTag("session-location-detail"),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline,
    )
}

/** Last non-empty segment of a Host-side workspace directory; both separators are legal. */
private fun workspaceBasename(cwd: String): String = cwd.split('/', '\\').lastOrNull { it.isNotBlank() } ?: cwd

/** The §18-family follow-stream state word; the open state itself adds no word. */
@Composable
private fun sessionLocationStateWord(state: ConnectionState): String = when (state) {
    ConnectionState.OPEN -> ""
    ConnectionState.IDLE -> androidx.compose.ui.res.stringResource(R.string.native_connection_state_idle)
    ConnectionState.OPENING -> androidx.compose.ui.res.stringResource(R.string.native_connection_state_opening)
    ConnectionState.RECONNECTING -> androidx.compose.ui.res.stringResource(R.string.native_connection_state_reconnecting)
    ConnectionState.ENDED -> androidx.compose.ui.res.stringResource(R.string.native_connection_state_ended)
    ConnectionState.STOPPING -> androidx.compose.ui.res.stringResource(R.string.native_connection_state_stopping)
    ConnectionState.STOPPED -> androidx.compose.ui.res.stringResource(R.string.native_connection_state_stopped)
}

/** Built-in presets get their shared vocabulary word; host presets show their raw id. */
@Composable
private fun permissionPresetLabel(preset: String): String = when (preset) {
    "read-only" -> androidx.compose.ui.res.stringResource(R.string.native_permission_preset_read_only)
    "workspace-write" -> androidx.compose.ui.res.stringResource(R.string.native_permission_preset_workspace_write)
    "danger-full-access" -> androidx.compose.ui.res.stringResource(R.string.native_permission_preset_full_access)
    "custom" -> androidx.compose.ui.res.stringResource(R.string.native_permission_preset_custom)
    else -> preset
}

@Composable
private fun sessionListFailureText(failure: SessionListState.Failed): String {
    failure.refusal?.let { return GatewayFailurePresenter.present(it).text }
    return androidx.compose.ui.res.stringResource(when (failure.category) {
        ConnectionFailure.TRANSPORT -> R.string.native_sessions_transport_failed
        ConnectionFailure.INVALID_RESPONSE -> R.string.native_sessions_invalid_response
        ConnectionFailure.UNPAIRED -> R.string.native_sessions_pair_required
        ConnectionFailure.REFUSED, ConnectionFailure.CANCELLED, ConnectionFailure.INTERNAL -> R.string.native_sessions_failed
    })
}

@Composable
fun ApprovalsTab(model: CompanionViewModel) {
    LaunchedEffect(model.interactions) { model.interactions.startWatching() }
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
        items(inbox, key = { it.id }) { pending ->
            RaisedCard {
                Text(pending.title, style = MaterialTheme.typography.bodyLarge)
                if (pending.detail.isNotEmpty()) Text(pending.detail, style = MaterialTheme.typography.bodySmall)
                if (pending.kind == PendingInteraction.Kind.APPROVAL) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !answering && clientId.isNotEmpty(), onClick = { model.interactions.submitApproval(pending, allowedOnce = true) }) { Text("允许一次") }
                        Button(enabled = !answering && clientId.isNotEmpty(), onClick = { model.interactions.submitApproval(pending, allowedOnce = false) }) { Text("拒绝") }
                    }
                } else QuestionAnswers(pending, model.interactions, model.inputs)
            }
        }
    }
}

@Composable
private fun QuestionAnswers(pending: PendingInteraction, model: InteractionModel, inputs: CompanionInputState) {
    val answering by model.answering.collectAsStateWithLifecycle()
    val clientId by model.clientId.collectAsStateWithLifecycle()
    val input by model.input.collectAsStateWithLifecycle()
    val persistence by inputs.persistence.collectAsStateWithLifecycle()
    val editable = persistence != InputPersistenceStatus.RESTORE_FAILED
    val answers = input.answers[pending.questionDraftKey].orEmpty().associateBy { it.id }
    for (question in pending.questions) {
        val answer = answers[question.id] ?: CompanionQuestionAnswer(question.id, emptyList())
        Text(question.question, style = MaterialTheme.typography.titleSmall)
        question.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        for (option in question.options) {
            val selected = option.label in answer.selected
            val choose = {
                val selectedLabels = if (question.multiSelect)
                    (if (selected) answer.selected - option.label else answer.selected + option.label) else listOf(option.label)
                model.updateAnswer(pending, answer.copy(selected = selectedLabels, custom = if (question.multiSelect) answer.custom else null))
            }
            val choiceModifier = if (question.multiSelect)
                Modifier.toggleable(value = selected, enabled = editable, role = Role.Checkbox, onValueChange = { choose() })
            else Modifier.selectable(selected = selected, enabled = editable, role = Role.RadioButton, onClick = { choose() })
            Row(choiceModifier.fillMaxWidth()) {
                if (question.multiSelect) androidx.compose.material3.Checkbox(checked = selected, onCheckedChange = null)
                else androidx.compose.material3.RadioButton(selected = selected, onClick = null)
                Column(Modifier.weight(1f)) {
                    Text(option.label)
                    option.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        OutlinedTextField(value = answer.custom.orEmpty(), enabled = editable, onValueChange = { value ->
            model.updateAnswer(pending, answer.copy(custom = value,
                selected = if (!question.multiSelect && value.isNotBlank()) emptyList() else answer.selected))
        }, label = { Text(androidx.compose.ui.res.stringResource(R.string.native_answer_custom)) }, modifier = Modifier.fillMaxWidth())
    }
    Button(enabled = editable && !answering && clientId.isNotEmpty() && pending.questions.all {
        answers[it.id]?.let { answer -> answer.selected.isNotEmpty() || !answer.custom.isNullOrBlank() } == true
    },
        onClick = {
            model.submitQuestions(pending, pending.questions.map {
                answers.getValue(it.id)
            })
        }) { Text(androidx.compose.ui.res.stringResource(R.string.native_answer_submit)) }
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
fun FilesTab(model: CompanionViewModel, capabilities: Set<NativeCapability>?, saving: Boolean, save: (NativeResourceState) -> Unit, saveDownload: (NativeResourceTarget) -> Unit) {
    val canFollow = capabilities.supports(NativeCapability.WORKSPACE_FOLLOW)
    val canList = capabilities.supports(NativeCapability.FILE_LIST)
    val canReadText = capabilities.supports(NativeCapability.FILE_TEXT)
    val canReadBytes = capabilities.supports(NativeCapability.FILE_STAT) && capabilities.supports(NativeCapability.FILE_BYTES)
    val scope = rememberCoroutineScope()
    val directory by model.files.directory.collectAsStateWithLifecycle()
    val entries by model.files.entries.collectAsStateWithLifecycle()
    val selected by model.files.selectedSession.collectAsStateWithLifecycle()
    val openSession by model.session.open.collectAsStateWithLifecycle()
    val openFile by model.files.openFile.collectAsStateWithLifecycle()
    val openFileError by model.files.openFileError.collectAsStateWithLifecycle()
    val resource by model.files.resource.state.collectAsStateWithLifecycle()
    LaunchedEffect(model.files, model.paired, canFollow) { if (model.paired && canFollow) model.files.start() else model.files.stop() }
    LaunchedEffect(openSession?.sessionId) { openSession?.let { model.files.selectSession(it.sessionId) } }
    LaunchedEffect(model.files, model.paired, selected, canList, canFollow) { if (canList) model.files.list() }
    LaunchedEffect(model.files, canReadText, canReadBytes) {
        if (!canReadText && model.files.openFile.value != null || !canReadBytes && model.files.resource.state.value != null) model.files.closeFile()
    }
    val preview = resource
    if (preview != null && canReadBytes) {
        NativeResourcePreview(preview, model.files.resource::retry,
            { model.files.previewPath(preview.target.sessionId, preview.target.path) }, model.files::closeFile,
            save = { save(preview) }, saving = saving,
            download = { NativeDownloadControls(model.downloads, preview.target, saving) { saveDownload(preview.target) } })
        return
    }
    Column(Modifier.fillMaxSize()) {
        if (!canList || !canReadText && !canReadBytes) MissingNativeCapability(capabilities)
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canList) Button(onClick = {
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
        if (file != null && canReadText) {
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
        } else LazyColumn(Modifier.weight(1f).testTag("resource-file-list")) {
            items(if (canList) entries else emptyList()) { entry ->
                RaisedCard(Modifier.testTag("file-entry-${entry.name}")) {
                    Text(if (entry.isDirectory) "📁 ${entry.name}" else "📄 ${entry.name}")
                    if (entry.isDirectory) {
                        Button(onClick = { model.files.openEntry(entry.name); scope.launch { model.files.list() } }) { Text(androidx.compose.ui.res.stringResource(R.string.native_open_directory)) }
                    } else {
                        if (canReadText) Button(onClick = { scope.launch { model.files.readFile(entry.name) } },
                            modifier = Modifier.testTag("file-text-open-${entry.name}")) { Text("查看") }
                        if (canReadBytes) Button(onClick = { model.files.previewFile(entry.name) }, modifier = Modifier.testTag("resource-open-${entry.name}")) {
                            Text(androidx.compose.ui.res.stringResource(R.string.native_resource_preview))
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ArtifactsTab(model: CompanionViewModel, capabilities: Set<NativeCapability>?, saving: Boolean, save: (NativeResourceState) -> Unit, saveDownload: (NativeResourceTarget) -> Unit) {
    val canReadBytes = capabilities.supports(NativeCapability.FILE_STAT) && capabilities.supports(NativeCapability.FILE_BYTES)
    val open by model.session.open.collectAsStateWithLifecycle()
    val files by model.session.deliveredFiles.collectAsStateWithLifecycle()
    val resource by model.files.resource.state.collectAsStateWithLifecycle()
    LaunchedEffect(model.files, canReadBytes) { if (!canReadBytes && model.files.resource.state.value != null) model.files.closeFile() }
    val preview = resource
    if (canReadBytes && preview != null && preview.target.sessionId == open?.sessionId) {
        NativeResourcePreview(preview, model.files.resource::retry,
            { model.files.previewPath(preview.target.sessionId, preview.target.path) }, model.files::closeFile,
            save = { save(preview) }, saving = saving,
            download = { NativeDownloadControls(model.downloads, preview.target, saving) { saveDownload(preview.target) } })
        return
    }
    LazyColumn(Modifier.fillMaxSize().testTag("resource-delivery-list")) {
        if (!canReadBytes) item { MissingNativeCapability(capabilities) }
        if (files.isEmpty()) item { Text(androidx.compose.ui.res.stringResource(R.string.native_resource_no_deliveries), Modifier.padding(16.dp)) }
        items(files, key = { "${it.seq}:${it.index}" }) { file ->
            RaisedCard {
                Text(file.path, style = MaterialTheme.typography.bodyLarge)
                file.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                if (canReadBytes) Button(onClick = { open?.let { model.files.previewPath(it.sessionId, file.path) } },
                    modifier = Modifier.testTag("resource-delivery-${file.seq}-${file.index}")) {
                    Text(androidx.compose.ui.res.stringResource(R.string.native_resource_preview))
                }
            }
        }
    }
}

@Composable
fun SubagentsTab(model: CompanionViewModel, capabilities: Set<NativeCapability>?) {
    val canList = capabilities.supports(NativeCapability.SUBAGENT_CATALOG)
    val canFollow = capabilities.supports(NativeCapability.SESSION_FOLLOW)
    val scope = rememberCoroutineScope()
    val selected by model.session.open.collectAsStateWithLifecycle()
    val listing by model.subagents.listing.collectAsStateWithLifecycle()
    val child by model.subagents.childTimeline.collectAsStateWithLifecycle()
    val parent = selected?.sessionId
    val current = listing.takeIf { it.parentSessionId == parent }
    LaunchedEffect(model.subagents, parent, listing.parentSessionId, canList) {
        if (canList && parent != null && listing.parentSessionId == parent) model.subagents.refresh()
    }
    LaunchedEffect(model.subagents, canFollow) { if (!canFollow) model.subagents.closeChildAndAwait() }
    val view = child
    if (canFollow && view != null && view.parentSessionId == parent) {
        NativeSubagentTimeline(view) { scope.launch { model.subagents.closeChildAndAwait() } }
        return
    }
    LazyColumn(Modifier.fillMaxSize().testTag("native-subagent-list")) {
        item {
            Row(Modifier.fillMaxWidth().padding(16.dp)) {
                Text(androidx.compose.ui.res.stringResource(R.string.native_subagents_title), Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium)
                if (canList && parent != null) Button(enabled = current?.state != SubagentListState.Loading,
                    modifier = Modifier.testTag("native-subagent-refresh"), onClick = { scope.launch { model.subagents.refresh() } }) {
                    Text(androidx.compose.ui.res.stringResource(R.string.native_subagents_refresh))
                }
            }
        }
        if (parent == null) item {
            Text(androidx.compose.ui.res.stringResource(R.string.native_subagents_choose_parent),
                Modifier.padding(16.dp).testTag("native-subagent-no-parent"))
        }
        if (!canList) item { MissingNativeCapability(capabilities) }
        if (canList && parent != null) when (current?.state) {
            SubagentListState.Loading -> item { Text(androidx.compose.ui.res.stringResource(R.string.native_subagents_loading), Modifier.padding(16.dp)) }
            is SubagentListState.Failed -> item { Text(androidx.compose.ui.res.stringResource(R.string.native_subagents_failed),
                Modifier.padding(16.dp).testTag("native-subagent-list-error"), color = MaterialTheme.colorScheme.error) }
            SubagentListState.Ready -> if (current.rows.isEmpty()) item {
                Text(androidx.compose.ui.res.stringResource(R.string.native_subagents_empty), Modifier.padding(16.dp).testTag("native-subagent-empty"))
            }
            SubagentListState.Idle, null -> Unit
        }
        items(if (canList) current?.rows.orEmpty() else emptyList(), key = { it.id }) { row ->
            RaisedCard(Modifier.testTag("subagent-row-${row.id}")) {
                Text(row.label ?: row.id, style = MaterialTheme.typography.bodyLarge)
                val detail = when (row.reason) {
                    "corrupt" -> R.string.native_subagents_corrupt
                    "unsupported" -> R.string.native_subagents_unsupported
                    "unavailable" -> R.string.native_subagents_unavailable
                    else -> if (row.mode == "continuable") R.string.native_subagents_continuable else R.string.native_subagents_one_shot
                }
                Text(androidx.compose.ui.res.stringResource(detail), style = MaterialTheme.typography.bodySmall)
                if (canFollow && row.mode != null && parent != null) {
                    Button(modifier = Modifier.testTag("subagent-open-${row.id}"), onClick = {
                        scope.launch { model.subagents.openChild(parent, row.id) }
                    }) { Text(androidx.compose.ui.res.stringResource(R.string.native_subagents_open)) }
                }
            }
        }
    }
}
