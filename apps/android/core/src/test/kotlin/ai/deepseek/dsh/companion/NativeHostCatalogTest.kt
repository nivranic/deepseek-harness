package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeGatewayProtocol
import ai.deepseek.dsh.link.*
import java.io.File
import java.nio.file.Files
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.*
import kotlin.test.*

internal fun hostCredentials(id: String = "host-a") = LinkCredentials("device-$id", id, "Name $id", "controller",
    "https://localhost:8443", "a".repeat(64), Base64.getEncoder().encodeToString(ByteArray(32) { 1 }),
    NativeGatewayProtocol.credentialFormat)

class NativeHostCatalogTest {
    private val roots = mutableListOf<File>()
    private fun file() = File(Files.createTempDirectory("native-hosts-").toFile().also { roots.add(it) }, "hosts")
    @AfterTest fun cleanup() { roots.forEach { it.deleteRecursively() } }
    private class TestCipher : CredentialsCipher {
        private val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
        var failSeal = false
        override fun seal(plain: ByteArray): ByteArray {
            check(!failSeal)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            return cipher.iv + cipher.doFinal(plain)
        }
        override fun open(sealed: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            return cipher.doFinal(sealed.copyOfRange(12, sealed.size))
        }
    }

    @Test fun `whole encrypted catalog restores both grants and selected Host`() {
        val file = file()
        val cipher = TestCipher()
        val store = FileNativeHostStore(file, cipher, 8192)
        assertNull(store.load())
        val catalog = NativeHostCatalog().remember(hostCredentials()).remember(hostCredentials("host-b"))
        store.save(catalog)
        assertEquals(catalog, store.load())
        val bytes = file.readBytes().toString(Charsets.UTF_8)
        for (secret in listOf("host-a", "host-b", "localhost", hostCredentials().signingKeyBase64)) assertFalse(bytes.contains(secret))
        assertEquals("host-b", store.load()!!.selected()!!.hostId)
    }

    @Test fun `re-pair replaces a grant while a changed TLS key remains a distinct Host`() {
        val first = hostCredentials()
        val replacement = first.copy(deviceId = "replacement", endpoint = "https://localhost:9443")
        val catalog = NativeHostCatalog().remember(first).remember(replacement)
        assertEquals(listOf(replacement), catalog.hosts)
        assertEquals(nativeHostKey(first), catalog.active)
        val otherKey = first.copy(pinnedFingerprint = "b".repeat(64))
        assertEquals(2, catalog.remember(otherKey).hosts.size)
    }

    @Test fun `strict disk validation rejects unsupported and contradictory identities without replacing bytes`() {
        val file = file()
        val store = FileNativeHostStore(file, PlainCredentialsCipher, 8192)
        store.save(NativeHostCatalog().remember(hostCredentials()))
        val root = Json.parseToJsonElement(file.readText()).jsonObject
        val row = root.getValue("hosts").jsonArray.single().jsonObject
        val invalid = listOf(
            JsonObject(root + ("version" to JsonPrimitive(2))),
            JsonObject(root + ("version" to JsonPrimitive("1"))),
            JsonObject(root + ("extra" to JsonPrimitive(true))),
            JsonObject(root + ("active" to JsonNull)),
            JsonObject(root + ("active" to JsonPrimitive("unknown"))),
            JsonObject(root + ("hosts" to JsonArray(listOf(row, row)))),
        ) + listOf("transportFormat" to "link", "role" to "admin", "endpoint" to "http://localhost",
            "signingKeyBase64" to "bad", "pinnedFingerprint" to "bad", "deviceId" to "").map { (key, value) ->
            JsonObject(root + ("hosts" to JsonArray(listOf(JsonObject(row + (key to JsonPrimitive(value)))))))
        }
        for (value in invalid) {
            file.writeText(value.toString())
            val before = file.readBytes()
            assertFails { store.load() }
            assertContentEquals(before, file.readBytes())
        }
        file.writeBytes(byteArrayOf(0xC3.toByte(), 0x28))
        assertFails { store.load() }
    }

    @Test fun `failed encryption size validation and atomic replacement preserve the previous document`() {
        val file = file()
        val cipher = TestCipher()
        val store = FileNativeHostStore(file, cipher, 2048)
        val catalog = NativeHostCatalog().remember(hostCredentials())
        store.save(catalog)
        val before = file.readBytes()
        cipher.failSeal = true
        assertFails { store.save(NativeHostCatalog()) }
        assertContentEquals(before, file.readBytes())
        cipher.failSeal = false
        assertFails { store.save(catalog.remember(hostCredentials().copy(hostName = "x".repeat(4096)))) }
        assertContentEquals(before, file.readBytes())
        val directoryTarget = File(file.parentFile, "directory").apply { mkdir() }
        File(directoryTarget, "keep").writeText("untouched")
        assertFails { FileNativeHostStore(directoryTarget, cipher, 2048).save(catalog) }
        assertEquals("untouched", File(directoryTarget, "keep").readText())
        assertEquals(setOf("hosts", "directory"), file.parentFile.list()!!.toSet())
    }

    @Test fun `oversized encrypted and decoded documents are rejected`() {
        val file = file()
        file.writeBytes(ByteArray(129))
        assertFails { FileNativeHostStore(file, PlainCredentialsCipher, 128).load() }
        file.writeBytes(byteArrayOf(1))
        val expanding = object : CredentialsCipher {
            override fun seal(plain: ByteArray) = ByteArray(129)
            override fun open(sealed: ByteArray) = ByteArray(129)
        }
        val store = FileNativeHostStore(file, expanding, 128)
        assertFails { store.load() }
        assertFails { store.save(NativeHostCatalog()) }
        assertContentEquals(byteArrayOf(1), file.readBytes())
    }

    @Test fun `explicit recovery preserves unreadable bytes before replacing the catalog`() {
        val file = file()
        file.writeText("unreadable")
        val store = FileNativeHostStore(file, TestCipher(), 8192)
        assertFails { store.load() }
        store.preserveAndStartFresh()
        assertEquals(NativeHostCatalog(), store.load())
        assertEquals("unreadable", file.parentFile.listFiles()!!.single { it != file }.readText())
    }
}
