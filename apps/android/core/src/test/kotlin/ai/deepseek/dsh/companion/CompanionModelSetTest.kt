package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class CompanionModelSetTest {
    @Test fun `retirement waits for a request started by a UI caller and refuses further dispatch`() = runTest {
        val entered = CompletableDeferred<Unit>()
        val cleanup = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var calls = 0
        var transportClosed = false
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
                calls++; entered.complete(Unit)
                try { awaitCancellation() }
                finally { withContext(NonCancellable) { cleanup.complete(Unit); release.await() } }
            }
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = error("unexpected stream")
            override fun close() { transportClosed = true }
        }
        val models = CompanionModelSet(wire, backgroundScope)
        val load = async { models.session.loadSessions() }
        runCurrent(); assertTrue(entered.isCompleted)
        val retiring = async { models.closeAndAwait() }
        runCurrent(); assertTrue(cleanup.isCompleted); assertFalse(retiring.isCompleted)
        release.complete(Unit); retiring.await(); load.await()
        models.session.loadSessions()
        assertEquals(1, calls)
        assertFalse(transportClosed)
    }

    @Test fun `retirement drains observation cleanup and replacement starts with empty state`() = runTest {
        val cleanup = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected mutation")
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
                try { awaitCancellation() }
                finally { withContext(NonCancellable) { cleanup.complete(Unit); release.await() } }
            }
        }
        val previous = CompanionModelSet(wire, backgroundScope)
        previous.session.openSession("previous-host-session"); runCurrent()
        assertNotNull(previous.session.open.value)
        val retiring = async { previous.closeAndAwait() }
        runCurrent(); assertTrue(cleanup.isCompleted); assertFalse(retiring.isCompleted)
        release.complete(Unit); retiring.await()
        assertNull(previous.session.open.value)
        val replacement = CompanionModelSet(FakeWire(), backgroundScope)
        assertNull(replacement.session.open.value)
        assertTrue(replacement.session.sessions.value.isEmpty())
        assertTrue(replacement.interactions.inbox.value.isEmpty())
        assertTrue(replacement.files.workspaces.value.isEmpty())
        assertTrue(replacement.pushes.pushes.value.isEmpty())
        replacement.closeAndAwait()
    }
}
