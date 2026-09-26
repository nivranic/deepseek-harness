package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
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

    @Test fun `wrong Host rejects before replacing the open Session or issuing a request`() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope)
        model.openSession("old")
        assertFailsWith<IllegalArgumentException> { model.openViewLocation(NativeViewLocation("other", "target", 0), "host") }
        assertEquals("old", model.open.value!!.sessionId)
        assertTrue(wire.calls.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `closing while waiting for the first snapshot cancels the pending jump`() = runTest {
        val model = SessionModel(FakeWire(), backgroundScope)
        val opening = async { model.openViewLocation(NativeViewLocation("host", "session", 0), "host") }
        runCurrent()
        model.closeAndAwait()
        assertFailsWith<CancellationException> { opening.await() }
        assertNull(model.open.value)
        assertNull(model.viewAnchor.value)
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
