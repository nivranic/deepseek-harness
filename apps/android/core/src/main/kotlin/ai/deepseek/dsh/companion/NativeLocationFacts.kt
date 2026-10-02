package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue

/** §29 session-location facts as shared derivation rules: which facts a Session
 * exposes (Host, workspace, permission preset, online state) and how each derives
 * from wire data. The Apple contract mirrors these rules
 * (apps/apple/contract/Sources/DSHContract/NativeLocationFacts.swift) over shared
 * fixtures; the Kotlin implementation is the authority. Locale words stay
 * client-owned — this object speaks identifiers. */
object NativeLocationFacts {
    /** Presented Host name: the roster entry's name when non-blank, else its hostId; no entry adds no fact. */
    fun presentedHostName(name: String?, hostId: String?): String? = when {
        hostId == null -> null
        name.isNullOrBlank() -> hostId
        else -> name
    }

    /** Last non-empty segment of a Host-side workspace directory; both separators are legal. */
    fun workspaceBasename(cwd: String): String = cwd.split('/', '\\').lastOrNull { it.isNotBlank() } ?: cwd

    /** Newest `permission/preset` in a record batch; a matching event without a string preset keeps the earlier value. */
    fun latestPreset(records: List<WireValue>): String? {
        var preset: String? = null
        for (record in records) {
            val event = WireShape.objectValue(record, "event") ?: continue
            if (WireShape.string(event, "type") != "permission/preset") continue
            val data = WireShape.objectValue(event, "data") ?: continue
            WireShape.string(data, "preset")?.let { preset = it }
        }
        return preset
    }

    /** The follow-stream online-state word: the open state adds none, the six §18-family words name themselves, unknown words drop. */
    fun stateWord(state: String?): String? = when (state) {
        "idle", "opening", "reconnecting", "ended", "stopping", "stopped" -> state
        else -> null
    }

    /** The one-line facts, present identifiers only: Host, workspace basename, preset, non-open state word. */
    fun factsLine(hostName: String?, cwd: String?, preset: String?, state: String?): List<String> = buildList {
        hostName?.let { add(it) }
        cwd?.let { add(workspaceBasename(it)) }
        preset?.let { add(it) }
        stateWord(state)?.let { add(it) }
    }

    /** The detail line exists only with a workspace: the protocol-fixed full runtime word plus the whole path. */
    fun detailLine(cwd: String?): String? = cwd?.let { "full · $it" }
}
