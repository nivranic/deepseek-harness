package ai.deepseek.dsh.link

import java.nio.file.Files
import kotlin.test.*
import org.junit.jupiter.api.io.TempDir

class FileLinkCredentialsStoreTest {
    @TempDir lateinit var folder: java.io.File
    private val original = LinkCredentials("first", "host", "工作站", "collaborator",
        "https://localhost:443", "ab".repeat(32), "AAAA", "native-gateway-v1")

    @Test fun `replacement loads the new identity without temporary residue`() {
        val file = folder.resolve("credentials.json")
        val store = FileLinkCredentialsStore(file)
        store.save(original)
        val replacement = original.copy(deviceId = "second", hostName = "新工作站")
        store.save(replacement)
        assertEquals(replacement, store.load())
        assertEquals(listOf("credentials.json"), folder.list()!!.toList())
    }

    @Test fun `cipher failure preserves the prior credential bytes`() {
        val file = folder.resolve("credentials.json")
        FileLinkCredentialsStore(file).save(original)
        val before = file.readBytes()
        val store = FileLinkCredentialsStore(file, object : CredentialsCipher {
            override fun seal(plain: ByteArray): ByteArray = error("cipher unavailable")
            override fun open(sealed: ByteArray): ByteArray = error("unexpected read")
        })
        assertFailsWith<IllegalStateException> { store.save(original.copy(deviceId = "second")) }
        assertContentEquals(before, file.readBytes())
        assertEquals(listOf("credentials.json"), folder.list()!!.toList())
    }

    @Test fun `failed atomic replacement cleans only its temporary file`() {
        val target = folder.resolve("credentials.json").apply { mkdir() }
        val sentinel = target.resolve("sentinel").apply { writeText("keep") }
        assertFailsWith<java.io.IOException> { FileLinkCredentialsStore(target).save(original) }
        assertEquals("keep", sentinel.readText())
        assertEquals(listOf("credentials.json"), folder.list()!!.toList())
        assertTrue(Files.isDirectory(target.toPath()))
    }
}
