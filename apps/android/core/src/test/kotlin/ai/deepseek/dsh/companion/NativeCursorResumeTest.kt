package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeCursorResumeTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun event(seq: Int, text: String = "row-$seq") = """{"type":"event","event":{"seq":$seq,"type":"user/message","data":{"content":[{"type":"text","text":"$text"}]}}}"""
    private fun snapshot(start: Int, end: Int, more: Boolean = start > 0, id: String = "session") = value(
        """{"type":"snapshot","header":{"id":"$id"},"cursor":$end,"hasMore":$more,"records":[${(start..end).joinToString(",", transform = ::event)}]}""")
    private fun address(id: String = "session") = value("""{"kind":"session","sessionId":"$id"}""") as WireValue.ObjectValue
    private fun seqs(rows: List<WireValue>) = rows.map { WireShape.number(WireShape.objectValue(it, "event")!!, "seq")!!.toInt() }

    @Test fun `delta retains backward pages and their hasMore while renewing the page cut`() = runTest {
        val wire = FakeWire()
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(wire, backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, rows, full -> shown = if (full) rows else shown + rows }
        journal.reset(1, "session", address())
        assertNull(journal.beginFollow(1))
        journal.accept(snapshot(2, 3), 1)
        wire.stub("session/page") { value("""{"records":[${event(0)},${event(1)}],"hasMore":false}""") }
        assertTrue(journal.loadOlder())
        journal.accept(value(event(4)), 1)
        assertEquals(4L, journal.beginFollow(1))
        journal.accept(snapshot(5, 6), 1)
        assertEquals((0..6).toList(), seqs(shown))
        assertFalse(journal.state.value.hasMore)
        assertFalse(journal.loadOlder())

        journal.reset(2, "session", address()); journal.accept(snapshot(4, 5), 2)
        assertEquals(5L, journal.beginFollow(2)); journal.accept(snapshot(6, 7), 2)
        wire.stub("session/page") { value("""{"records":[${event(2)},${event(3)}],"hasMore":true}""") }
        assertTrue(journal.loadOlder())
        assertEquals(7.0, WireShape.number(wire.calls.last().second.getValue("request"), "throughSeq"))
        assertEquals((2..7).toList(), seqs(shown))
    }

    @Test fun `overlapping full snapshots preserve an identical older prefix without duplicating rows`() = runTest {
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(FakeWire(), backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, rows, _ -> shown = rows }
        journal.reset(1, "session", address()); journal.accept(snapshot(0, 5), 1)
        journal.beginFollow(1); journal.accept(snapshot(4, 5), 1)
        assertEquals((0..5).toList(), seqs(shown)); assertFalse(journal.state.value.hasMore)
        journal.beginFollow(1); journal.accept(snapshot(3, 7), 1)
        assertEquals((0..7).toList(), seqs(shown)); assertFalse(journal.state.value.hasMore)
    }

    @Test fun `uncovered resume replaces the window without inventing missing events`() = runTest {
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(FakeWire(), backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, rows, _ -> shown = rows }
        journal.reset(1, "session", address()); journal.accept(snapshot(0, 2), 1)
        assertEquals(2L, journal.beginFollow(1)); journal.accept(snapshot(8, 10), 1)
        assertEquals(listOf(8, 9, 10), seqs(shown)); assertTrue(journal.state.value.hasMore)
        assertEquals(10L, journal.beginFollow(1))
    }

    @Test fun `invalid identity overlap rollback and first event leave the retained window unchanged`() = runTest {
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(FakeWire(), backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, rows, _ -> shown = rows }
        journal.reset(1, "session", address()); journal.accept(snapshot(0, 2), 1)
        val old = shown
        val contradictory = value("""{"type":"snapshot","header":{"id":"session"},"cursor":2,"hasMore":true,"records":[${event(2, "changed")}]}""")
        for (bad in listOf(snapshot(3, 4, id = "other"), snapshot(0, 1), contradictory, value(event(3)),
            value("""{"type":"snapshot","cursor":3,"hasMore":true,"records":[${event(3)}]}"""))) {
            assertEquals(2L, journal.beginFollow(1))
            assertFailsWith<LinkClientException.BadWire> { journal.accept(bad, 1) }
            assertEquals(old, shown)
        }
        journal.accept(snapshot(3, 4), 1)
        assertEquals((0..4).toList(), seqs(shown))
    }

    @Test fun `resume byte overflow preserves the complete previously retained window`() = runTest {
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(FakeWire(), backgroundScope, NativeHistoryLimits(2, event(0).length + 1)) { _, _, rows, _ -> shown = rows }
        journal.reset(1, "session", address()); journal.accept(snapshot(0, 0), 1)
        journal.beginFollow(1)
        assertFailsWith<LinkClientException.BadWire> { journal.accept(snapshot(1, 1), 1) }
        assertEquals(listOf(0), seqs(shown)); assertEquals(0L, journal.beginFollow(1))
    }

    @Test fun `delta cancels and retires old paging before a late noncancellable response can publish`() = runTest {
        val wire = FakeWire()
        val release = CompletableDeferred<Unit>()
        wire.stub("session/page") {
            withContext(NonCancellable) { release.await() }
            value("""{"records":[${event(0)},${event(1)}],"hasMore":false}""")
        }
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(wire, backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, rows, _ -> shown = rows }
        journal.reset(1, "session", address()); journal.accept(snapshot(2, 3), 1)
        val page = async { journal.loadOlder() }; runCurrent()
        journal.beginFollow(1); journal.accept(snapshot(4, 5), 1)
        val retired = journal.close()
        assertEquals(1, retired.size); assertFalse(retired.single().isCompleted)
        release.complete(Unit); retired.joinAll()
        assertFailsWith<CancellationException> { page.await() }
        assertEquals(listOf(2, 3, 4, 5), seqs(shown))
        assertNull(journal.beginFollow(1))
    }

    @Test fun `new owners and fresh models never inherit a cursor without its records`() = runTest {
        var shown = emptyList<WireValue>()
        val journal = NativeSessionJournal(FakeWire(), backgroundScope, NativeHistoryLimits(2, 65536)) { _, _, rows, _ -> shown = rows }
        journal.reset(1, "session", address()); journal.accept(snapshot(2, 3), 1)
        journal.reset(2, "other", address("other"))
        assertNull(journal.beginFollow(1)); assertNull(journal.beginFollow(2))
        journal.accept(snapshot(4, 5), 1)
        journal.accept(snapshot(0, 0, id = "other"), 2)
        assertEquals(listOf(0), seqs(shown))
        assertEquals(0L, journal.beginFollow(2))
    }

    @Test fun `Session follow retries use the held cursor and never submit retained input`() = runTest {
        val requests = mutableListOf<Map<String, WireValue>>()
        val source = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected mutation $method")
            override fun stream(endpoint: String, payload: Map<String, WireValue>) = flow {
                requests.add(payload)
                when (requests.size) {
                    1 -> emit(snapshot(0, 2))
                    2 -> { emit(snapshot(3, 4)); emit(value(event(5))) }
                    else -> { emit(snapshot(4, 5)); awaitCancellation() }
                }
            }
        }
        val inputs = CompanionInputState.memory()
        inputs.update { it.copy(drafts = mapOf("session" to SessionDraft("unsent", "intent"))) }
        val model = SessionModel(source, backgroundScope, reconnectDelayMillis = 10, inputs = inputs)
        model.openSession("session"); runCurrent()
        advanceTimeBy(10); runCurrent(); advanceTimeBy(10); runCurrent()
        assertEquals(listOf(null, 2.0, 5.0), requests.map { WireShape.number(it.getValue("request"), "fromSeq") })
        assertEquals((0L..5L).toList(), model.state.items.map { it.seq })
        assertEquals("unsent", model.input.value.drafts["session"]?.text)
        model.closeAndAwait()
        val fresh = SessionModel(source, backgroundScope)
        fresh.openSession("session"); runCurrent()
        assertNull(WireShape.number(requests.last().getValue("request"), "fromSeq"))
        fresh.closeAndAwait()
    }

    @Test fun `a wrong Session snapshot ends observation without reporting an open connection`() = runTest {
        var attempts = 0
        val source = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected mutation")
            override fun stream(endpoint: String, payload: Map<String, WireValue>) = flow {
                attempts++
                emit(snapshot(0, 0, id = "other"))
                awaitCancellation()
            }
        }
        val model = SessionModel(source, backgroundScope, reconnectDelayMillis = 10)
        model.openSession("session"); runCurrent(); advanceTimeBy(100); runCurrent()
        assertEquals(1, attempts)
        assertEquals(ConnectionState.ENDED, model.connectionSnapshot.state)
        assertEquals(ConnectionFailure.INVALID_RESPONSE, model.history.value.failure)
        assertFalse(model.history.value.ready)
        assertTrue(model.state.items.isEmpty())
        model.closeAndAwait()
    }
}
