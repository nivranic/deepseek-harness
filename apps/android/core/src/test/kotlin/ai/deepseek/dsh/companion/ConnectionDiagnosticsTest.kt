package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class ConnectionDiagnosticsTest {
    private fun wire(stream: () -> Flow<WireValue>) = object : WireDriving {
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected I/O")
        override fun stream(endpoint: String, payload: Map<String, WireValue>) = stream()
    }

    @Test fun sessionOpensOnlyAfterAFrameAndRetainsRetryFailureUntilRecovery() = runTest {
        val first = CompletableDeferred<Unit>()
        val fail = CompletableDeferred<Unit>()
        val recovered = CompletableDeferred<Unit>()
        var calls = 0
        val wire = wire { flow {
            if (++calls == 1) {
                first.await()
                emit(WireValue.NullValue)
                fail.await()
                throw IOException("private transport address")
            }
            recovered.await()
            emit(WireValue.NullValue)
            awaitCancellation()
        } }
        val model = SessionModel(wire, backgroundScope, reconnectDelayMillis = 100)
        assertEquals(ConnectionState.IDLE, model.connectionSnapshot.state)
        model.openSession("private-session-id")
        runCurrent()
        assertEquals(ConnectionSnapshot(ConnectionState.OPENING, 1, 0, null), model.connectionSnapshot)
        first.complete(Unit); runCurrent()
        assertEquals(ConnectionState.OPEN, model.connectionSnapshot.state)
        fail.complete(Unit); runCurrent()
        assertEquals(ConnectionSnapshot(ConnectionState.RECONNECTING, 1, 1, ConnectionFailure.TRANSPORT), model.connectionSnapshot)
        advanceTimeBy(100); runCurrent()
        assertEquals(2L, model.connectionSnapshot.attempts)
        assertEquals(ConnectionState.RECONNECTING, model.connectionSnapshot.state)
        recovered.complete(Unit); runCurrent()
        assertEquals(ConnectionSnapshot(ConnectionState.OPEN, 2, 1, null), model.connectionSnapshot)
        model.closeAndAwait()
        assertEquals(ConnectionState.STOPPED, model.connectionSnapshot.state)
    }

    @Test fun interactionEofRetriesAndRefusalHasAFixedCategory() = runTest {
        var calls = 0
        val model = InteractionModel(wire { flow {
            if (++calls > 1) throw LinkClientException.Refused("private-code", "private message")
        } }, backgroundScope, reconnectDelayMillis = 100)
        model.startWatching(); runCurrent()
        assertEquals(ConnectionSnapshot(ConnectionState.RECONNECTING, 1, 1, null), model.connectionSnapshot)
        advanceTimeBy(100); runCurrent()
        assertEquals(ConnectionSnapshot(ConnectionState.RECONNECTING, 2, 2, ConnectionFailure.REFUSED), model.connectionSnapshot)
        model.stopWatchingAndAwait()
    }

    @Test fun filesAndPushesEndWithoutInventingAutomaticRetries() = runTest {
        val first = CompletableDeferred<Unit>()
        val end = CompletableDeferred<Unit>()
        val source = wire { flow {
            first.await(); emit(WireValue.NullValue)
            end.await(); throw LinkClientException.BadWire("private frame")
        } }
        val files = FilesModel(source, backgroundScope)
        val pushes = PushModel(source, backgroundScope)
        files.start(); pushes.startWatching(); runCurrent()
        assertEquals(ConnectionState.OPENING, files.connectionSnapshot.state)
        assertEquals(ConnectionState.OPENING, pushes.connectionSnapshot.state)
        first.complete(Unit); runCurrent()
        assertEquals(ConnectionState.OPEN, files.connectionSnapshot.state)
        assertEquals(ConnectionState.OPEN, pushes.connectionSnapshot.state)
        end.complete(Unit); runCurrent(); advanceTimeBy(10_000); runCurrent()
        val expected = ConnectionSnapshot(ConnectionState.ENDED, 1, 1, ConnectionFailure.INVALID_RESPONSE)
        assertEquals(expected, files.connectionSnapshot)
        assertEquals(expected, pushes.connectionSnapshot)
        files.stopAndAwait(); pushes.stopWatchingAndAwait()
        assertEquals(ConnectionState.STOPPED, files.connectionSnapshot.state)
        assertEquals(ConnectionState.STOPPED, pushes.connectionSnapshot.state)
    }

    @Test fun filesAndPushReplacementWaitsForRetiredFramesAndStopWaitsForCleanup() = runTest {
        for (push in listOf(false, true)) {
            val cleanup = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            var calls = 0
            // Direct collection allows an already queued frame to arrive after cancellation.
            val source = wire { object : Flow<WireValue> {
                override suspend fun collect(collector: FlowCollector<WireValue>) {
                    calls++
                    try { awaitCancellation() } finally {
                        withContext(NonCancellable) {
                            cleanup.complete(Unit); release.await()
                            collector.emit(WireValue.ObjectValue(mapOf(
                                "event" to WireValue.StringValue("approval/request"),
                                "sessionId" to WireValue.StringValue("private-session"),
                                "eventId" to WireValue.StringValue("private-event"),
                                "records" to WireValue.ArrayValue(listOf(WireValue.ObjectValue(mapOf("id" to WireValue.StringValue("private-workspace"))))),
                            )))
                        }
                    }
                }
            } }
            val files = FilesModel(source, backgroundScope)
            val pushes = PushModel(source, backgroundScope)
            fun start() { if (push) pushes.startWatching() else files.start() }
            fun snapshot() = if (push) pushes.connectionSnapshot else files.connectionSnapshot
            start(); runCurrent(); start(); runCurrent()
            assertTrue(cleanup.isCompleted)
            assertEquals(ConnectionState.OPENING, snapshot().state)
            assertEquals(1, calls)
            val stopped = async { if (push) pushes.stopWatchingAndAwait() else files.stopAndAwait() }
            runCurrent()
            assertFalse(stopped.isCompleted)
            assertEquals(ConnectionState.STOPPING, snapshot().state)
            release.complete(Unit); stopped.await(); runCurrent()
            assertEquals(ConnectionSnapshot(ConnectionState.STOPPED, 1, 0, null), snapshot())
            assertEquals(1, calls)
            assertTrue(files.workspaces.value.isEmpty())
            assertTrue(pushes.pushes.value.isEmpty())
        }
    }

    @Test fun oldObservationCannotChangeReplacementAndSynchronousStopSettles() = runTest {
        val owner = StreamTransitionOwner(backgroundScope)
        val release = CompletableDeferred<Unit>()
        var old = -1L
        var latest = -1L
        owner.replace(create = { generation ->
            old = generation
            backgroundScope.launch(start = CoroutineStart.LAZY) {
                try { awaitCancellation() } finally { withContext(NonCancellable) { release.await() } }
            }
        }, publish = {}, invalidate = {})
        runCurrent()
        owner.attempt(old); owner.received(old)
        owner.replaceAsync(create = { generation ->
            latest = generation
            backgroundScope.launch(start = CoroutineStart.LAZY) { awaitCancellation() }
        }, publish = {}, invalidate = {})
        runCurrent()
        owner.received(old); owner.interrupted(old, IOException()); owner.retrying(old); owner.attempt(old)
        assertEquals(ConnectionSnapshot(ConnectionState.OPENING, 1, 0, null), owner.connectionSnapshot)
        release.complete(Unit); runCurrent()
        owner.attempt(latest); owner.received(latest)
        assertEquals(ConnectionSnapshot(ConnectionState.OPEN, 2, 0, null), owner.connectionSnapshot)
        owner.stop {}; runCurrent()
        assertEquals(ConnectionState.STOPPED, owner.connectionSnapshot.state)
    }

    @Test fun cancelledScopeCannotLeaveAnUnstartedOwnerOpening() = runTest {
        val parent = Job()
        val scope = CoroutineScope(coroutineContext + parent)
        scope.cancel()
        val files = FilesModel(wire { error("must not subscribe") }, scope)
        val session = SessionModel(wire { error("must not subscribe") }, scope)
        files.start(); session.openSession("unstarted"); runCurrent()
        assertEquals(ConnectionSnapshot(ConnectionState.ENDED, 0, 0, null), files.connectionSnapshot)
        assertEquals(ConnectionSnapshot(ConnectionState.ENDED, 0, 0, null), session.connectionSnapshot)
        files.stopAndAwait(); session.closeAndAwait()
        assertEquals(ConnectionState.STOPPED, files.connectionSnapshot.state)
    }

    @Test fun failureCategoriesDiscardExceptionContent() {
        val failures = listOf(
            LinkClientException.Unpaired() to ConnectionFailure.UNPAIRED,
            LinkClientException.Refused("private", "private") to ConnectionFailure.REFUSED,
            LinkClientException.Carrier(502, "private") to ConnectionFailure.TRANSPORT,
            IOException("private") to ConnectionFailure.TRANSPORT,
            LinkClientException.BadWire("private") to ConnectionFailure.INVALID_RESPONSE,
            kotlinx.coroutines.CancellationException("private") to ConnectionFailure.CANCELLED,
            IllegalStateException("private") to ConnectionFailure.INTERNAL,
        )
        failures.forEach { (error, expected) -> assertEquals(expected, ConnectionFailure.from(error)) }
    }
}
