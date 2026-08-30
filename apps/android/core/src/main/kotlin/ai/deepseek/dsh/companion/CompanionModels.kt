package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray

/** One session row in the list. */
data class SessionRow(val id: String, val title: String, val updatedAt: Double?)

/** The open session: its id and the folded domain state. */
data class OpenSession(val sessionId: String, val state: DomainState)

/** One forwarded interaction awaiting an answer. */
data class PendingInteraction(
    val id: String,
    val kind: Kind,
    val sessionId: String,
    val title: String,
    val detail: String,
) {
    enum class Kind { APPROVAL, QUESTION }
}

/** One workspace row from the registry follow. */
data class WorkspaceRow(val id: String, val title: String)

/** One workspace directory entry. */
data class FileEntry(val name: String, val isDirectory: Boolean, val size: Double?)

/** One text file open in the viewer: the decoded range so far, in UTF-16
 * units — the unit every read range speaks. */
data class OpenTextFile(
    val path: String,
    val mediaType: String,
    val text: String,
    val loadedUnits: Int,
    val totalUnits: Int,
    val hasMore: Boolean,
)

/** One subagent child row. */
data class SubagentRow(
    val id: String,
    val mode: String?,
    val label: String?,
    val activity: String?,
    val reason: String?,
)

/**
 * The session-slice state machine — the Kotlin mirror of the Swift
 * `RemoteSessionViewModel`: list sessions, open one, fold the follow
 * stream's snapshot and live events through the conformance-tested fold,
 * send prompts, cancel, and expose the plan/todo/goal and tool projections.
 * Every field the UI renders is a [StateFlow], so Compose recomposes on
 * each emission rather than re-reading on navigation.
 */
class SessionModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    private val _sessions = MutableStateFlow<List<SessionRow>>(emptyList())
    val sessions: StateFlow<List<SessionRow>> = _sessions

    private val _listState = MutableStateFlow("idle")
    val listState: StateFlow<String> = _listState

    private val _open = MutableStateFlow<OpenSession?>(null)
    val open: StateFlow<OpenSession?> = _open

    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending

    private var followJob: Job? = null

    /** The fold state of the open session, when one is. */
    val state: DomainState get() = _open.value?.state ?: DomainState()

    /** Load the session list through `session/list`. */
    suspend fun loadSessions() {
        _listState.value = "loading"
        try {
            val value = wire.call("session/list", mapOf("_request" to WireValue.ObjectValue(emptyMap())))
            _sessions.value = (WireShape.array(value, "items") ?: emptyList()).mapNotNull { row ->
                val id = WireShape.string(row, "sessionId") ?: return@mapNotNull null
                SessionRow(
                    id = id,
                    title = WireShape.string(row, "title") ?: "未命名会话",
                    updatedAt = WireShape.number(row, "updatedAt"),
                )
            }
            _listState.value = "ready"
        } catch (failure: Exception) {
            _listState.value = "failed:${failure.message}"
        }
    }

    /** Open one session: fold its follow stream from a fresh snapshot. */
    suspend fun openSession(sessionId: String) {
        followJob?.cancel()
        _open.value = OpenSession(sessionId, DomainState())
        followJob = follow(
            mapOf(
                "request" to WireValue.ObjectValue(
                    mapOf(
                        "address" to WireValue.ObjectValue(
                            mapOf("kind" to WireValue.StringValue("session"), "sessionId" to WireValue.StringValue(sessionId)),
                        ),
                    ),
                ),
            ),
        )
    }

    /** Open one subagent child's timeline read-only by durable address. */
    suspend fun openChild(parentSessionId: String, childSessionId: String, mode: String) {
        followJob?.cancel()
        _open.value = OpenSession(childSessionId, DomainState())
        followJob = follow(
            mapOf(
                "request" to WireValue.ObjectValue(
                    mapOf(
                        "address" to WireValue.ObjectValue(
                            mapOf(
                                "kind" to WireValue.StringValue("subagent"),
                                "parentSessionId" to WireValue.StringValue(parentSessionId),
                                "childSessionId" to WireValue.StringValue(childSessionId),
                                "mode" to WireValue.StringValue(mode),
                            ),
                        ),
                    ),
                ),
            ),
        )
    }

    fun close() {
        followJob?.cancel()
        followJob = null
        _open.value = null
    }

    /** Submit one user prompt in queue mode; the host promotes any inline
     * image bytes to durable references during admission. */
    suspend fun send(text: String, images: List<Pair<String, String>> = emptyList()) {
        val session = _open.value ?: return
        if (text.isEmpty() && images.isEmpty()) return
        _sending.value = true
        try {
            val content = buildList {
                add(WireValue.ObjectValue(mapOf("type" to WireValue.StringValue("text"), "text" to WireValue.StringValue(text))))
                for ((base64, mediaType) in images) {
                    add(
                        WireValue.ObjectValue(
                            mapOf(
                                "type" to WireValue.StringValue("image"),
                                "mediaType" to WireValue.StringValue(mediaType),
                                "data" to WireValue.StringValue(base64),
                            ),
                        ),
                    )
                }
            }
            wire.call(
                "session/prompt",
                mapOf(
                    "request" to WireValue.ObjectValue(
                        mapOf(
                            "requestId" to WireValue.StringValue("companion-${java.util.UUID.randomUUID()}"),
                            "sessionId" to WireValue.StringValue(session.sessionId),
                            "mode" to WireValue.StringValue("queue"),
                            "content" to WireValue.ArrayValue(content),
                        ),
                    ),
                ),
            )
        } finally {
            _sending.value = false
        }
    }

    /** Cancel the open session's in-flight work. */
    suspend fun cancelActive() {
        val session = _open.value ?: return
        wire.call(
            "session/cancel",
            mapOf("request" to WireValue.ObjectValue(mapOf("sessionId" to WireValue.StringValue(session.sessionId)))),
        )
    }

    private fun follow(payload: Map<String, WireValue>): Job = scope.launch {
        wire.stream("session/follow", payload)
            .catch { }
            .collect { frame -> foldFrame(frame) }
    }

    /** A snapshot generation resets and replays its records; any other
     * frame is one live event entry folded onto the current state. */
    private fun foldFrame(frame: WireValue) {
        val current = _open.value ?: return
        val kind = WireShape.string(frame, "type") ?: ""
        val newState = if (kind == "snapshot") {
            val records = WireShape.array(frame, "records") ?: emptyList()
            foldDomain(JsonArray(records.map { it.toJsonElement() }))
        } else {
            foldInto(current.state, JsonArray(listOf(frame.toJsonElement())))
        }
        _open.value = current.copy(state = newState)
    }
}

