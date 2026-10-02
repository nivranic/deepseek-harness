package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.PlainCredentialsCipher
import ai.deepseek.dsh.link.WireValue
import java.nio.file.Files
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeJournalPersistenceTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun event(seq: Int, text: String = "row-$seq") = """{"type":"event","event":{"seq":$seq,"type":"user/message","data":{"content":[{"type":"text","text":"$text"}]}}}"""
    private fun snapshot(start: Int, end: Int, more: Boolean = start > 0, id: String = "session") = value(
        """{"type":"snapshot","header":{"id":"$id"},"cursor":$end,"hasMore":$more,"records":[${(start..end).joinToString(",", transform = ::event)}]}""")
    private fun address(id: String = "session") = value("""{"kind":"session","sessionId":"$id"}""") as WireValue.ObjectValue
    private fun record(seq: Int) = value(event(seq))
    private fun seqs(rows: List<WireValue>) = rows.map { WireShape.number(WireShape.objectValue(it, "event")!!, "seq")!!.toInt() }
    private fun directory() = Files.createTempDirectory("native-journal").toFile()
    private val principal = CompanionInputPrincipal("host", "fingerprint", "device")

    private fun store(dir: java.io.File, maxBytes: Int = 65_536, who: CompanionInputPrincipal = principal) =
        FileNativeJournalStore(dir, who, PlainCredentialsCipher, maxBytes)

    private fun window(records: List<Int>, cut: Int? = null, id: String = "session") = NativeJournalWindow(
        id, address(id), (cut ?: records.last())?.toLong() ?: -1L, hasMore = false, records = records.map(::record))

    @Test fun `the file store round-trips one window through a fresh instance`() {
        val dir = directory()
        store(dir).save(window(listOf(0, 1, 2)))
        val loaded = store(dir).load()
        assertEquals(NativeJournalWindow("session", address(), 2L, false, listOf(record(0), record(1), record(2))), loaded)
    }

    @Test fun `a live window beyond its snapshot cut persists and reloads unchanged`() {
        val dir = directory()
        store(dir).save(NativeJournalWindow("session", address(), 2L, false, listOf(record(0), record(1), record(2), record(3))))
        val loaded = store(dir).load()!!
        assertEquals(2L, loaded.cut)
        assertEquals(listOf(0, 1, 2, 3), seqs(loaded.records))
    }

    @Test fun `an oversize window keeps its newest records and cut with hasMore forced`() {
        val dir = directory()
        val wide = NativeJournalWindow("session", address(), 4, false, (0..4).map(::record))
        store(dir, maxBytes = wide.records.sumOf { it.toJsonElement().toString().length + 40 }).save(wide)
        val loaded = store(dir).load()!!
        assertTrue(loaded.records.size in 1..5)
        assertEquals(4, seqs(loaded.records).last())
        assertEquals(4L, loaded.cut)
        if (loaded.records.size < 5) assertTrue(loaded.hasMore)
    }

    @Test fun `unreadable bytes quarantine beside their file and read as absent`() {
        val dir = directory()
        val journal = dir.resolve(fileName())
        Files.createDirectories(dir.toPath())
        Files.write(journal.toPath(), "not a sealed journal".toByteArray())
        assertNull(store(dir).load())
        assertEquals(1, Files.list(dir.toPath()).use { stream -> stream.filter { it.fileName.toString().contains("unavailable") }.count() })
        Files.write(journal.toPath(), ByteArray(0))
        assertNull(store(dir).load())
    }

    @Test fun `a foreign principal never reads another device's window`() {
        val dir = directory()
        store(dir).save(window(listOf(0, 1)))
        assertNull(store(dir, who = CompanionInputPrincipal("other", "fingerprint", "device")).load())
    }

    @Test fun `installing a persisted window rejects foreign sessions and addresses`() = runTest {
        val journal = NativeSessionJournal(FakeWire(), backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, _, _ -> }
        journal.reset(1, "session", address())
        assertFailsWith<IllegalStateException> { journal.installPersisted(1, "session", address(), window(listOf(0), id = "other")) }
        val other = value("""{"kind":"session","sessionId":"session","extra":true}""") as WireValue.ObjectValue
        assertFailsWith<IllegalStateException> { journal.installPersisted(1, "session", address(), NativeJournalWindow("session", other, 0, false, listOf(record(0)))) }
        assertFailsWith<LinkClientException.BadWire> { journal.installPersisted(1, "session", address(), NativeJournalWindow("session", address(), 1, false, listOf(record(0), record(2)))) }
    }

    @Test fun `a restarted process seeds its session window and resumes with fromSeq`() = runTest {
        val requests = mutableListOf<Map<String, WireValue>>()
        val source = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected mutation $method")
            override fun stream(endpoint: String, payload: Map<String, WireValue>) = flow {
                requests.add(payload)
                when (requests.size) {
                    1 -> { emit(snapshot(0, 2)); emit(value(event(3))); awaitCancellation() }
                    else -> { emit(snapshot(3, 5)); awaitCancellation() }
                }
            }
        }
        val dir = directory()
        val store = store(dir)
        val first = SessionModel(source, backgroundScope, reconnectDelayMillis = 10, journalStore = store)
        first.openSession("session"); runCurrent()
        assertEquals((0L..3L).toList(), first.state.items.map { it.seq })
        first.closeAndAwait()
        // The final checkpoint carries the live window: records 0..3 over snapshot cut 2.
        val persisted = store.load()!!
        assertEquals(listOf(0, 1, 2, 3), seqs(persisted.records))
        assertEquals(2L, persisted.cut)

        val second = SessionModel(source, backgroundScope, reconnectDelayMillis = 10, journalStore = store)
        second.openSession("session"); runCurrent()
        assertEquals(3.0, WireShape.number(requests.last().getValue("request"), "fromSeq"))
        assertEquals((0L..5L).toList(), second.state.items.map { it.seq })
        second.closeAndAwait()
    }

    @Test fun `a subagent address never seeds a session window`() = runTest {
        val requests = mutableListOf<Map<String, WireValue>>()
        val source = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected mutation $method")
            override fun stream(endpoint: String, payload: Map<String, WireValue>) = flow {
                requests.add(payload)
                emit(value("""{"type":"snapshot","header":{"id":"child"},"cursor":0,"hasMore":false,"records":[${event(0)}]}"""))
                awaitCancellation()
            }
        }
        val dir = directory()
        val store = store(dir)
        store.save(window(listOf(0, 1)))
        val model = SessionModel(source, backgroundScope, reconnectDelayMillis = 10, journalStore = store)
        model.openChild("parent", "child", "timeline"); runCurrent()
        assertNull(WireShape.number(requests.single().getValue("request"), "fromSeq"))
        model.closeAndAwait()
    }

    private fun fileName(): String {
        val json = buildJsonObject {
            put("hostId", principal.hostId); put("fingerprint", principal.fingerprint); put("deviceId", principal.deviceId)
        }
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(json.toString().toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it.toInt() and 255) } + ".journal"
    }
}
