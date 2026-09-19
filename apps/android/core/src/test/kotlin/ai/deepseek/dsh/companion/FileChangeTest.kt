package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** Escape one JSON string value for embedding as the `arguments` payload. */
private fun jsonEscape(text: String): String =
    text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")

private fun wireOf(json: String): WireValue =
    WireValue.fromJsonElement(kotlinx.serialization.json.Json.parseToJsonElement(json))

private fun toolCallEvent(seq: Int, callId: String, name: String, arguments: String): WireValue =
    wireOf(
        """{"type":"event","event":{"type":"tool/call","seq":$seq,"time":1759017600000,"data":{"turn":1,"step":1,"callId":"$callId","name":"$name","arguments":"${jsonEscape(arguments)}"}}}""",
    )

private fun toolResultEvent(seq: Int, callId: String, failed: Boolean = false): WireValue {
    val error = if (failed) ""","error":{"name":"ToolError"}""" else ""
    return wireOf(
        """{"type":"event","event":{"type":"tool/result","seq":$seq,"time":1759017600000,"data":{"turn":1,"step":1,"message":{"id":"m-$callId","role":"user","content":[{"type":"tool-result","toolCallId":"$callId","content":[{"type":"text","text":"完成"}]}],"source":{"kind":"tool","callId":"$callId"}}$error}}}""",
    )
}

/** The chapter-55 read-only diff projection over a folded trajectory. */
class FileChangeTest {
    @Test
    fun projectsCompletedFileWritesAndSkipsEverythingElse() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.openSession("s1")
        wire.emit(wireOf("""{"type":"snapshot","cursor":0,"records":[]}"""))
        wire.emit(toolCallEvent(1, "c1", "write", """{"file_path":"notes.md","content":"第一行\n第二行\n"}"""))
        wire.emit(toolResultEvent(2, "c1"))
        wire.emit(toolCallEvent(3, "c2", "edit", """{"file_path":"notes.md","old_string":"第二行","new_string":"第二行（改）"}"""))
        wire.emit(toolResultEvent(4, "c2"))
        wire.emit(toolCallEvent(5, "c3", "str_replace_editor", """{"path":"Config.swift","command":"insert","insert_line":4,"new_str":"插入"}"""))
        wire.emit(toolResultEvent(6, "c3"))
        wire.emit(toolCallEvent(7, "c4", "str_replace_editor", """{"path":"notes.md","command":"view","view_range":[1,20]}"""))
        wire.emit(toolResultEvent(8, "c4"))
        wire.emit(toolCallEvent(9, "c5", "write", """{"file_path":"app.log","content":"日志"}"""))
        wire.emit(toolResultEvent(10, "c5", failed = true))
        wire.emit(toolCallEvent(11, "c6", "bash", """{"command":"ls"}"""))
        wire.emit(toolResultEvent(12, "c6"))
        wire.emit(toolCallEvent(13, "c7", "write", "不是 JSON"))
        wire.emit(toolResultEvent(14, "c7"))
        wire.emit(toolCallEvent(15, "c8", "edit", """{"file_path":"notes.md","old_string":"第二行","new_string":"路上"}"""))
        advanceUntilIdle()

        assertEquals(
            listOf(
                FileChange(
                    path = "notes.md",
                    added = 2,
                    removed = 0,
                    lines = listOf(DiffLine(added = true, text = "第一行"), DiffLine(added = true, text = "第二行")),
                ),
                FileChange(
                    path = "notes.md",
                    added = 1,
                    removed = 1,
                    lines = listOf(DiffLine(added = false, text = "第二行"), DiffLine(added = true, text = "第二行（改）")),
                ),
                FileChange(
                    path = "Config.swift",
                    added = 1,
                    removed = 0,
                    lines = listOf(DiffLine(added = true, text = "插入")),
                ),
            ),
            fileChanges(model.state.toolCalls),
        )
    }

    @Test
    fun anEmptyWriteProjectsAZeroLineChangeAndAStrReplacePairsOldWithNew() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.openSession("s1")
        wire.emit(wireOf("""{"type":"snapshot","cursor":0,"records":[]}"""))
        wire.emit(toolCallEvent(1, "c1", "write", """{"file_path":"empty.txt","content":""}"""))
        wire.emit(toolResultEvent(2, "c1"))
        wire.emit(
            toolCallEvent(
                3, "c2", "str_replace_editor",
                """{"path":"Main.kt","command":"str_replace","old_str":"旧一行\n旧二行","new_str":"新一行"}""",
            ),
        )
        wire.emit(toolResultEvent(4, "c2"))
        advanceUntilIdle()

        assertEquals(
            listOf(
                FileChange(path = "empty.txt", added = 0, removed = 0, lines = emptyList()),
                FileChange(
                    path = "Main.kt",
                    added = 1,
                    removed = 2,
                    lines = listOf(
                        DiffLine(added = false, text = "旧一行"),
                        DiffLine(added = false, text = "旧二行"),
                        DiffLine(added = true, text = "新一行"),
                    ),
                ),
            ),
            fileChanges(model.state.toolCalls),
        )
    }
}