/**
 * The interaction inbox — the Kotlin mirror of the Swift
 * `InteractionViewModel`: watch `$events` for approval and question
 * forwards, deduplicate by event id, answer through `$events/result`.
 */
class InteractionModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    private val _inbox = MutableStateFlow<List<PendingInteraction>>(emptyList())
    val inbox: StateFlow<List<PendingInteraction>> = _inbox

    private val _answering = MutableStateFlow(false)
    val answering: StateFlow<Boolean> = _answering

    private var watchJob: Job? = null

    fun startWatching() {
        watchJob?.cancel()
        watchJob = scope.launch {
            wire.stream("\$events")
                .catch { }
                .collect { frame -> collect(frame) }
        }
    }

    fun stopWatching() {
        watchJob?.cancel()
        watchJob = null
    }

    fun collect(frame: WireValue) {
        val eventName = WireShape.string(frame, "event") ?: ""
        val isApproval = eventName.contains("approval")
        val isQuestion = eventName.contains("question")
        if (!isApproval && !isQuestion) return
        val id = WireShape.string(frame, "eventId") ?: return
        if (_inbox.value.any { it.id == id }) return
        _inbox.update { current ->
            current + PendingInteraction(
                id = id,
                kind = if (isApproval) PendingInteraction.Kind.APPROVAL else PendingInteraction.Kind.QUESTION,
                sessionId = WireShape.string(frame, "sessionId") ?: "",
                title = WireShape.string(frame, "title") ?: if (isApproval) "Approval requested" else "Question asked",
                detail = WireShape.string(frame, "text") ?: "",
            )
        }
    }

    /** Answer one pending interaction; success retires the card. */
    suspend fun answer(pending: PendingInteraction, allowedOnce: Boolean) {
        _answering.value = true
        try {
            wire.call(
                "\$events/result",
                mapOf(
                    "eventId" to WireValue.StringValue(pending.id),
                    "result" to WireValue.ObjectValue(
                        mapOf(
                            "kind" to WireValue.StringValue("result"),
                            "value" to WireValue.StringValue(if (allowedOnce) "allowed-once" else "rejected"),
                        ),
                    ),
                ),
            )
            _inbox.update { current -> current.filterNot { it.id == pending.id } }
        } finally {
            _answering.value = false
        }
    }
}

