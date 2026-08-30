package ai.deepseek.dsh.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
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
}
