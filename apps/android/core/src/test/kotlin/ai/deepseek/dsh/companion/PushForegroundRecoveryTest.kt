package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import java.io.IOException
import java.security.cert.CertificateException
import javax.net.ssl.SSLPeerUnverifiedException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class PushForegroundRecoveryTest {
    private class Source(private val observe: suspend FlowCollector<WireValue>.(Int) -> Unit) : WireDriving {
        var subscriptions = 0
            private set

        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("observation must not mutate")
        override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
            assertEquals("\$events", endpoint)
            observe(++subscriptions)
        }
    }

    private fun approval(id: String) = WireValue.ObjectValue(mapOf(
        "type" to WireValue.StringValue("waterfall"),
        "event" to WireValue.StringValue("approval/request"),
        "agentId" to WireValue.StringValue("agent"),
        "eventId" to WireValue.StringValue(id),
        "interaction" to WireValue.ObjectValue(mapOf("sessionId" to WireValue.StringValue("session"))),
    ))

    @Test fun overlappingForegroundEntriesKeepTheOpeningAndHealthyStream() = runTest {
        val firstFrame = CompletableDeferred<Unit>()
        val source = Source { firstFrame.await(); emit(approval("first")); awaitCancellation() }
        val model = PushModel(source, backgroundScope)
        val entered = CompletableDeferred<Unit>()
        val callers = List(16) { async(Dispatchers.Default) { entered.await(); model.ensureWatching() } }
        entered.complete(Unit)
        callers.awaitAll()
        assertEquals(ConnectionState.OPENING, model.connectionSnapshot.state)
        repeat(16) { model.ensureWatching() }
        runCurrent()
        assertEquals(1, source.subscriptions)
        assertEquals(ConnectionSnapshot(ConnectionState.OPENING, 1, 0, null), model.connectionSnapshot)

        firstFrame.complete(Unit); runCurrent()
        repeat(16) { model.ensureWatching() }
        runCurrent()
        assertEquals(1, source.subscriptions)
        assertEquals(ConnectionState.OPEN, model.connectionSnapshot.state)
        model.stopWatchingAndAwait()
    }

    @Test fun eofAndTemporaryFailuresWaitForForegroundThenRecoverOnce() = runTest {
        for (failure in listOf(null, IOException("offline"), LinkClientException.Carrier(0, "interrupted"),
            LinkClientException.Refused("gateway/host-not-ready", "not ready"))) {
            val source = Source { attempt ->
                emit(approval("same"))
                if (attempt == 1) { if (failure != null) throw failure }
                else awaitCancellation()
            }
            val model = PushModel(source, backgroundScope)
            model.ensureWatching(); runCurrent()
            assertEquals(ConnectionSnapshot(ConnectionState.ENDED, 1, 1, failure?.let { ConnectionFailure.from(it) }), model.connectionSnapshot)
            assertEquals(listOf(CompanionPush.ApprovalWaiting("session", "same")), model.takePendingNotifications())
            advanceTimeBy(10_000); runCurrent()
            assertEquals(1, source.subscriptions)

            repeat(16) { model.ensureWatching() }
            runCurrent()
            assertEquals(2, source.subscriptions)
            assertEquals(ConnectionSnapshot(ConnectionState.OPEN, 2, 1, null), model.connectionSnapshot)
            assertEquals(1, model.pushes.value.size)
            assertTrue(model.takePendingNotifications().isEmpty())
            model.stopWatchingAndAwait()
        }
    }

    @Test fun permanentFailuresRemainEndedAcrossForegroundEntries() = runTest {
        val failures = listOf(
            LinkClientException.Refused("gateway/permission-denied", "denied"),
            LinkClientException.Refused("gateway/authentication-required", "authenticate"),
            LinkClientException.Refused("host/capability-unavailable", "unsupported"),
            LinkClientException.Refused("unknown-refusal", "unknown"),
            LinkClientException.Unpaired(),
            LinkClientException.BadWire("malformed"),
            IllegalStateException("invalid owner"),
            LinkClientException.Carrier(0, "certificate").apply { initCause(CertificateException("untrusted")) },
            IOException("TLS peer", SSLPeerUnverifiedException("mismatch")),
        )
        for (failure in failures) {
            val source = Source { throw failure }
            val model = PushModel(source, backgroundScope)
            model.ensureWatching(); runCurrent()
            repeat(16) { model.ensureWatching() }
            advanceTimeBy(10_000); runCurrent()
            assertEquals(1, source.subscriptions)
            assertEquals(ConnectionSnapshot(ConnectionState.ENDED, 1, 1, ConnectionFailure.from(failure)), model.connectionSnapshot)
            model.stopWatchingAndAwait()
        }
    }

    @Test fun cancellationDoesNotBecomeAnEofRecovery() = runTest {
        val source = Source { throw CancellationException("cancelled observation") }
        val model = PushModel(source, backgroundScope)
        model.ensureWatching(); runCurrent()
        repeat(16) { model.ensureWatching() }
        runCurrent()
        assertEquals(1, source.subscriptions)
        assertEquals(ConnectionSnapshot(ConnectionState.ENDED, 1, 0, null), model.connectionSnapshot)
        model.stopWatchingAndAwait()
    }

    @Test fun foregroundEntryWaitsUntilEofCleanupHasCompleted() = runTest {
        val finish = CompletableDeferred<Unit>()
        val cleanup = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val source = Source { attempt ->
            emit(approval("same"))
            if (attempt == 1) {
                try { finish.await() } finally {
                    withContext(NonCancellable) { cleanup.complete(Unit); release.await() }
                }
            } else awaitCancellation()
        }
        val model = PushModel(source, backgroundScope)
        model.ensureWatching(); runCurrent()
        finish.complete(Unit); runCurrent()
        assertTrue(cleanup.isCompleted)
        repeat(16) { model.ensureWatching() }
        runCurrent()
        assertEquals(1, source.subscriptions)
        assertEquals(ConnectionState.OPEN, model.connectionSnapshot.state)

        release.complete(Unit); runCurrent()
        assertEquals(ConnectionState.ENDED, model.connectionSnapshot.state)
        model.ensureWatching(); runCurrent()
        assertEquals(2, source.subscriptions)
        model.stopWatchingAndAwait()
    }

    @Test fun stopWaitsForCleanupAndRejectsItsLateFrameAndRecovery() = runTest {
        val cleanup = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var subscriptions = 0
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("observation must not mutate")
            override fun stream(endpoint: String, payload: Map<String, WireValue>) = object : Flow<WireValue> {
                override suspend fun collect(collector: FlowCollector<WireValue>) {
                    subscriptions++
                    collector.emit(approval("before-stop"))
                    try { awaitCancellation() } finally {
                        withContext(NonCancellable) {
                            cleanup.complete(Unit); release.await()
                            collector.emit(approval("late"))
                            throw IOException("late transport failure")
                        }
                    }
                }
            }
        }
        val model = PushModel(wire, backgroundScope)
        model.ensureWatching(); runCurrent()
        model.stopWatching()
        val stopped = async { model.stopWatchingAndAwait() }
        runCurrent()
        assertTrue(cleanup.isCompleted)
        assertFalse(stopped.isCompleted)
        assertEquals(ConnectionState.STOPPING, model.connectionSnapshot.state)
        repeat(16) { model.ensureWatching() }
        assertTrue(model.takePendingNotifications().isEmpty())

        release.complete(Unit); stopped.await(); runCurrent()
        repeat(16) { model.ensureWatching() }
        runCurrent()
        assertEquals(1, subscriptions)
        assertEquals(ConnectionSnapshot(ConnectionState.STOPPED, 1, 0, null), model.connectionSnapshot)
        assertEquals(listOf(CompanionPush.ApprovalWaiting("session", "before-stop")), model.pushes.value)
        assertTrue(model.takePendingNotifications().isEmpty())
    }

    @Test fun stopBeforeStartOrAfterRecoverableEofNeverReopens() = runTest {
        for (start in listOf(false, true)) {
            val source = Source { }
            val model = PushModel(source, backgroundScope)
            if (start) { model.ensureWatching(); runCurrent() }
            model.stopWatchingAndAwait()
            repeat(16) { model.ensureWatching() }
            runCurrent()
            assertEquals(if (start) 1 else 0, source.subscriptions)
            assertEquals(ConnectionState.STOPPED, model.connectionSnapshot.state)
        }
    }

    @Test fun aCancelledModelScopeCannotStartAnObservation() = runTest {
        val lifetime = Job()
        val scope = CoroutineScope(coroutineContext + lifetime)
        val source = Source { error("retired scope must not subscribe") }
        val model = PushModel(source, scope)
        scope.cancel()
        repeat(16) { model.ensureWatching() }
        runCurrent()
        assertEquals(0, source.subscriptions)
        assertEquals(ConnectionState.ENDED, model.connectionSnapshot.state)
        model.stopWatchingAndAwait()
    }

    @Test fun stopBeforeTheAdmittedJobRunsPreventsSubscription() = runTest {
        val source = Source { error("stopped admission must not subscribe") }
        val model = PushModel(source, backgroundScope)
        model.ensureWatching()
        model.stopWatching()
        repeat(16) { model.ensureWatching() }
        runCurrent()
        model.stopWatchingAndAwait()
        assertEquals(0, source.subscriptions)
        assertEquals(ConnectionSnapshot(ConnectionState.STOPPED, 0, 0, null), model.connectionSnapshot)
    }

    @Test fun recreatedAndConcurrentConsumersClaimEveryNewNotificationOnce() = runTest {
        val frames = Channel<WireValue>(Channel.UNLIMITED)
        val source = Source { for (frame in frames) emit(frame) }
        val model = PushModel(source, backgroundScope)
        model.ensureWatching()
        frames.send(approval("first")); frames.send(approval("second")); frames.send(approval("first"))
        runCurrent()
        val consumers = List(16) { async(Dispatchers.Default) { model.takePendingNotifications() } }
        assertEquals(listOf(CompanionPush.ApprovalWaiting("session", "first"),
            CompanionPush.ApprovalWaiting("session", "second")), consumers.awaitAll().flatten())
        assertTrue(model.takePendingNotifications().isEmpty())

        frames.send(approval("third")); runCurrent()
        assertEquals(listOf(CompanionPush.ApprovalWaiting("session", "third")), model.takePendingNotifications())
        assertTrue(model.takePendingNotifications().isEmpty())
        assertEquals(3, model.pushes.value.size)
        model.stopWatchingAndAwait()
        frames.close()
    }
}
