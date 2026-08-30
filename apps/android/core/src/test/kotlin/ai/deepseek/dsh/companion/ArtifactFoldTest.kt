package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

private fun wireOf(json: String): WireValue =
    WireValue.fromJsonElement(kotlinx.serialization.json.Json.parseToJsonElement(json))

private fun artifactCreatedEvent(seq: Int, id: String, kind: String, title: String): WireValue =
    wireOf("""{"type":"event","event":{"type":"artifact/created","seq":$seq,"time":1759017600000,"data":{"id":"$id","kind":"$kind","title":"$title"}}}""")

private fun artifactStatusEvent(seq: Int, id: String, status: String): WireValue =
    wireOf("""{"type":"event","event":{"type":"artifact/status","seq":$seq,"time":1759017600000,"data":{"id":"$id","status":"$status"}}}""")

/** The chapter-56 artifact pane over the folded trajectory. */
class ArtifactFoldTest {
    @Test
    fun foldsArtifactReferencesAndStatusByTheLiteVocabulary() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.openSession("s1")
        wire.emit(wireOf("""{"type":"snapshot","cursor":0,"records":[]}"""))
        wire.emit(artifactCreatedEvent(1, "a1", "markdown", "报告.md"))
        wire.emit(artifactCreatedEvent(2, "a2", "image", "截图.png"))
        wire.emit(artifactStatusEvent(3, "a1", "ready"))
        // A status whose reference never arrived is a no-op.
        wire.emit(artifactStatusEvent(4, "ghost", "failed"))
        wire.emit(artifactStatusEvent(5, "a2", "failed"))
        // Malformed payloads are absent referents: skipped, no crash.
        wire.emit(wireOf("""{"type":"event","event":{"type":"artifact/created","seq":6,"time":1759017600000,"data":{"id":3,"kind":"markdown","title":"数值 id"}}}"""))
        wire.emit(wireOf("""{"type":"event","event":{"type":"artifact/created","seq":7,"time":1759017600000,"data":"不是对象"}}"""))
        wire.emit(artifactStatusEvent(8, "a1", "weird"))
        // A repeated created pushes again, mirroring the Lite fold.
        wire.emit(artifactCreatedEvent(9, "a1", "markdown", "报告.md"))
        advanceUntilIdle()

        assertEquals(
            listOf(
                FoldArtifact(id = "a1", kind = "markdown", title = "报告.md", status = "ready"),
                FoldArtifact(id = "a2", kind = "image", title = "截图.png", status = "failed"),
                FoldArtifact(id = "a1", kind = "markdown", title = "报告.md", status = "pending"),
            ),
            model.state.artifacts,
        )
        assertEquals(
            listOf(
                "新建工件 报告.md（markdown）",
                "新建工件 截图.png（image）",
                "工件 a1：就绪",
                "工件 ghost：失败",
                "工件 a2：失败",
                "",
                "",
                "",
                "新建工件 报告.md（markdown）",
            ),
            model.state.items.map { it.text },
        )
    }

    @Test
    fun reopeningResetsTheArtifactsPaneWithTheFold() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        model.openSession("s1")
        wire.emit(wireOf("""{"type":"snapshot","cursor":0,"records":[]}"""))
        wire.emit(artifactCreatedEvent(1, "a1", "markdown", "报告.md"))
        wire.emit(artifactStatusEvent(2, "a1", "ready"))
        advanceUntilIdle()
        assertEquals(listOf("ready"), model.state.artifacts.map { it.status })

        model.openSession("s2")
        wire.emit(wireOf("""{"type":"snapshot","cursor":0,"records":[]}"""))
        advanceUntilIdle()
        assertEquals(0, model.state.artifacts.size)
    }
}