/**
 * The files browser — the Kotlin mirror of the Swift `FilesViewModel`:
 * follow the workspace registry for the picker, browse one workspace's
 * tree through `workspaceFiles/list`.
 */
class FilesModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    private val _workspaces = MutableStateFlow<List<WorkspaceRow>>(emptyList())
    val workspaces: StateFlow<List<WorkspaceRow>> = _workspaces

    private val _selectedWorkspace = MutableStateFlow<String?>(null)
    val selectedWorkspace: StateFlow<String?> = _selectedWorkspace

    private val _directory = MutableStateFlow<List<String>>(emptyList())
    val directory: StateFlow<List<String>> = _directory

    private val _entries = MutableStateFlow<List<FileEntry>>(emptyList())
    val entries: StateFlow<List<FileEntry>> = _entries

    private val _listState = MutableStateFlow("idle")
    val listState: StateFlow<String> = _listState

    private val _openFile = MutableStateFlow<OpenTextFile?>(null)
    val openFile: StateFlow<OpenTextFile?> = _openFile

    private val _openFileError = MutableStateFlow<String?>(null)
    val openFileError: StateFlow<String?> = _openFileError

    private var followJob: Job? = null

    fun start() {
        followJob?.cancel()
        followJob = scope.launch {
            wire.stream("workspace/follow")
                .catch { }
                .collect { frame ->
                    val records = WireShape.array(frame, "records") ?: return@collect
                    val rows = records.mapNotNull { record ->
                        val id = WireShape.string(record, "id") ?: return@mapNotNull null
                        WorkspaceRow(id = id, title = WireShape.string(record, "title") ?: id)
                    }
                    _workspaces.value = rows
                    if (_selectedWorkspace.value == null && rows.isNotEmpty()) _selectedWorkspace.value = rows[0].id
                }
        }
    }

    fun stop() {
        followJob?.cancel()
        followJob = null
    }

    fun select(workspaceId: String) {
        _selectedWorkspace.value = workspaceId
        _directory.value = emptyList()
    }

    /** List one directory level of the selected workspace. */
    suspend fun list() {
        val workspaceId = _selectedWorkspace.value ?: return
        _listState.value = "loading"
        try {
            val args = buildMap {
                put("workspaceId", WireValue.StringValue(workspaceId))
                if (_directory.value.isNotEmpty()) {
                    put("path", WireValue.StringValue(_directory.value.joinToString("/")))
                }
            }
            val value = wire.call("workspaceFiles/list", args)
            _entries.value = (WireShape.array(value, "entries") ?: emptyList()).mapNotNull { entry ->
                val name = WireShape.string(entry, "name") ?: return@mapNotNull null
                FileEntry(
                    name = name,
                    isDirectory = WireShape.string(entry, "type") == "directory",
                    size = WireShape.number(entry, "size"),
                )
            }
            _listState.value = "ready"
        } catch (failure: Exception) {
            _listState.value = "failed:${failure.message}"
        }
    }

    fun openEntry(name: String) {
        _entries.value.firstOrNull { it.name == name }?.takeIf { it.isDirectory } ?: return
        _directory.update { it + name }
    }

    /** Read one file as text, paging in UTF-16 units. A `file-too-large`
     * refusal means the host wants a bounded page: retry from the start
     * with one full page. */
    suspend fun readFile(name: String) {
        val workspaceId = _selectedWorkspace.value ?: return
        val path = (_directory.value + name).joinToString("/")
        _openFileError.value = null
        try {
            val first = readPage(workspaceId, path, offset = null, limit = null)
            applyReadValue(first, path)
        } catch (failure: ai.deepseek.dsh.link.LinkClientException.Refused) {
            if (failure.code != "file-too-large") {
                _openFileError.value = readFailureText(failure)
                return
            }
            try {
                val page = readPage(workspaceId, path, offset = 0, limit = PAGE_UNITS)
                applyReadValue(page, path)
            } catch (inner: ai.deepseek.dsh.link.LinkClientException.Refused) {
                _openFileError.value = readFailureText(inner)
            }
        }
    }

    /** Fetch the next page after the loaded prefix. */
    suspend fun loadMore() {
        val file = _openFile.value ?: return
        if (!file.hasMore) return
        val workspaceId = _selectedWorkspace.value ?: return
        try {
            val page = readPage(workspaceId, file.path, offset = file.loadedUnits, limit = PAGE_UNITS)
            _openFile.value = file.copy(
                text = file.text + page.content,
                loadedUnits = file.loadedUnits + page.content.length,
                hasMore = page.truncated,
            )
        } catch (failure: ai.deepseek.dsh.link.LinkClientException.Refused) {
            _openFileError.value = readFailureText(failure)
        }
    }

    fun closeFile() {
        _openFile.value = null
        _openFileError.value = null
    }

    private suspend fun readPage(workspaceId: String, path: String, offset: Int?, limit: Int?): ReadPage {
        val args = buildMap {
            put("workspaceId", WireValue.StringValue(workspaceId))
            put("path", WireValue.StringValue(path))
            if (offset != null) put("offset", WireValue.NumberValue(offset.toDouble()))
            if (limit != null) put("limit", WireValue.NumberValue(limit.toDouble()))
        }
        val value = wire.call("workspaceFiles/read", args)
        val entries = (value as? WireValue.ObjectValue)?.entries ?: emptyMap()
        return ReadPage(
            content = (entries["content"] as? WireValue.StringValue)?.value ?: "",
            truncated = (entries["truncated"] as? WireValue.BoolValue)?.value ?: false,
            size = (entries["size"] as? WireValue.NumberValue)?.value?.toInt() ?: 0,
            mediaType = (entries["mediaType"] as? WireValue.StringValue)?.value ?: "text/plain",
        )
    }

    private fun applyReadValue(page: ReadPage, path: String) {
        _openFile.value = OpenTextFile(
            path = path,
            mediaType = page.mediaType,
            text = page.content,
            loadedUnits = page.content.length,
            totalUnits = page.size,
            hasMore = page.truncated,
        )
    }

    private fun readFailureText(failure: ai.deepseek.dsh.link.LinkClientException.Refused): String = when (failure.code) {
        "file-binary" -> "二进制文件，无法文本预览"
        "file-not-found" -> "未找到该文件"
        "path-outside-root" -> "路径越出工作区根"
        "not-a-regular-file" -> "不是常规文件"
        else -> "读取失败：${failure.code}"
    }

    private data class ReadPage(val content: String, val truncated: Boolean, val size: Int, val mediaType: String)

    private companion object {
        /** One page: 65536 UTF-16 units, the Swift viewer's page size. */
        const val PAGE_UNITS = 65536
    }

    fun goUp() {
        _directory.update { if (it.isNotEmpty()) it.dropLast(1) else it }
    }
}

