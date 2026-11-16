package ai.deepseek.dsh.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** One hunk line of a projected change: added lines arrived with the call,
 * removed lines are what it replaced. */
data class DiffLine(val added: Boolean, val text: String)

/** One read-only file change projected from a completed file-writing tool
 * call — the chapter-55 first-version review surface: one hunk per call,
 * counts first, no merging across calls. */
data class FileChange(
    val path: String,
    val added: Int,
    val removed: Int,
    val lines: List<DiffLine>,
)

/** Split text into diff lines: a single trailing newline opens no last
 * empty line; empty text has none. */
internal fun splitDiffLines(text: String): List<String> {
    if (text.isEmpty()) return emptyList()
    val body = if (text.endsWith("\n")) text.dropLast(1) else text
    return body.split("\n")
}

/** Project the trajectory's completed file-writing calls into read-only
 * changes in call order. Unknown tools, the read-only `view` command,
 * calls that never completed, and unparseable or non-object arguments
 * contribute nothing — a failed write changed no file.
 * @param toolCalls the folded tool trajectory, paired by `callId`.
 * @return the projected changes, one entry per contributing call.
 */
fun fileChanges(toolCalls: List<FoldToolCall>): List<FileChange> = toolCalls.mapNotNull(::changeForCall)

private fun changeForCall(call: FoldToolCall): FileChange? {
    if (call.phase != "completed") return null
    val args = parseArguments(call.arguments) ?: return null
    fun field(name: String): String? = args.stringField(name)
    return when (call.name) {
        "write" -> buildChange(path = field("file_path"), removedText = null, addedText = field("content"))
        "edit" -> buildChange(path = field("file_path"), removedText = field("old_string"), addedText = field("new_string"))
        "str_replace_editor" -> when (field("command")) {
            "create" -> buildChange(path = field("path"), removedText = null, addedText = field("file_text"))
            "str_replace" -> buildChange(path = field("path"), removedText = field("old_str"), addedText = field("new_str"))
            "insert" -> buildChange(path = field("path"), removedText = null, addedText = field("new_str"))
            else -> null
        }
        else -> null
    }
}

/** Decode the call's argument JSON. The trajectory is a model/tool JSON
 * boundary, so a malformed or non-object payload is an absent referent —
 * skipped, never a crash; nothing else can reach this catch. */
private fun parseArguments(arguments: String): JsonObject? =
    runCatching { Json.parseToJsonElement(arguments) as? JsonObject }.getOrNull()

private fun JsonObject.stringField(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun buildChange(path: String?, removedText: String?, addedText: String?): FileChange? {
    if (path.isNullOrEmpty()) return null
    if (removedText == null && addedText == null) return null
    val removed = removedText?.let(::splitDiffLines) ?: emptyList()
    val added = splitDiffLines(addedText ?: "")
    return FileChange(
        path = path,
        added = added.size,
        removed = removed.size,
        lines = removed.map { DiffLine(added = false, text = it) } + added.map { DiffLine(added = true, text = it) },
    )
}
