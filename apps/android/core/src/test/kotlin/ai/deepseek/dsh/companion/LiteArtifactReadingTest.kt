package ai.deepseek.dsh.companion

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private fun tempDir(): java.io.File =
    java.nio.file.Files.createTempDirectory("lite-artifacts").toFile()

/** The resource-channel consumption face of chapter 56. */
class LiteArtifactReadingTest {
    @Test
    fun textualKindsRenderTheirBytesDirectly() {
        val store = LiteFileArtifactStore(tempDir())
        store.put("a1", "报告要点共三项。".encodeToByteArray())
        val content = readLiteArtifact(
            store,
            LiteArtifact(id = "a1", kind = "markdown", title = "报告.md", status = "ready"),
        )!!
        assertEquals(LiteArtifactContent.Presentation.Text("报告要点共三项。"), content.presentation)
        assertEquals("报告.md", content.title)

        store.put("a2", "diff --git a/x b/x".encodeToByteArray())
        val patch = readLiteArtifact(store, LiteArtifact(id = "a2", kind = "patch", title = "修复.patch", status = "ready"))!!
        assertEquals(LiteArtifactContent.Presentation.Text("diff --git a/x b/x"), patch.presentation)
    }

    @Test
    fun otherKindsRenderTypeAndSizeOnly() {
        val store = LiteFileArtifactStore(tempDir())
        val bytes = ByteArray(1234) { it.toByte() }
        store.put("img", bytes)
        val image = readLiteArtifact(store, LiteArtifact(id = "img", kind = "image", title = "截图.png", status = "ready"))!!
        assertEquals(LiteArtifactContent.Presentation.Binary(kind = "image", sizeBytes = 1234), image.presentation)

        store.put("f", "任意字节".encodeToByteArray())
        val file = readLiteArtifact(store, LiteArtifact(id = "f", kind = "file", title = "数据.bin", status = "pending"))!!
        assertEquals(LiteArtifactContent.Presentation.Binary(kind = "file", sizeBytes = "任意字节".encodeToByteArray().size), file.presentation)
    }

    @Test
    fun aMissingIdReadsAsTheEmptyState() {
        val store = LiteFileArtifactStore(tempDir())
        assertNull(readLiteArtifact(store, LiteArtifact(id = "ghost", kind = "markdown", title = "不存在.md", status = "ready")))
    }

    @Test
    fun theChatSurfaceReadsThroughItsInjectedChannel() {
        val artifacts = LiteFileArtifactStore(tempDir())
        artifacts.put("a1", "内容".encodeToByteArray())
        val model = LiteChatViewModel(
            scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
            sessionId = "ui9",
            provider = ScriptedLiteProvider(emptyMap()),
            execute = { _, _, _ -> LiteToolOutcome(ok = true, text = "") },
            artifacts = artifacts,
        )
        assertEquals(
            LiteArtifactContent(id = "a1", kind = "text", title = "笔记.txt", presentation = LiteArtifactContent.Presentation.Text("内容")),
            model.readArtifact(LiteArtifact(id = "a1", kind = "text", title = "笔记.txt", status = "ready")),
        )

        val bare = LiteChatViewModel(
            scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
            sessionId = "ui10",
            provider = ScriptedLiteProvider(emptyMap()),
            execute = { _, _, _ -> LiteToolOutcome(ok = true, text = "") },
        )
        assertNull(bare.readArtifact(LiteArtifact(id = "a1", kind = "text", title = "笔记.txt", status = "ready")), "no channel is the empty state")
    }
}