/**
 * The subagent surface — the Kotlin mirror of the Swift
 * `SubagentsViewModel`: list one parent's direct children, open a child's
 * timeline read-only.
 */
class SubagentsModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    private val _rows = MutableStateFlow<List<SubagentRow>>(emptyList())
    val rows: StateFlow<List<SubagentRow>> = _rows

    private val _listState = MutableStateFlow("idle")
    val listState: StateFlow<String> = _listState

    /** The open child timeline, when one is. */
    private val _childTimeline = MutableStateFlow<SessionModel?>(null)
    val childTimeline: StateFlow<SessionModel?> = _childTimeline

    suspend fun load(parentSessionId: String) {
        _listState.value = "loading"
        try {
            val value = wire.call("subagents/list", mapOf("parentSessionId" to WireValue.StringValue(parentSessionId)))
            _rows.value = (WireShape.array(value, "entries") ?: emptyList()).mapNotNull { entry ->
                val id = WireShape.string(entry, "id") ?: return@mapNotNull null
                SubagentRow(
                    id = id,
                    mode = WireShape.string(entry, "mode"),
                    label = WireShape.string(entry, "label"),
                    activity = WireShape.string(entry, "activity"),
                    reason = WireShape.string(entry, "reason"),
                )
            }
            _listState.value = "ready"
        } catch (failure: Exception) {
            _listState.value = "failed:${failure.message}"
        }
    }

    /** Open one child's read-only timeline; a diagnostic row has no mode
     * and no timeline to open. */
    suspend fun openChild(parentSessionId: String, row: SubagentRow) {
        val mode = row.mode ?: return
        val child = SessionModel(wire, scope)
        _childTimeline.value = child
        child.openChild(parentSessionId = parentSessionId, childSessionId = row.id, mode = mode)
    }

    fun closeChild() {
        _childTimeline.value?.close()
        _childTimeline.value = null
    }
}
