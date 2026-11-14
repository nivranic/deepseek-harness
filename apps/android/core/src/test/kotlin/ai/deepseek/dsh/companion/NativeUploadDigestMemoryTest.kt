package ai.deepseek.dsh.companion

import java.nio.file.Files
import kotlin.test.*

class NativeUploadDigestMemoryTest {
    private fun directory() = Files.createTempDirectory("dsh-digest-memory-").toFile()

    private fun digest(seed: Char) = seed.toString().repeat(64)

    @Test fun `a missing document loads as empty and a remembered digest round-trips`() {
        val file = directory()
        val memory = FileNativeUploadDigestMemory(java.io.File(file, "upload-digests.json"))
        assertEquals(emptyList(), memory.load())
        memory.remember(digest('a'))
        assertEquals(listOf(digest('a')), FileNativeUploadDigestMemory(java.io.File(file, "upload-digests.json")).load())
    }

    @Test fun `capacity drops the oldest and a repeated digest refreshes recency`() {
        val memory = FileNativeUploadDigestMemory(java.io.File(directory(), "upload-digests.json"), capacity = 2)
        memory.remember(digest('a')); memory.remember(digest('b'))
        memory.remember(digest('a'))
        assertEquals(listOf(digest('b'), digest('a')), memory.load())
        memory.remember(digest('c'))
        assertEquals(listOf(digest('a'), digest('c')), memory.load())
    }

    @Test fun `a damaged document loads as empty and never blocks remembering`() {
        val file = java.io.File(directory(), "upload-digests.json")
        file.writeText("{not json")
        val memory = FileNativeUploadDigestMemory(file)
        assertEquals(emptyList(), memory.load())
        memory.remember(digest('d'))
        assertEquals(listOf(digest('d')), FileNativeUploadDigestMemory(file).load())
    }

    @Test fun `non-hex digests are refused and malformed entries are ignored on load`() {
        val memory = FileNativeUploadDigestMemory(java.io.File(directory(), "upload-digests.json"))
        assertFailsWith<IllegalArgumentException> { memory.remember("ZZ".repeat(32)) }
        val file = java.io.File(directory(), "upload-digests.json")
        file.writeText("""{"version":1,"digests":["${digest('e')}","not-a-digest"]}""")
        assertEquals(listOf(digest('e')), FileNativeUploadDigestMemory(file).load())
    }
}
