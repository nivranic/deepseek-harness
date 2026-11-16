package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class CompanionHostControllerTest {
    private class Store : NativeHostStoring {
        var catalog: NativeHostCatalog? = null
        var failLoad = false
        var failSave = false
        var saves = 0
        var onSave: () -> Unit = {}
        override fun load(): NativeHostCatalog? { check(!failLoad); return catalog }
        override fun save(catalog: NativeHostCatalog) { check(!failSave); this.catalog = catalog; saves++; onSave() }
        override fun preserveAndStartFresh() { save(NativeHostCatalog()); failLoad = false }
    }
    private class InputStore : CompanionInputStoring {
        var snapshot: CompanionInputSnapshot? = null
        var failSave = false
        override fun load() = snapshot
        override fun save(snapshot: CompanionInputSnapshot) { check(!failSave); this.snapshot = snapshot }
        override fun preserveAndStartFresh() { snapshot = CompanionInputSnapshot() }
    }
    private class Wire(val id: String) : WireDriving {
        var closes = 0
        var failClose = false
        var gate: CompletableDeferred<Unit>? = null
        val calls = mutableListOf<String>()
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
            check(closes == 0)
            calls.add(method)
            return WireValue.StringValue(id)
        }
        override fun stream(endpoint: String, payload: Map<String, WireValue>) = emptyFlow<WireValue>()
        override suspend fun closeAndAwait() { closes++; gate?.await(); check(!failClose) }
    }
    private class Fixture(val scope: TestScope) {
        val store = Store()
        val wires = mutableListOf<Wire>()
        val inputStores = mutableMapOf<Triple<String, String, String>, InputStore>()
        var prepare: suspend () -> Unit = {}
        val controller = CompanionHostController(store, { credentials -> Wire(credentials.hostId).also { wires.add(it) } },
            { credentials ->
                prepare()
                CompanionInputState.restore(inputStores.getOrPut(Triple(credentials.hostId, credentials.pinnedFingerprint,
                    credentials.deviceId)) { InputStore() }, scope.backgroundScope, StandardTestDispatcher(scope.testScheduler))
            }, StandardTestDispatcher(scope.testScheduler))
        suspend fun pair(credentials: LinkCredentials) = Wire(credentials.hostId).also {
            wires.add(it); controller.remember(credentials, it)
        }
    }

    @Test fun `two Hosts retain independent drafts answers and pending prompt identities for the same Session`() = runTest {
        val f = Fixture(this)
        f.controller.restore()
        val a = hostCredentials()
        val b = hostCredentials("host-b")
        f.pair(a)
        val draft = SessionDraft("unsent A", "request-a")
        val snapshot = CompanionInputSnapshot(mapOf("session" to draft), mapOf("request-a" to PendingPrompt("session", draft)),
            mapOf(QuestionDraftKey("session", "question", 1) to listOf(CompanionQuestionAnswer("q", listOf("A"), "custom A"))), "session")
        f.controller.inputs.update { snapshot }
        f.pair(b)
        assertEquals(CompanionInputSnapshot(), f.controller.inputs.state.value)
        f.controller.inputs.update { it.copy(drafts = mapOf("session" to SessionDraft("unsent B", "request-b"))) }
        f.controller.select(nativeHostKey(a))
        assertEquals(snapshot, f.controller.inputs.state.value)
        assertEquals("host-a", f.controller.state.value.selected!!.hostId)
        assertEquals(WireValue.StringValue("host-a"), f.controller.wire.call("observe"))
        f.controller.select(nativeHostKey(b))
        assertEquals("unsent B", f.controller.inputs.state.value.drafts["session"]!!.text)
        assertTrue(f.wires.flatMap { it.calls }.all { it == "observe" })
        assertEquals(2, f.store.catalog!!.hosts.size)
        f.controller.closeAndAwait()
    }

    @Test fun `failed catalog save retains old transport input and durable selection and retires candidate`() = runTest {
        val f = Fixture(this)
        f.controller.restore(); val old = f.pair(hostCredentials())
        val oldInput = f.controller.inputs
        f.store.failSave = true
        val candidate = Wire("host-b")
        assertFailsWith<NativeHostException> { f.controller.remember(hostCredentials("host-b"), candidate) }
        assertEquals(1, candidate.closes)
        assertEquals(0, old.closes)
        assertSame(oldInput, f.controller.inputs)
        assertEquals(nativeHostKey(hostCredentials()), f.store.catalog!!.active)
        assertEquals(NativeHostStatus.READY, f.controller.state.value.status)
        assertEquals(WireValue.StringValue("host-a"), f.controller.wire.call("observe"))
        f.controller.closeAndAwait()
    }

    @Test fun `unsaved old edits reject switching before replacing any identity`() = runTest {
        val f = Fixture(this)
        f.controller.restore(); f.pair(hostCredentials())
        f.inputStores.values.single().failSave = true
        f.controller.inputs.update { it.copy(lastSessionId = "unsaved") }
        val candidate = Wire("host-b")
        assertFailsWith<NativeHostException> { f.controller.remember(hostCredentials("host-b"), candidate) }
        assertEquals(1, f.store.saves)
        assertEquals(1, candidate.closes)
        assertEquals("host-a", f.controller.state.value.selected!!.hostId)
        f.controller.closeAndAwait()
    }

    @Test fun `cancellation during preparation retires candidate without persisting selection`() = runTest {
        val f = Fixture(this)
        f.controller.restore(); f.pair(hostCredentials())
        f.prepare = { awaitCancellation() }
        val candidate = Wire("host-b")
        val task = launch { f.controller.remember(hostCredentials("host-b"), candidate) }
        runCurrent()
        assertEquals(NativeHostStatus.SWITCHING, f.controller.state.value.status)
        task.cancelAndJoin()
        assertEquals(1, candidate.closes)
        assertEquals(1, f.store.saves)
        assertEquals(NativeHostStatus.READY, f.controller.state.value.status)
        f.controller.closeAndAwait()
    }

    @Test fun `cancellation at durable commit still adopts and waits for old transport retirement`() = runTest {
        val f = Fixture(this)
        f.controller.restore(); val old = f.pair(hostCredentials())
        val gate = CompletableDeferred<Unit>()
        old.gate = gate
        val candidate = Wire("host-b")
        val task = launch(start = CoroutineStart.LAZY) { f.controller.remember(hostCredentials("host-b"), candidate) }
        f.store.onSave = { task.cancel() }
        task.start(); runCurrent()
        assertFalse(task.isCompleted)
        assertEquals(nativeHostKey(hostCredentials("host-b")), f.store.catalog!!.active)
        assertEquals(NativeHostStatus.SWITCHING, f.controller.state.value.status)
        gate.complete(Unit); task.join()
        assertEquals(NativeHostStatus.READY, f.controller.state.value.status)
        assertEquals("host-b", f.controller.state.value.selected!!.hostId)
        assertEquals(0, candidate.closes)
        assertEquals(1, old.closes)
        f.controller.closeAndAwait()
    }

    @Test fun `post commit retirement failure exposes committed identity as unavailable`() = runTest {
        val f = Fixture(this)
        f.controller.restore(); val old = f.pair(hostCredentials())
        old.failClose = true
        assertFailsWith<NativeHostException> { f.pair(hostCredentials("host-b")) }
        assertEquals(NativeHostStatus.RETIREMENT_FAILED, f.controller.state.value.status)
        assertEquals("host-b", f.controller.state.value.selected!!.hostId)
        assertEquals(f.store.catalog!!.active, f.controller.state.value.active)
        assertFails { f.controller.select(nativeHostKey(hostCredentials())) }
        f.controller.closeAndAwait()
    }

    @Test fun `restart restores selected grant without saving or sending and corrupt catalog requires explicit recovery`() = runTest {
        val f = Fixture(this)
        f.store.catalog = NativeHostCatalog().remember(hostCredentials()).remember(hostCredentials("host-b"))
        f.controller.restore()
        assertEquals("host-b", f.controller.state.value.selected!!.hostId)
        assertEquals(0, f.store.saves)
        assertTrue(f.wires.single().calls.isEmpty())
        f.controller.closeAndAwait()
        val broken = Fixture(this)
        broken.store.failLoad = true
        broken.controller.restore()
        assertEquals(NativeHostStatus.RESTORE_FAILED, broken.controller.state.value.status)
        val refused = Wire("refused")
        assertFails { broken.controller.remember(hostCredentials(), refused) }
        assertEquals(1, refused.closes)
        assertEquals(0, broken.store.saves)
        broken.controller.startFresh()
        assertEquals(NativeHostStatus.EMPTY, broken.controller.state.value.status)
        broken.pair(hostCredentials())
        broken.controller.closeAndAwait()
    }

    @Test fun `a closed owner rejects new clients and retires their resources`() = runTest {
        val f = Fixture(this)
        f.controller.restore(); f.controller.closeAndAwait()
        val candidate = Wire("host-a")
        assertFails { f.controller.remember(hostCredentials(), candidate) }
        assertEquals(1, candidate.closes)
        assertEquals(0, f.store.saves)
    }
}
