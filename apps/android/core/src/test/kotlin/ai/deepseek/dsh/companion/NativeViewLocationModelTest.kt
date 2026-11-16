package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeViewLocationModelTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun record(seq: Int) = """{"type":"event","event":{"seq":$seq,"type":"user/message","data":{"content":[{"type":"text","text":"text-$seq"}]}}}"""

    @Test fun `shared location reveals an older anchor without changing retained input or sending a prompt`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        inputs.update { it.copy(drafts = mapOf("session" to SessionDraft("keep my draft", "intent"))) }
        wire.stub("session/page") { value("""{"hasMore":false,"records":[${record(0)},${record(1)}]}""") }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        val opening = async { model.openViewLocation(NativeViewLocation("host", "session", 0), "host") }
        runCurrent()
        wire.emit(value("""{"type":"snapshot","header":{"id":"session"},"cursor":3,"hasMore":true,"records":[${record(2)},${record(3)}]}"""))
        opening.await()
        assertEquals(0L, model.viewAnchor.value?.seq)
        assertEquals(listOf(0L, 1L, 2L, 3L), model.state.items.map { it.seq })
        assertEquals("keep my draft", inputs.state.value.drafts["session"]!!.text)
        assertEquals(listOf("session/page"), wire.calls.map { it.first })
        model.closeAndAwait()
    }

    @Test fun `wrong or missing Host rejects without reading or changing the current selection and input`() = runTest {
        val wire = FakeWire()
        var streams = 0
        val observed = object : WireDriving by wire {
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> {
                streams++
                return wire.stream(endpoint, payload)
            }
        }
        val inputs = CompanionInputState.memory()
        val draft = SessionDraft("keep input", "intent")
        inputs.update { it.copy(drafts = mapOf("old" to draft), pendingPrompts = mapOf("intent" to PendingPrompt("old", draft))) }
        val model = SessionModel(observed, backgroundScope, inputs = inputs)
        model.openSession("old")
        runCurrent()
        val retained = inputs.state.value
        val generation = model.selectionGeneration
        assertEquals(1, streams)
        for (selectedHost in listOf("host", null)) assertFailsWith<IllegalArgumentException> {
            model.openViewLocation(NativeViewLocation("other", "target", 0), selectedHost)
        }
        assertEquals("old", model.open.value!!.sessionId)
        assertEquals(generation, model.selectionGeneration)
        assertEquals(retained, inputs.state.value)
        assertEquals(1, streams)
        assertTrue(wire.calls.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `closing while waiting for the first snapshot cancels the jump without rolling back last Session`() = runTest {
        val inputs = CompanionInputState.memory()
        inputs.update { it.copy(lastSessionId = "old") }
        val model = SessionModel(FakeWire(), backgroundScope, inputs = inputs)
        val opening = async { model.openViewLocation(NativeViewLocation("host", "session", 0), "host") }
        runCurrent()
        assertEquals("session", inputs.state.value.lastSessionId)
        model.closeAndAwait()
        assertFailsWith<CancellationException> { opening.await() }
        assertNull(model.open.value)
        assertNull(model.viewAnchor.value)
        assertEquals("session", inputs.state.value.lastSessionId)
    }

    @Test fun `caller cancellation keeps the selected Session observing without revealing an anchor`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val retained = CompanionInputSnapshot(drafts = mapOf("old" to SessionDraft("keep", "intent")), lastSessionId = "old")
        inputs.update { retained }
        val model = SessionModel(wire, backgroundScope, inputs = inputs)
        val opening = async { model.openViewLocation(NativeViewLocation("host", "target", 0), "host") }
        runCurrent()
        opening.cancelAndJoin()
        assertFailsWith<CancellationException> { opening.await() }
        assertEquals("target", model.open.value?.sessionId)
        assertEquals(retained.copy(lastSessionId = "target"), inputs.state.value)
        wire.emit(value("""{"type":"snapshot","header":{"id":"target"},"cursor":0,"hasMore":false,"records":[${record(0)}]}"""))
        runCurrent()
        assertEquals(listOf(0L), model.state.items.map { it.seq })
        assertNull(model.viewAnchor.value)
        assertTrue(wire.calls.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `an unavailable anchor retains the target selection and input without submitting a prompt`() = runTest {
        val wire = FakeWire()
        val inputs = CompanionInputState.memory()
        val retained = CompanionInputSnapshot(drafts = mapOf("target" to SessionDraft("keep", "intent")), lastSessionId = "old")
        inputs.update { retained }
        val navigationOwner = SupervisorJob(backgroundScope.coroutineContext[Job])
        val model = SessionModel(wire, CoroutineScope(backgroundScope.coroutineContext + navigationOwner), inputs = inputs)
        try {
            val opening = async { runCatching { model.openViewLocation(NativeViewLocation("host", "target", 1), "host") } }
            runCurrent()
            wire.emit(value("""{"type":"snapshot","header":{"id":"target"},"cursor":0,"hasMore":false,"records":[${record(0)}]}"""))
            assertIs<LinkClientException.BadWire>(opening.await().exceptionOrNull())
            assertEquals("target", model.open.value?.sessionId)
            assertEquals(retained.copy(lastSessionId = "target"), inputs.state.value)
            assertNull(model.viewAnchor.value)
            assertTrue(wire.calls.isEmpty())
        } finally {
            model.closeAndAwait()
            navigationOwner.cancelAndJoin()
        }
    }

    @Test fun `model retirement waits for cancelled page cleanup before returning`() = runTest {
        val wire = FakeWire()
        val release = CompletableDeferred<Unit>()
        wire.stub("session/page") {
            withContext(NonCancellable) { release.await() }
            value("""{"hasMore":false,"records":[${record(0)},${record(1)}]}""")
        }
        val model = SessionModel(wire, backgroundScope)
        model.openSession("session"); runCurrent()
        wire.emit(value("""{"type":"snapshot","header":{"id":"session"},"cursor":3,"hasMore":true,"records":[${record(2)},${record(3)}]}"""))
        val paging = async { model.loadOlderHistory() }; runCurrent()
        val closing = async { model.closeAndAwait() }; runCurrent()
        assertFalse(closing.isCompleted)
        release.complete(Unit); closing.await()
        assertFailsWith<CancellationException> { paging.await() }
        assertNull(model.open.value)
    }

    @Test fun `repeated navigation to the same anchor publishes a new reveal generation`() = runTest {
        val wire = FakeWire()
        wire.emit(value("""{"type":"snapshot","header":{"id":"session"},"cursor":0,"hasMore":false,"records":[${record(0)}]}"""))
        val model = SessionModel(wire, backgroundScope)
        val location = NativeViewLocation("host", "session", 0)
        model.openViewLocation(location, "host")
        val first = model.viewAnchor.value!!
        model.openViewLocation(location, "host")
        assertEquals(first.seq, model.viewAnchor.value!!.seq)
        assertNotEquals(first.generation, model.viewAnchor.value!!.generation)
        model.closeAndAwait()
    }
}
