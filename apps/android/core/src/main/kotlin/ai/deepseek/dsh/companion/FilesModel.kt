package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import java.util.concurrent.atomic.AtomicLong

/** Workspace observations and Session-scoped file reads over the current Gateway.
 * A Workspace id never grants file access: the selected Session determines the Host filesystem scope.
 * Selection generations discard late directory/file replies, and file versions prevent mixing changed pages.
 */
class FilesModel(
    private val wire: WireDriving,
    private val scope: CoroutineScope,
    private val reconnectDelayMillis: Long = 1000,
) {
    init { require(reconnectDelayMillis > 0) }
    private val _workspaces = MutableStateFlow<List<WorkspaceRow>>(emptyList())
    val workspaces: StateFlow<List<WorkspaceRow>> = _workspaces
    private val _selectedWorkspace = MutableStateFlow<String?>(null)
    val selectedWorkspace: StateFlow<String?> = _selectedWorkspace
    private val _selectedSession = MutableStateFlow<String?>(null)
    val selectedSession: StateFlow<String?> = _selectedSession
    private var explicitSessionSelection = false
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
    private val viewGeneration = AtomicLong()
    private val listGeneration = AtomicLong()
    private val fileGeneration = AtomicLong()
    private val followOwner = StreamTransitionOwner(scope)
    val connectionSnapshot: ConnectionSnapshot get() = followOwner.connectionSnapshot

    fun start() = followOwner.replaceAsync(create = { generation -> follow(generation) }, publish = {}, invalidate = {})

    private fun follow(generation: Long): Job = scope.launch(start = CoroutineStart.LAZY) {
        while (isActive && followOwner.isCurrent(generation)) {
            followOwner.attempt(generation)
            var baseline = false
            try {
                wire.stream("workspace/follow").collect { frame ->
                    if (!followOwner.isCurrent(generation)) return@collect
                    val type = WireShape.string(frame, "type") ?: malformed("workspace frame")
                    if (!baseline && type != "baseline") malformed("workspace baseline missing")
                    collectWorkspace(frame)
                    baseline = true
                    followOwner.received(generation)
                }
                followOwner.interrupted(generation, null)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                followOwner.interrupted(generation, error)
                if (error is LinkClientException.BadWire) return@launch
                if (error is LinkClientException.Refused) {
                    val classified = GatewayFailurePresenter.present(GatewayFailureEnvelope.from(error)).failureClass
                    if (classified !in setOf(ai.deepseek.dsh.contract.RemoteFailureClass.TRANSPORT,
                            ai.deepseek.dsh.contract.RemoteFailureClass.HOST_STATE)) return@launch
                }
            }
            if (isActive && followOwner.isCurrent(generation)) { followOwner.retrying(generation); delay(reconnectDelayMillis) }
        }
    }

    private fun collectWorkspace(frame: WireValue) {
        when (WireShape.string(frame, "type")) {
            "baseline" -> {
                val value = WireShape.objectValue(frame, "value") ?: malformed("workspace baseline")
                _workspaces.value = (WireShape.array(value, "items") ?: malformed("workspace items")).map(::workspace)
            }
            "upsert" -> {
                val row = workspace(WireShape.objectValue(frame, "workspace") ?: malformed("workspace upsert"))
                _workspaces.update { rows -> if (rows.any { it.id == row.id }) rows.map { if (it.id == row.id) row else it } else rows + row }
            }
            "remove" -> {
                val id = WireShape.string(frame, "workspaceId") ?: malformed("workspace removal")
                _workspaces.update { rows -> rows.filterNot { it.id == id } }
            }
            "order" -> {
                val ids = (WireShape.array(frame, "workspaceIds") ?: malformed("workspace order")).map {
                    (it as? WireValue.StringValue)?.value ?: malformed("workspace id")
                }
                val byId = _workspaces.value.associateBy { it.id }
                if (ids.toSet().size != ids.size || ids.toSet() != byId.keys) malformed("incomplete workspace order")
                _workspaces.value = ids.map { byId.getValue(it) }
            }
            "archived" -> Unit
            else -> malformed("unknown workspace frame")
        }
        if (explicitSessionSelection) {
            _selectedWorkspace.value = _workspaces.value.firstOrNull { _selectedSession.value in it.sessionIds }?.id
            return
        }
        val current = _selectedWorkspace.value
        if (current == null || _workspaces.value.none { it.id == current }) {
            select(_workspaces.value.firstOrNull()?.id)
        } else if (_selectedSession.value !in _workspaces.value.first { it.id == current }.sessionIds) {
            select(current)
        }
    }

    private fun workspace(value: WireValue): WorkspaceRow {
        val id = WireShape.string(value, "workspaceId")?.takeIf(String::isNotBlank) ?: malformed("workspace identity")
        val ids = (WireShape.array(value, "sessionIds") ?: malformed("workspace sessions")).map {
            (it as? WireValue.StringValue)?.value?.takeIf(String::isNotBlank) ?: malformed("session identity")
        }
        return WorkspaceRow(id, WireShape.string(value, "title") ?: malformed("workspace title"), ids)
    }

    fun stop() { followOwner.stop {}; clearView() }
    suspend fun stopAndAwait() { followOwner.stopAndAwait {}; clearView() }

    /** Select only an observed Workspace; file scope is one of its recorded Session identities. */
    fun select(workspaceId: String?) {
        val row = _workspaces.value.firstOrNull { it.id == workspaceId }
        explicitSessionSelection = false
        _selectedWorkspace.value = row?.id
        assignSession(row?.sessionIds?.firstOrNull())
    }

    /** Use the application-selected Session. Host lookup remains authoritative for its filesystem access. */
    fun selectSession(sessionId: String?) {
        explicitSessionSelection = sessionId != null
        _selectedWorkspace.value = _workspaces.value.firstOrNull { sessionId in it.sessionIds }?.id
        assignSession(sessionId)
    }

    private fun assignSession(sessionId: String?) {
        if (_selectedSession.value == sessionId) return
        _selectedSession.value = sessionId
        clearView()
    }

    private fun clearView() {
        viewGeneration.incrementAndGet()
        _directory.value = emptyList()
        _entries.value = emptyList()
        _listState.value = "idle"
        closeFile()
    }

    suspend fun list() {
        val session = _selectedSession.value ?: return
        val generation = viewGeneration.get()
        val request = listGeneration.incrementAndGet()
        _listState.value = "loading"
        try {
            val value = wire.call("workspaceFiles/list", mapOf("workspaceFileScopeId" to WireValue.StringValue(session),
                "path" to WireValue.StringValue(_directory.value.joinToString("/").ifEmpty { "." })))
            val entries = (WireShape.array(value, "entries") ?: malformed("directory entries")).map { entry ->
                val name = WireShape.string(entry, "name") ?: malformed("directory entry name")
                val type = WireShape.string(entry, "type") ?: malformed("directory entry type")
                FileEntry(name, type == "directory", WireShape.number(entry, "size"))
            }
            if (generation != viewGeneration.get() || request != listGeneration.get()) return
            _entries.value = entries
            _listState.value = "ready"
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            if (generation == viewGeneration.get() && request == listGeneration.get()) _listState.value = "failed:${error.message}"
        }
    }

    fun openEntry(name: String) {
        if (_entries.value.none { it.name == name && it.isDirectory }) return
        changeDirectory(_directory.value + name)
    }

    fun goUp() { changeDirectory(_directory.value.dropLast(1)) }

    private fun changeDirectory(next: List<String>) {
        viewGeneration.incrementAndGet()
        _directory.value = next
        _entries.value = emptyList()
        _listState.value = "idle"
        closeFile()
    }

    suspend fun readFile(name: String) {
        val session = _selectedSession.value ?: return
        val path = (_directory.value + name).joinToString("/")
        val generation = viewGeneration.get()
        val request = fileGeneration.incrementAndGet()
        _openFile.value = null
        _openFileError.value = null
        try {
            val page = readPage(session, path, 1)
            if (generation == viewGeneration.get() && request == fileGeneration.get()) {
                _openFile.value = OpenTextFile(path, "text/plain", page.text, page.lines, page.bytes, page.version, !page.eof)
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            if (generation == viewGeneration.get() && request == fileGeneration.get()) _openFileError.value = failureText(error)
        }
    }

    suspend fun loadMore() {
        val file = _openFile.value?.takeIf { it.hasMore } ?: return
        val session = _selectedSession.value ?: return
        val generation = viewGeneration.get()
        val request = fileGeneration.incrementAndGet()
        try {
            val page = readPage(session, file.path, file.loadedLines + 1)
            if (generation != viewGeneration.get() || request != fileGeneration.get()) return
            if (file.version != page.version) throw LinkClientException.BadWire("file changed; reopen it before reading more")
            val separator = if (file.loadedLines > 0 && page.lines > 0) "\n" else ""
            _openFile.value = file.copy(text = file.text + separator + page.text,
                loadedLines = file.loadedLines + page.lines, hasMore = !page.eof)
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            if (generation == viewGeneration.get() && request == fileGeneration.get()) _openFileError.value = failureText(error)
        }
    }

    fun closeFile() { fileGeneration.incrementAndGet(); _openFile.value = null; _openFileError.value = null }

    private data class Page(val text: String, val lines: Int, val eof: Boolean, val version: String, val bytes: Long?)

    private suspend fun readPage(session: String, path: String, offset: Int): Page {
        val value = wire.call("workspaceFiles/read", mapOf("workspaceFileScopeId" to WireValue.StringValue(session),
            "path" to WireValue.StringValue(path), "range" to WireValue.ObjectValue(mapOf("offset" to WireValue.NumberValue(offset.toDouble())))))
        val returnedOffset = WireShape.number(value, "offset") ?: malformed("file offset")
        val lines = WireShape.number(value, "lines") ?: malformed("file line count")
        val eof = WireShape.boolean(value, "eof") ?: malformed("file EOF")
        val version = WireShape.string(value, "version")?.takeIf(String::isNotBlank) ?: malformed("file version")
        if (returnedOffset != offset.toDouble() || lines < 0 || lines > Int.MAX_VALUE || lines % 1.0 != 0.0 || !eof && lines == 0.0) {
            malformed("file page progress")
        }
        val bytes = WireShape.number(value, "bytes")
        if (bytes != null && (bytes < 0 || bytes > 9_007_199_254_740_991.0 || bytes % 1.0 != 0.0)) malformed("file byte size")
        return Page(WireShape.string(value, "text") ?: malformed("file text"), lines.toInt(), eof, version, bytes?.toLong())
    }

    private fun failureText(error: Exception): String = if (error is LinkClientException.Refused)
        GatewayFailurePresenter.present(GatewayFailureEnvelope.from(error)).text else error.message ?: "file read failed"

    private fun malformed(field: String): Nothing = throw LinkClientException.BadWire("invalid $field")
}
