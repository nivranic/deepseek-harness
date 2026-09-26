package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.CredentialsCipher
import ai.deepseek.dsh.link.PlainCredentialsCipher
import java.io.File
import java.nio.file.Files
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import kotlin.test.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class CompanionInputStoreTest {
    private val roots = mutableListOf<File>()
    private val principal = CompanionInputPrincipal("host", "a".repeat(64), "device")
    private fun directory() = Files.createTempDirectory("companion-input-").toFile().also { roots.add(it) }
    @AfterTest fun cleanup() { roots.forEach { it.deleteRecursively() } }
    private fun snapshot() = CompanionInputSnapshot(
        drafts = mapOf("session" to SessionDraft("new composer input 中文", "new-intent")),
        pendingPrompts = mapOf("old-intent" to PendingPrompt("session", SessionDraft("unconfirmed original", "old-intent"))),
        answers = mapOf(QuestionDraftKey("session", "interaction", 3) to
            listOf(CompanionQuestionAnswer("question", listOf("Blue"), "user custom answer"))),
        lastSessionId = "session",
    )

    private class TestCipher : CredentialsCipher {
        private val key = SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES")
        var failSeal = false
        var opens = 0
        override fun seal(plain: ByteArray): ByteArray {
            check(!failSeal) { "fixture key unavailable" }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            return cipher.iv + cipher.doFinal(plain)
        }
        override fun open(sealed: ByteArray): ByteArray {
            opens++
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            return cipher.doFinal(sealed.copyOfRange(12, sealed.size))
        }
    }

    @Test fun `encrypted input restores drafts pending identities answers and the selected Session`() {
        val folder = directory()
        val cipher = TestCipher()
        val store = FileCompanionInputStore(folder, principal, cipher, 16_384)
        assertNull(store.load())
        assertEquals(0, cipher.opens)
        assertTrue(folder.listFiles()!!.isEmpty())
        store.save(snapshot())
        val saved = folder.listFiles()!!.single().readBytes()
        assertFalse(saved.toString(Charsets.UTF_8).contains("new composer input"))
        assertFalse(saved.toString(Charsets.UTF_8).contains("user custom answer"))
        val restored = FileCompanionInputStore(folder, principal, cipher, 16_384)
        assertEquals(snapshot(), restored.load())
    }

    @Test fun `Host key and device identity isolate files and reject a transplanted document`() {
        val folder = directory()
        val first = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        first.save(snapshot())
        val original = folder.listFiles()!!.single()
        val variants = listOf(principal.copy(hostId = "other-host"), principal.copy(fingerprint = "b".repeat(64)),
            principal.copy(deviceId = "other-device"))
        for (other in variants) {
            val store = FileCompanionInputStore(folder, other, PlainCredentialsCipher, 16_384)
            assertNull(store.load())
            val before = folder.listFiles()!!.toSet()
            store.save(CompanionInputSnapshot())
            val file = (folder.listFiles()!!.toSet() - before).single()
            file.writeBytes(original.readBytes())
            val copied = file.readBytes()
            assertFailsWith<IllegalArgumentException> { store.load() }
            assertContentEquals(copied, file.readBytes())
        }
    }

    @Test fun `failed encryption and oversized replacement preserve the previous encrypted bytes`() {
        val folder = directory()
        val cipher = TestCipher()
        val store = FileCompanionInputStore(folder, principal, cipher, 2_048)
        store.save(snapshot())
        val file = folder.listFiles()!!.single()
        val before = file.readBytes()
        cipher.failSeal = true
        assertFailsWith<IllegalStateException> { store.save(CompanionInputSnapshot()) }
        assertContentEquals(before, file.readBytes())
        cipher.failSeal = false
        assertFailsWith<IllegalArgumentException> {
            store.save(snapshot().copy(drafts = mapOf("session" to SessionDraft("x".repeat(4_000), "too-large"))))
        }
        assertContentEquals(before, file.readBytes())
        assertEquals(1, folder.listFiles()!!.size)
    }

    @Test fun `failed atomic replacement cleans its temporary file without an in place overwrite`() {
        val folder = directory()
        val store = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        store.save(snapshot())
        val target = folder.listFiles()!!.single()
        assertTrue(target.delete()); assertTrue(target.mkdir())
        val sentinel = File(target, "retained").apply { writeText("existing directory") }
        assertFails { store.save(snapshot()) }
        assertEquals("existing directory", sentinel.readText())
        assertEquals(listOf(target), folder.listFiles()!!.toList())
    }

    @Test fun `malformed oversized tampered and unsupported documents stay untouched`() {
        val folder = directory()
        val cipher = TestCipher()
        val store = FileCompanionInputStore(folder, principal, cipher, 2_048)
        store.save(snapshot())
        val file = folder.listFiles()!!.single()
        val valid = file.readBytes()
        val cases = listOf(ByteArray(2_049), valid.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() },
            cipher.seal("{invalid".toByteArray()), cipher.seal(byteArrayOf(0xc3.toByte(), 0x28)))
        for (bytes in cases) {
            file.writeBytes(bytes)
            assertFails { store.load() }
            assertContentEquals(bytes, file.readBytes())
        }
    }

    @Test fun `durable schema refuses ambiguous identities duplicate rows and unknown fields`() {
        val folder = directory()
        val store = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        store.save(snapshot())
        val file = folder.listFiles()!!.single()
        val original = Json.parseToJsonElement(file.readText()).jsonObject
        val duplicateDraft = JsonArray(original.getValue("drafts").jsonArray.let { it + it })
        val duplicateAnswers = JsonArray(original.getValue("answers").jsonArray.let { it + it })
        val conflict = original.getValue("pendingPrompts").jsonArray.single().jsonObject
        val badPending = JsonArray(listOf(JsonObject(conflict + ("requestId" to JsonPrimitive("new-intent")))))
        val variants = listOf(
            JsonObject(original + ("version" to JsonPrimitive(2))),
            JsonObject(original + ("extra" to JsonPrimitive(true))),
            JsonObject(original - "answers"),
            JsonObject(original + ("drafts" to duplicateDraft)),
            JsonObject(original + ("answers" to duplicateAnswers)),
            JsonObject(original + ("pendingPrompts" to badPending)),
        )
        for (variant in variants) {
            val bytes = variant.toString().toByteArray()
            file.writeBytes(bytes)
            assertFails { store.load() }
            assertContentEquals(bytes, file.readBytes())
        }
    }

    @Test fun `coalesced checkpoints persist the latest complete input without dispatching any mutation`() = runTest {
        val saved = mutableListOf<CompanionInputSnapshot>()
        val store = object : CompanionInputStoring {
            override fun load(): CompanionInputSnapshot? = null
            override fun save(snapshot: CompanionInputSnapshot) { saved.add(snapshot) }
            override fun preserveAndStartFresh() = error("no recovery requested")
        }
        val state = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        for (index in 1..20) state.update { it.copy(drafts = mapOf("session" to SessionDraft("edit $index", "request-$index"))) }
        state.update { it.copy(lastSessionId = "session", answers = snapshot().answers) }
        assertEquals(InputPersistenceStatus.SAVING, state.persistence.value)
        state.flush()
        assertEquals(InputPersistenceStatus.SAVED, state.persistence.value)
        assertEquals(1, saved.size)
        assertEquals(state.state.value, saved.single())
    }

    @Test fun `write failures stay visible until an explicit durability retry succeeds`() = runTest {
        var fail = true
        var saved: CompanionInputSnapshot? = null
        val store = object : CompanionInputStoring {
            override fun load(): CompanionInputSnapshot? = null
            override fun save(snapshot: CompanionInputSnapshot) { check(!fail); saved = snapshot }
            override fun preserveAndStartFresh() = error("no recovery requested")
        }
        val state = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        state.update { snapshot() }
        assertFailsWith<InputPersistenceException> { state.flush() }
        assertEquals(InputPersistenceStatus.WRITE_FAILED, state.persistence.value)
        assertNull(saved)
        fail = false
        state.flush()
        assertEquals(snapshot(), saved)
        assertEquals(InputPersistenceStatus.SAVED, state.persistence.value)
    }

    @Test fun `unreadable input blocks overwriting until explicit recovery preserves its original bytes`() = runTest {
        val folder = directory()
        val store = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        store.save(snapshot())
        val file = folder.listFiles()!!.single()
        val damaged = "{broken input document".toByteArray()
        file.writeBytes(damaged)
        val state = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        assertEquals(InputPersistenceStatus.RESTORE_FAILED, state.persistence.value)
        assertFailsWith<InputPersistenceException> { state.update { snapshot() } }
        assertFailsWith<InputPersistenceException> { state.flush() }
        assertContentEquals(damaged, file.readBytes())
        state.startFresh()
        assertEquals(CompanionInputSnapshot(), state.state.value)
        assertEquals(InputPersistenceStatus.SAVED, state.persistence.value)
        assertEquals(CompanionInputSnapshot(), store.load())
        val backup = folder.listFiles()!!.single { it.name.contains(".unavailable-") }
        assertContentEquals(damaged, backup.readBytes())
    }
}
