package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NativeFilesModelTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))

    @Test fun `root directory requests use a nonempty Session-relative path`() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/list") {
            value("""{"path":"","entries":[],"truncated":false}""")
        }
        val model = FilesModel(wire, backgroundScope)
        model.selectSession("s1")
        model.list()
        val args = wire.calls.single().second
        assertEquals(WireValue.StringValue("."), args["path"])
        assertEquals(WireValue.StringValue("s1"), args["workspaceFileScopeId"])
        assertEquals("ready", model.listState.value)
    }

    @Test fun `workspace baseline and increments keep ordered rows and Session scopes`() = runTest {
        val wire = FakeWire()
        val model = FilesModel(wire, backgroundScope)
        model.start(); runCurrent()
        wire.emit(value("""{"type":"baseline","value":{"items":[{"workspaceId":"w1","title":"One","sessionIds":["s1"]}],"archivedSessionIds":[]}}"""))
        runCurrent()
        assertEquals("s1", model.selectedSession.value)
        wire.emit(value("""{"type":"upsert","workspace":{"workspaceId":"w2","title":"Two","sessionIds":["s2"]}}"""))
        wire.emit(value("""{"type":"order","workspaceIds":["w2","w1"]}"""))
        runCurrent()
        assertEquals(listOf("w2", "w1"), model.workspaces.value.map { it.id })
        model.select("w2")
        assertEquals("s2", model.selectedSession.value)
        wire.emit(value("""{"type":"remove","workspaceId":"w2"}""")); runCurrent()
        assertEquals(listOf("w1"), model.workspaces.value.map { it.id })
        assertEquals("s1", model.selectedSession.value)
        model.stopAndAwait()
    }

    @Test fun `old Session directory results cannot replace a new selection`() = runTest {
        val pending = CompletableDeferred<WireValue>()
        val wire = FakeWire()
        wire.stub("workspaceFiles/list") { pending.await() }
        val model = FilesModel(wire, backgroundScope)
        model.selectSession("old-session")
        val list = async { model.list() }
        runCurrent()
        model.selectSession("new-session")
        pending.complete(value("""{"path":"","entries":[{"name":"old.txt","type":"file"}]}"""))
        list.await()
        assertTrue(model.entries.value.isEmpty())
        assertEquals("idle", model.listState.value)
    }

    @Test fun `nonterminal pages must make forward progress`() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/read") { value("""{"offset":1,"text":"","lines":0,"eof":false,"version":"v1"}""") }
        val model = FilesModel(wire, backgroundScope)
        model.selectSession("s1")
        model.readFile("file.txt")
        assertNull(model.openFile.value)
        assertTrue(model.openFileError.value!!.contains("page progress"))
    }

    @Test fun `Workspace updates cannot retarget an explicitly selected child Session`() = runTest {
        val wire = FakeWire()
        val model = FilesModel(wire, backgroundScope)
        model.selectSession("child-session")
        model.start(); runCurrent()
        wire.emit(value("""{"type":"baseline","value":{"items":[{"workspaceId":"w1","title":"Root","sessionIds":["parent-session"]}]}}"""))
        runCurrent()
        assertEquals("child-session", model.selectedSession.value)
        model.stopAndAwait()
    }
}
