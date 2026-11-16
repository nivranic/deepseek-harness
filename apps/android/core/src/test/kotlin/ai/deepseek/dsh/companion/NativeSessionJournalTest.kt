package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeSessionJournalTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun event(seq: Int) = """{"type":"event","event":{"seq":$seq,"type":"user/message","data":{"content":[{"type":"text","text":"message-$seq"}]}}}"""
    private fun snapshot(start: Int, end: Int, more: Boolean = start > 0, id: String = "session") = value(
        """{"type":"snapshot","header":{"id":"$id"},"cursor":$end,"hasMore":$more,"records":[${(start..end).joinToString(",", transform = ::event)}]}""")
    private fun page(start: Int, end: Int, more: Boolean = start > 0) = value(
        """{"hasMore":$more,"records":[${(start..end).joinToString(",", transform = ::event)}]}""")
    private fun address(id: String = "session") = value("""{"kind":"session","sessionId":"$id"}""") as WireValue.ObjectValue

    @Test fun `backward reads retain the opening cut while live events continue and concurrent readers share a call`() = runTest {
        val wire = FakeWire()
        val answer = CompletableDeferred<WireValue>()
        wire.stub("session/page") { answer.await() }
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(wire, backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, records, replacement -> shown = if (replacement) records else shown + records }
        journal.reset(1, "session", address()); journal.accept(snapshot(4, 5), 1)
        val first = async { journal.loadOlder() }
        val second = async { journal.loadOlder() }
        runCurrent()
        assertEquals(1, wire.calls.size)
        assertEquals(value("""{"address":{"kind":"session","sessionId":"session"},"throughSeq":5,"beforeSeq":4,"maxMessages":2}"""),
            wire.calls.single().second["request"])
        journal.accept(value(event(6)), 1)
        answer.complete(page(2, 3))
        assertTrue(first.await()); assertTrue(second.await())
        assertEquals((2..6).toList(), shown.map { WireShape.number(WireShape.objectValue(it, "event")!!, "seq")!!.toInt() })
        assertTrue(journal.state.value.hasMore)
        wire.stub("session/page") { page(0, 1) }
        assertTrue(journal.loadThrough(0))
        assertFalse(journal.state.value.hasMore)
        assertEquals(5.0, WireShape.number(wire.calls.last().second.getValue("request"), "throughSeq"))
        assertEquals(7, shown.size)
    }

    @Test fun `Session replacement cancels an owned read and discards a late noncancellable response`() = runTest {
        val wire = FakeWire()
        val answer = CompletableDeferred<WireValue>()
        wire.stub("session/page") { withContext(NonCancellable) { answer.await() } }
        val published = mutableListOf<Pair<String, Int>>()
        val journal = NativeSessionJournal(wire, backgroundScope, NativeHistoryLimits(2, 65536)) { _, id, rows, _ -> published.add(id to rows.size) }
        journal.reset(1, "old", address("old")); journal.accept(snapshot(4, 5, id = "old"), 1)
        val task = async { journal.loadOlder() }
        runCurrent()
        journal.reset(2, "new", address("new")); journal.accept(snapshot(0, 0, id = "new"), 2)
        answer.complete(page(2, 3)); runCurrent()
        assertFailsWith<CancellationException> { task.await() }
        assertEquals(listOf("old" to 2, "new" to 1), published)
        assertFalse(journal.state.value.loading)
        journal.close()
    }

    @Test fun `a reconnect snapshot cancels old paging even within the same Session`() = runTest {
        val wire = FakeWire()
        wire.stub("session/page") { awaitCancellation() }
        var shown = 0
        val journal = NativeSessionJournal(wire, backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, rows, _ -> shown = rows.size }
        journal.reset(1, "session", address()); journal.accept(snapshot(4, 5), 1)
        val task = async { journal.loadOlder() }; runCurrent()
        journal.accept(snapshot(0, 6), 1)
        assertFailsWith<CancellationException> { task.await() }
        assertEquals(7, shown)
        assertFalse(journal.state.value.loading)
    }

    @Test fun `failed and nonprogressing pages retain current rows and allow explicit retry`() = runTest {
        val wire = FakeWire()
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(wire, backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, rows, _ -> shown = rows }
        journal.reset(1, "session", address()); journal.accept(snapshot(2, 3), 1)
        val original = shown
        for (invalid in listOf(value("""{"records":[],"hasMore":true}"""), page(2, 3), page(0, 0),
            value("""{"records":[${event(0)},${event(2)}],"hasMore":false}"""))) {
            wire.stub("session/page") { invalid }
            assertFalse(journal.loadOlder())
            assertEquals(original, shown)
            assertNotNull(journal.state.value.failure)
            assertFalse(journal.state.value.loading)
        }
        wire.stub("session/page") { page(0, 1) }
        assertTrue(journal.loadOlder())
        assertNull(journal.state.value.failure)
        assertEquals(4, shown.size)
    }

    @Test fun `retained byte limit rejects an older page without dropping the live window`() = runTest {
        val wire = FakeWire()
        wire.stub("session/page") { page(0, 1) }
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(wire, backgroundScope, NativeHistoryLimits(2, event(2).length + event(3).length + 1)) {
            _, _, rows, _ -> shown = rows
        }
        journal.reset(1, "session", address()); journal.accept(snapshot(2, 3), 1)
        assertFalse(journal.loadThrough(0))
        assertEquals(2, shown.size)
        assertNotNull(journal.state.value.failure)
        assertTrue(journal.state.value.hasMore)
    }

    @Test fun `invalid follow records reject gaps unsafe cursors and missing metadata`() = runTest {
        val journal = NativeSessionJournal(FakeWire(), backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, _, _ -> }
        journal.reset(1, "session", address())
        assertFails { journal.accept(value(event(0)), 1) }
        assertFails { journal.accept(value("""{"type":"snapshot","cursor":1,"records":[]}"""), 1) }
        assertFails { journal.accept(value("""{"type":"snapshot","cursor":9007199254740992,"records":[],"hasMore":false}"""), 1) }
        journal.accept(snapshot(0, 1), 1)
        assertFails { journal.accept(value(event(3)), 1) }
        assertFalse(journal.loadThrough(2))
        assertFalse(journal.loadOlder())
    }
}
