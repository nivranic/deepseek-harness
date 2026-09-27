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
        drafts = mapOf("session" to SessionDraft("new composer input 中文", "new-intent", listOf(
            SessionFileAttachment("new-receipt", "new-attachment", "空文件.txt", 0),
            SessionFileAttachment("large-receipt", "large-attachment", "large.bin", 9_007_199_254_740_991L),
        ))),
        pendingPrompts = mapOf("old-intent" to PendingPrompt("session", SessionDraft("unconfirmed original", "old-intent",
            listOf(SessionFileAttachment("old-receipt", "old-attachment", "original.txt", 42))))),
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

    @Test fun `encrypted input restores drafts pending identities file metadata answers and the selected Session`() {
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
        assertFalse(saved.toString(Charsets.UTF_8).contains("original.txt"))
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
            JsonObject(original + ("version" to JsonPrimitive(4))),
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

    @Test fun `mixed image metadata round trips and invalid image fields preserve the input bytes`() {
        val folder = directory()
        val store = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        val image = SessionImageAttachment("image-receipt", "image-attachment", "image/png", 69, 1, 1, "红.png", SessionImageDimensions(2, 3))
        val draft = SessionDraft("mixed", "mixed-request", listOf(SessionFileAttachment("file-receipt", "file-attachment", "one.txt", 1), image,
            image.copy(receiptId = "unnamed", name = null, originalDimensions = null)))
        val input = CompanionInputSnapshot(drafts = mapOf("session" to draft), pendingPrompts = mapOf(draft.requestId to PendingPrompt("session", draft)))
        store.save(input)
        assertEquals(input, store.load())
        val file = folder.listFiles()!!.single()
        val original = Json.parseToJsonElement(file.readText()).jsonObject
        val row = original.getValue("drafts").jsonArray.single().jsonObject
        val images = row.getValue("attachments").jsonArray
        val imageJson = images[1].jsonObject
        val changes = listOf("width" to JsonPrimitive(0), "height" to JsonPrimitive(1.5), "width" to JsonPrimitive("1"),
            "bytes" to JsonPrimitive(0), "mediaType" to JsonPrimitive("image/heic"), "type" to JsonPrimitive("video"),
            "originalDimensions" to buildJsonObject { put("width", -1); put("height", 1) })
        for (changed in changes.map { JsonObject(imageJson + it) } + listOf(JsonObject(imageJson - "name"), JsonObject(imageJson - "originalDimensions"))) {
            val replacement = JsonObject(row + ("attachments" to JsonArray(listOf(images[0], changed, images[2]))))
            val bytes = JsonObject(original + ("drafts" to JsonArray(listOf(replacement)))).toString().toByteArray()
            file.writeBytes(bytes)
            assertFails { store.load() }
            assertContentEquals(bytes, file.readBytes())
        }
    }

    @Test fun `version two file rows remain untouched until explicit backup and reset`() = runTest {
        val folder = directory()
        val store = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        store.save(CompanionInputSnapshot(drafts = mapOf("session" to SessionDraft("old", "request"))))
        val file = folder.listFiles()!!.single()
        val original = Json.parseToJsonElement(file.readText()).jsonObject
        val legacy = JsonObject(original + ("version" to JsonPrimitive(2)) + listOf("drafts", "pendingPrompts").associateWith { collection ->
            JsonArray(original.getValue(collection).jsonArray.map { JsonObject((it.jsonObject - "attachments") + ("files" to JsonArray(emptyList()))) })
        }).toString().toByteArray()
        file.writeBytes(legacy)
        val state = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        assertEquals(InputPersistenceStatus.RESTORE_FAILED, state.persistence.value)
        assertContentEquals(legacy, file.readBytes())
        state.startFresh()
        assertEquals(CompanionInputSnapshot(), store.load())
        assertContentEquals(legacy, folder.listFiles()!!.single { it.name.contains(".unavailable-") }.readBytes())
    }

    @Test fun `version three requires ordered attachment arrays on both draft and pending prompt rows`() {
        val folder = directory()
        val store = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        val draft = SessionDraft("text only", "same-intent")
        val input = CompanionInputSnapshot(drafts = mapOf("session" to draft),
            pendingPrompts = mapOf(draft.requestId to PendingPrompt("session", draft)))
        store.save(input)
        val file = folder.listFiles()!!.single()
        val original = Json.parseToJsonElement(file.readText()).jsonObject
        assertEquals(JsonPrimitive(3), original.getValue("version"))
        assertEquals(input, store.load())
        for (collection in listOf("drafts", "pendingPrompts")) {
            val row = original.getValue(collection).jsonArray.single().jsonObject
            assertEquals(JsonArray(emptyList()), row.getValue("attachments"))
            val variants = listOf(JsonObject(row - "attachments"), JsonObject(row + ("attachments" to JsonNull)),
                JsonObject(row + ("attachments" to JsonObject(emptyMap()))))
            for (variant in variants) {
                val bytes = JsonObject(original + (collection to JsonArray(listOf(variant)))).toString().toByteArray()
                file.writeBytes(bytes)
                assertFails { store.load() }
                assertContentEquals(bytes, file.readBytes())
            }
        }
    }

    @Test fun `file metadata rejects blank identities invalid byte counts and duplicate receipt identities`() {
        val folder = directory()
        val store = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        store.save(snapshot())
        val file = folder.listFiles()!!.single()
        val original = Json.parseToJsonElement(file.readText()).jsonObject
        for (collection in listOf("drafts", "pendingPrompts")) {
            val row = original.getValue(collection).jsonArray.single().jsonObject
            val attachment = row.getValue("attachments").jsonArray.first().jsonObject
            val malformed = mutableListOf<JsonElement>(JsonNull,
                JsonObject(attachment - "receiptId"), JsonObject(attachment + ("extra" to JsonPrimitive(true))))
            for (field in listOf("receiptId", "attachmentId", "name")) {
                for (value in listOf(JsonPrimitive(""), JsonPrimitive(" \t"), JsonPrimitive(7), JsonNull)) {
                    malformed.add(JsonObject(attachment + (field to value)))
                }
            }
            for (value in listOf(JsonPrimitive("42"), JsonPrimitive("invalid"), JsonPrimitive(false), JsonNull,
                JsonPrimitive(0.5), JsonPrimitive(-1), JsonPrimitive(9_007_199_254_740_992L))) {
                malformed.add(JsonObject(attachment + ("bytes" to value)))
            }
            val fileArrays = malformed.map { JsonArray(listOf(it)) } + listOf(
                JsonArray(listOf(attachment, attachment)),
                JsonArray(listOf(attachment, JsonObject(attachment + ("attachmentId" to JsonPrimitive("other-attachment"))))),
            )
            for (files in fileArrays) {
                val variant = JsonObject(row + ("attachments" to files))
                val bytes = JsonObject(original + (collection to JsonArray(listOf(variant)))).toString().toByteArray()
                file.writeBytes(bytes)
                assertFails { store.load() }
                assertContentEquals(bytes, file.readBytes())
            }
        }
    }

    @Test fun `one request identity cannot restore a different attachment intent`() {
        val folder = directory()
        val store = FileCompanionInputStore(folder, principal, PlainCredentialsCipher, 16_384)
        val draft = snapshot().drafts.getValue("session")
        val input = CompanionInputSnapshot(drafts = mapOf("session" to draft),
            pendingPrompts = mapOf(draft.requestId to PendingPrompt("session", draft)))
        store.save(input)
        assertEquals(input, store.load())
        val file = folder.listFiles()!!.single()
        val original = Json.parseToJsonElement(file.readText()).jsonObject
        val row = original.getValue("pendingPrompts").jsonArray.single().jsonObject
        val files = row.getValue("attachments").jsonArray
        val attachment = files.first().jsonObject
        val changedFiles = listOf(JsonArray(emptyList()), JsonArray(files.reversed())) +
            listOf("receiptId" to JsonPrimitive("other-receipt"), "attachmentId" to JsonPrimitive("other-attachment"),
                "name" to JsonPrimitive("renamed.txt"), "bytes" to JsonPrimitive(1)).map { change ->
                JsonArray(listOf(JsonObject(attachment + change)) + files.drop(1))
            }
        for (changed in changedFiles) {
            val pending = JsonObject(row + ("attachments" to changed))
            val bytes = JsonObject(original + ("pendingPrompts" to JsonArray(listOf(pending)))).toString().toByteArray()
            file.writeBytes(bytes)
            assertFailsWith<IllegalArgumentException> { store.load() }
            assertContentEquals(bytes, file.readBytes())
        }
    }

    @Test fun `version one input blocks new edits until explicit recovery preserves its encrypted bytes`() = runTest {
        val folder = directory()
        val cipher = TestCipher()
        val store = FileCompanionInputStore(folder, principal, cipher, 16_384)
        store.save(snapshot())
        val file = folder.listFiles()!!.single()
        val original = Json.parseToJsonElement(cipher.open(file.readBytes()).decodeToString()).jsonObject
        val legacy = JsonObject(original + ("version" to JsonPrimitive(1)) +
            listOf("drafts", "pendingPrompts").associateWith { collection ->
                JsonArray(original.getValue(collection).jsonArray.map { JsonObject(it.jsonObject - "attachments") })
            })
        val previous = cipher.seal(legacy.toString().toByteArray())
        file.writeBytes(previous)
        assertFailsWith<IllegalArgumentException> { store.load() }
        assertContentEquals(previous, file.readBytes())
        val state = CompanionInputState.restore(store, backgroundScope, StandardTestDispatcher(testScheduler))
        assertEquals(InputPersistenceStatus.RESTORE_FAILED, state.persistence.value)
        assertFailsWith<InputPersistenceException> { state.update { snapshot() } }
        assertFailsWith<InputPersistenceException> { state.flush() }
        assertContentEquals(previous, file.readBytes())
        state.startFresh()
        assertEquals(CompanionInputSnapshot(), state.state.value)
        assertEquals(InputPersistenceStatus.SAVED, state.persistence.value)
        assertEquals(CompanionInputSnapshot(), store.load())
        val backup = folder.listFiles()!!.single { it.name.contains(".unavailable-") }
        assertContentEquals(previous, backup.readBytes())
        state.update { snapshot() }
        state.flush()
        assertEquals(snapshot(), store.load())
        assertContentEquals(previous, backup.readBytes())
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
