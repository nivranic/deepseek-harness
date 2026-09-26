package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class SessionListRecoveryTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))

    @Test fun `known and unknown Host refusals retain their complete envelope`() = runTest {
        for (code in listOf("gateway/permission-denied", "future/list-refusal")) {
            val details = value("""{"reason":"fixture"}""")
            val wire = FakeWire()
            wire.stub("session/list") { throw LinkClientException.Refused(code, "Host detail", details) }
            val model = SessionModel(wire, backgroundScope)
            model.loadSessions()
            val failed = assertIs<SessionListState.Failed>(model.listState.value)
            assertEquals(ConnectionFailure.REFUSED, failed.category)
            assertEquals(GatewayFailureEnvelope(code, "Host detail", details), failed.refusal)
            advanceTimeBy(10_000)
            assertEquals(1, wire.calls.size)
        }
    }

    @Test fun `transport failure retains rows until an explicit read replaces them`() = runTest {
        val wire = FakeWire()
        wire.stubSequence("session/list", listOf(
            { value("""{"items":[{"sessionId":"first","title":"First"}]}""") },
            { throw LinkClientException.Carrier(0, "private transport detail") },
            { value("""{"items":[{"sessionId":"second","title":"Second"}]}""") },
        ))
        val model = SessionModel(wire, backgroundScope)
        model.loadSessions(); model.loadSessions()
        assertEquals(SessionListState.Failed(ConnectionFailure.TRANSPORT, null), model.listState.value)
        assertEquals("first", model.sessions.value.single().id)
        advanceTimeBy(10_000)
        assertEquals(2, wire.calls.size)
        model.loadSessions()
        assertEquals(SessionListState.Ready, model.listState.value)
        assertEquals("second", model.sessions.value.single().id)
    }

    @Test fun `cancellation drains the first read before a queued read starts`() = runTest {
        val entered = CompletableDeferred<Unit>()
        val cleaning = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val wire = FakeWire()
        wire.stubSequence("session/list", listOf(
            {
                entered.complete(Unit)
                try { awaitCancellation() }
                finally { withContext(NonCancellable) { cleaning.complete(Unit); release.await() } }
            },
            { value("""{"items":[]}""") },
        ))
        val model = SessionModel(wire, backgroundScope)
        val first = async { model.loadSessions() }
        runCurrent(); assertTrue(entered.isCompleted)
        val second = async { model.loadSessions() }
        first.cancel(); runCurrent()
        assertTrue(cleaning.isCompleted); assertFalse(second.isCompleted)
        assertEquals(1, wire.calls.size)
        release.complete(Unit)
        first.join(); second.await()
        assertEquals(SessionListState.Ready, model.listState.value)
        assertEquals(2, wire.calls.size)
    }

    @Test fun `cancelled read returns to idle without retaining an error`() = runTest {
        val wire = FakeWire()
        wire.stub("session/list") { awaitCancellation() }
        val model = SessionModel(wire, backgroundScope)
        val loading = async { model.loadSessions() }
        runCurrent(); assertEquals(SessionListState.Loading, model.listState.value)
        loading.cancelAndJoin()
        assertEquals(SessionListState.Idle, model.listState.value)
    }
}
