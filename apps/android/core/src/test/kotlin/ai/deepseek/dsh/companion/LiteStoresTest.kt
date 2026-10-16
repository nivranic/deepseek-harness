package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.CredentialsCipher
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun event(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

private fun tempDir(): java.io.File =
    java.nio.file.Files.createTempDirectory("lite-stores").toFile()

/** The event-sourced journal and the file-backed stores. */
class LiteStoresTest {
    @Test
    fun submitsPersistsAndRestoresAcrossARelaunch() {
        val directory = tempDir()
        val original = LiteSession("s1")
        original.record(event("""{"type":"prompt/accepted","requestId":"r1","content":"总结这份报告"}"""))
        original.record(event("""{"type":"stream/delta","text":"报告要点"}"""))
        original.record(event("""{"type":"message/completed","text":"报告要点共三项。"}"""))
        original.record(event("""{"type":"turn/completed"}"""))

        LiteFileSessionStore(directory).save(original)

        // A fresh store instance is a relaunch: the journal replays to the
        // same folded state the live session reached.
        val restored = LiteFileSessionStore(directory).load("s1")!!
        assertEquals(4, restored.events.size)
        assertEquals(original.state.conversation, restored.state.conversation)
        assertEquals("completed", restored.state.lastTurnEnd)
        assertEquals(
            listOf(LiteMessage(role = "user", text = "总结这份报告"), LiteMessage(role = "assistant", text = "报告要点共三项。")),
            restored.state.conversation,
        )
    }

    @Test
    fun savingReplacesThePriorJournal() {
        val directory = tempDir()
        val store = LiteFileSessionStore(directory)
        val session = LiteSession("s2")
        session.record(event("""{"type":"prompt/accepted","requestId":"r1","content":"第一轮"}"""))
        session.record(event("""{"type":"turn/completed"}"""))
        store.save(session)
        assertEquals(2, store.load("s2")!!.events.size)

        val shorter = LiteSession("s2")
        shorter.record(event("""{"type":"prompt/accepted","requestId":"r2","content":"重写"}"""))
        store.save(shorter)
        assertEquals(1, store.load("s2")!!.events.size)
    }

    @Test
    fun absentSessionsLoadNullAndDeleteRemoves() {
        val directory = tempDir()
        val store = LiteFileSessionStore(directory)
        assertNull(store.load("ghost"))

        val session = LiteSession("s3")
        session.record(event("""{"type":"turn/completed"}"""))
        store.save(session)
        assertTrue(store.load("s3") != null)
        store.delete("s3")
        assertNull(store.load("s3"))
    }

    @Test
    fun aCorruptJournalLineFailsLoud() {
        val directory = tempDir()
        val store = LiteFileSessionStore(directory)
        val session = LiteSession("s4")
        session.record(event("""{"type":"turn/completed"}"""))
        store.save(session)
        java.io.File(directory, "s4.litejournal").writeText("{\"type\":\"turn/completed\"}\n不是 JSON\n")

        assertFailsWith<IllegalStateException> { store.load("s4") }
    }

    @Test
    fun artifactBytesRoundTripThroughTheResourceChannel() {
        val directory = tempDir()
        val store = LiteFileArtifactStore(directory)
        assertNull(store.get("a1"))

        val bytes = "报告要点共三项。".encodeToByteArray()
        store.put("a1", bytes)
        assertTrue(bytes.contentEquals(store.get("a1")!!))

        store.remove("a1")
        assertNull(store.get("a1"))
    }

    @Test
    fun theSessionReplaysItsJournalThroughTheFold() {
        val session = LiteSession("s5")
        session.record(event("""{"type":"prompt/accepted","requestId":"r1","content":"继续"}"""))
        session.record(event("""{"type":"stream/delta","text":"好的"}"""))
        session.record(event("""{"type":"turn/cancelled","reason":"user"}"""))
        val state = session.state
        assertEquals(2, state.conversation.size)
        assertTrue(state.conversation[1].interrupted)
        assertEquals("cancelled", state.lastTurnEnd)
    }

    @Test
    fun anAbsentConfigLoadsNullAndARoundTripSurvivesARelaunch() {
        val file = java.io.File(tempDir(), "lite-config.enc")
        val store = LiteFileConfigStore(file)
        assertNull(store.load(), "no file yet is the unconfigured face, not a failure")

        val config = LiteConfig(
            endpoint = "https://api.example.com/v1/chat/completions",
            apiKey = "sk-test",
            model = "deepseek-chat",
        )
        store.save(config)
        assertEquals(config, LiteFileConfigStore(file).load())

        val replacement = config.copy(model = "deepseek-reasoner")
        store.save(replacement)
        assertEquals(replacement, LiteFileConfigStore(file).load())
    }

    @Test
    fun aLegacyThreeKeyConfigLoadsAPresetIdOfNull() {
        // The pre-selection file carries exactly the three required keys; the
        // optional preset id reads as no selection, never as corruption.
        val cipher = XorCipher()
        val legacy = java.io.File(tempDir(), "lite-config.enc")
        legacy.writeBytes(
            cipher.seal("""{"endpoint":"https://api.example.com/v1","apiKey":"sk-test","model":"deepseek-chat"}""".encodeToByteArray()),
        )
        assertEquals(
            LiteConfig("https://api.example.com/v1", "sk-test", "deepseek-chat", presetId = null),
            LiteFileConfigStore(legacy, cipher).load(),
        )

        val explicitNull = java.io.File(tempDir(), "lite-config.enc")
        explicitNull.writeBytes(
            cipher.seal("""{"endpoint":"https://api.example.com/v1","apiKey":"sk-test","model":"deepseek-chat","presetId":null}""".encodeToByteArray()),
        )
        assertEquals(
            LiteConfig("https://api.example.com/v1", "sk-test", "deepseek-chat"),
            LiteFileConfigStore(explicitNull, cipher).load(),
            "a JSON null reads the same as an absent key",
        )
    }

    @Test
    fun aSelectedPresetIdRoundTripsAndANullOneOmitsTheKey() {
        val cipher = XorCipher()
        val file = java.io.File(tempDir(), "lite-config.enc")
        val store = LiteFileConfigStore(file, cipher)

        val selected = LiteConfig("https://api.example.com/v1", "sk-test", "deepseek-chat", presetId = "minimal")
        store.save(selected)
        assertEquals(selected, LiteFileConfigStore(file, cipher).load())
        assertEquals(
            "minimal",
            (Json.parseToJsonElement(cipher.open(file.readBytes()).decodeToString()) as JsonObject)["presetId"]!!
                .jsonPrimitive.content,
        )

        // A null selection omits the key — the projection's optional-field
        // form — so the default-selection document stays the legacy three-key
        // file byte for byte.
        store.save(selected.copy(presetId = null))
        val reread = Json.parseToJsonElement(cipher.open(file.readBytes()).decodeToString()) as JsonObject
        assertTrue("presetId" !in reread, "a null preset id omits the key instead of writing JSON null")
    }

    @Test
    fun aMistypedPresetIdFailsLoud() {
        val cipher = XorCipher()
        val tampered = java.io.File(tempDir(), "lite-config.enc")
        tampered.writeBytes(
            cipher.seal("""{"endpoint":"https://api.example.com/v1","apiKey":"sk-test","model":"deepseek-chat","presetId":3}""".encodeToByteArray()),
        )
        assertFailsWith<IllegalStateException> { LiteFileConfigStore(tampered, cipher).load() }
    }

    /** A reversible non-plain cipher pins the seam: the file holds sealed bytes, not the JSON. */
    private class XorCipher : CredentialsCipher {
        override fun seal(plain: ByteArray): ByteArray = plain.map { (it.toInt() xor 0x5A).toByte() }.toByteArray()

        override fun open(sealed: ByteArray): ByteArray = seal(sealed)
    }

    @Test
    fun theWholeFileIsSealedThroughTheInjectedCipher() {
        val file = java.io.File(tempDir(), "lite-config.enc")
        LiteFileConfigStore(file, XorCipher()).save(LiteConfig("https://api.example.com/v1", "sk-test", "deepseek-chat"))
        val sealed = file.readBytes()
        assertTrue(!sealed.decodeToString().contains("\"endpoint\""), "the plain JSON never lands on disk")
        assertEquals(
            LiteConfig("https://api.example.com/v1", "sk-test", "deepseek-chat"),
            LiteFileConfigStore(file, XorCipher()).load(),
        )
    }

    @Test
    fun corruptOrTamperedConfigFilesFailLoud() {
        val garbage = java.io.File(tempDir(), "lite-config.enc")
        LiteFileConfigStore(garbage).save(LiteConfig("https://api.example.com/v1", "sk-test", "deepseek-chat"))
        garbage.writeText("不是 JSON")
        assertFailsWith<IllegalStateException> { LiteFileConfigStore(garbage).load() }

        val tampered = java.io.File(tempDir(), "lite-config.enc")
        val cipher = XorCipher()
        LiteFileConfigStore(tampered, cipher).save(LiteConfig("https://api.example.com/v1", "sk-test", "deepseek-chat"))
        // Flipping the leading `{` byte can only desynchronize the document.
        val sealed = tampered.readBytes()
        sealed[0] = (sealed[0].toInt() xor 0x11).toByte()
        tampered.writeBytes(sealed)
        assertFailsWith<IllegalStateException> { LiteFileConfigStore(tampered, cipher).load() }
    }

    @Test
    fun endpointValidationAcceptsHttpsUrlsWithPathsAndRejectsTheRest() {
        assertNull(validateLiteEndpoint("https://api.example.com/v1/chat/completions"))
        assertNull(validateLiteEndpoint("  https://api.example.com/v1/chat/completions  "))
        assertNull(validateLiteEndpoint("https://api.example.com:8443/v1/chat/completions"))
        assertNull(validateLiteEndpoint("https://api.example.com"))

        assertTrue(validateLiteEndpoint("http://api.example.com/v1") != null, "cleartext HTTP is refused")
        assertTrue(validateLiteEndpoint("https://user:pass@api.example.com/v1") != null, "userinfo is refused")
        assertTrue(validateLiteEndpoint("https:///v1/chat/completions") != null, "an empty host is refused")
        assertTrue(validateLiteEndpoint("api.example.com/v1/chat/completions") != null, "a bare schemeless string is refused")
    }
}
