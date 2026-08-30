package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
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
 */
class SessionModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    var sessions: List<SessionRow> = emptyList()
        private set

    var listState: String = "idle"
        private set

    var open: OpenSession? = null
        private set

    var sending = false
        private set

    private var followJob: Job? = null

    /** The fold state of the open session, when one is. */
    val state: DomainState get() = open?.state ?: DomainState()

    fun planTodoGoal(): DomainState = state

    /** Load the session list through `session/list`. */
    suspend fun loadSessions() {
        listState = "loading"
        try {
            val value = wire.call("session/list", mapOf("_request" to WireValue.ObjectValue(emptyMap())))
            sessions = (WireShape.array(value, "items") ?: emptyList()).mapNotNull { row ->
                val id = WireShape.string(row, "sessionId") ?: return@mapNotNull null
                SessionRow(
                    id = id,
                    title = WireShape.string(row, "title") ?: "未命名会话",
                    updatedAt = WireShape.number(row, "updatedAt"),
                )
            }
            listState = "ready"
        } catch (failure: Exception) {
            listState = "failed:${failure.message}"
        }
    }

    /** Open one session: fold its follow stream from a fresh snapshot. */
    suspend fun openSession(sessionId: String) {
        followJob?.cancel()
        open = OpenSession(sessionId, DomainState())
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
        open = OpenSession(childSessionId, DomainState())
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
        open = null
    }

    /** Submit one user prompt in queue mode; the host promotes any inline
     * image bytes to durable references during admission. */
    suspend fun send(text: String, images: List<Pair<String, String>> = emptyList()) {
        val session = open ?: return
        if (text.isEmpty() && images.isEmpty()) return
        sending = true
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
            sending = false
        }
    }

    /** Cancel the open session's in-flight work. */
    suspend fun cancelActive() {
        val session = open ?: return
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
     * frame is one live event entry. */
    private fun foldFrame(frame: WireValue) {
        val current = open ?: return
        val kind = WireShape.string(frame, "type") ?: ""
        val newState = if (kind == "snapshot") {
            val records = WireShape.array(frame, "records") ?: emptyList()
            foldDomain(JsonArray(records.map { it.toJsonElement() }))
        } else {
            foldInto(current.state, JsonArray(listOf(frame.toJsonElement())))
        }
        open = current.copy(state = newState)
    }
}

/**
 * The interaction inbox — the Kotlin mirror of the Swift
 * `InteractionViewModel`: watch `$events` for approval and question
 * forwards, deduplicate by event id, answer through `$events/result`.
 */
class InteractionModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    val inbox = mutableListOf<PendingInteraction>()

    var answering = false
        private set

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
        if (inbox.any { it.id == id }) return
        inbox.add(
            PendingInteraction(
                id = id,
                kind = if (isApproval) PendingInteraction.Kind.APPROVAL else PendingInteraction.Kind.QUESTION,
                sessionId = WireShape.string(frame, "sessionId") ?: "",
                title = WireShape.string(frame, "title") ?: if (isApproval) "Approval requested" else "Question asked",
                detail = WireShape.string(frame, "text") ?: "",
            ),
        )
    }

    /** Answer one pending interaction; success retires the card. */
    suspend fun answer(pending: PendingInteraction, allowedOnce: Boolean) {
        answering = true
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
            inbox.removeAll { it.id == pending.id }
        } finally {
            answering = false
        }
    }
}

/**
 * The files browser — the Kotlin mirror of the Swift `FilesViewModel`:
 * follow the workspace registry for the picker, browse one workspace's
 * tree through `workspaceFiles/list`.
 */
class FilesModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    var workspaces: List<WorkspaceRow> = emptyList()
        private set

    var selectedWorkspace: String? = null
        private set

    var directory: List<String> = emptyList()
        private set

    var entries: List<FileEntry> = emptyList()
        private set

    var listState: String = "idle"
        private set

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
                    workspaces = rows
                    if (selectedWorkspace == null && rows.isNotEmpty()) selectedWorkspace = rows[0].id
                }
        }
    }

    fun stop() {
        followJob?.cancel()
        followJob = null
    }

    fun select(workspaceId: String) {
        selectedWorkspace = workspaceId
        directory = emptyList()
    }

    /** List one directory level of the selected workspace. */
    suspend fun list() {
        val workspaceId = selectedWorkspace ?: return
        listState = "loading"
        try {
            val args = buildMap {
                put("workspaceId", WireValue.StringValue(workspaceId))
                if (directory.isNotEmpty()) {
                    put("path", WireValue.StringValue(directory.joinToString("/")))
                }
            }
            val value = wire.call("workspaceFiles/list", args)
            entries = (WireShape.array(value, "entries") ?: emptyList()).mapNotNull { entry ->
                val name = WireShape.string(entry, "name") ?: return@mapNotNull null
                FileEntry(
                    name = name,
                    isDirectory = WireShape.string(entry, "type") == "directory",
                    size = WireShape.number(entry, "size"),
                )
            }
            listState = "ready"
        } catch (failure: Exception) {
            listState = "failed:${failure.message}"
        }
    }

    fun openEntry(name: String) {
        entries.firstOrNull { it.name == name }?.takeIf { it.isDirectory } ?: return
        directory = directory + name
    }

    fun goUp() {
        if (directory.isNotEmpty()) directory = directory.dropLast(1)
    }
}

/**
 * The subagent surface — the Kotlin mirror of the Swift
 * `SubagentsViewModel`: list one parent's direct children, open a child's
 * timeline read-only.
 */
class SubagentsModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    var rows: List<SubagentRow> = emptyList()
        private set

    var listState: String = "idle"
        private set

    /** The open child timeline, when one is. */
    var childTimeline: SessionModel? = null
        private set

    suspend fun load(parentSessionId: String) {
        listState = "loading"
        try {
            val value = wire.call("subagents/list", mapOf("parentSessionId" to WireValue.StringValue(parentSessionId)))
            rows = (WireShape.array(value, "entries") ?: emptyList()).mapNotNull { entry ->
                val id = WireShape.string(entry, "id") ?: return@mapNotNull null
                SubagentRow(
                    id = id,
                    mode = WireShape.string(entry, "mode"),
                    label = WireShape.string(entry, "label"),
                    activity = WireShape.string(entry, "activity"),
                    reason = WireShape.string(entry, "reason"),
                )
            }
            listState = "ready"
        } catch (failure: Exception) {
            listState = "failed:${failure.message}"
        }
    }

    /** Open one child's read-only timeline; a diagnostic row has no mode
     * and no timeline to open. */
    suspend fun openChild(parentSessionId: String, row: SubagentRow) {
        val mode = row.mode ?: return
        val child = SessionModel(wire, scope)
        childTimeline = child
        child.openChild(parentSessionId = parentSessionId, childSessionId = row.id, mode = mode)
    }

    fun closeChild() {
        childTimeline?.close()
        childTimeline = null
    }
}
