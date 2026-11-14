package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeDescriptionState
import ai.deepseek.dsh.gateway.NativeGatewayDiagnosticSnapshot
import ai.deepseek.dsh.gateway.NativeObservedCapability
import ai.deepseek.dsh.gateway.NativeObservedRole
import ai.deepseek.dsh.gateway.NativeProtocolObservation
import ai.deepseek.dsh.link.WireValue
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.test.rule.GrantPermissionRule
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Installed observer results admit view links only after their own query completes successfully. */
class HostDescriptionViewLinkNativeTest {
    @get:Rule(order = 0) val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()

    private fun snapshot(version: Long? = 3, state: NativeDescriptionState = NativeDescriptionState.AVAILABLE) = NativeGatewayDiagnosticSnapshot(
        false, 0, 0, 0, 0, 0, NativeObservedRole.VIEWER, state, null,
        version?.let { NativeProtocolObservation(it, setOf(NativeObservedCapability.SESSION_FOLLOW)) },
    )

    private abstract class ObservedWire(initial: NativeGatewayDiagnosticSnapshot?) : WireDriving {
        @Volatile var current = initial
        override fun diagnosticSnapshot() = current?.let { WireDiagnosticSnapshot.Native(it) }
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected RPC")
        override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = error("unexpected stream")
    }

    private data class Frame(val epoch: Int, val observation: NativeHostObservation)
    private class ControlledLifecycle : LifecycleOwner {
        val registry = LifecycleRegistry(this)
        override val lifecycle: Lifecycle get() = registry
    }

    private fun observe(wire: WireDriving, epoch: State<Int> = mutableStateOf(0),
                        owner: LifecycleOwner? = null): CopyOnWriteArrayList<Frame> {
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("support-export").fetchSemanticsNodes(false).isNotEmpty() }
        val frames = CopyOnWriteArrayList<Frame>()
        compose.runOnUiThread { compose.activity.setContent {
            val lifecycleOwner = owner ?: LocalLifecycleOwner.current
            CompositionLocalProvider(LocalLifecycleOwner provides lifecycleOwner) {
                val currentEpoch = epoch.value
                val observation = HostDescriptionObserver(wire, true, generation = 7, refreshEpoch = currentEpoch)
                SideEffect { frames.add(Frame(currentEpoch, observation)) }
                Text(nativeViewLinkCapability(observation).name)
            }
        } }
        return frames
    }

    @Test fun sameGenerationRefreshEpochRejectsOldNonCancellableCompletion() {
        val starts = AtomicInteger()
        val oldCleanup = CompletableDeferred<Unit>()
        val oldRelease = CompletableDeferred<Unit>()
        val oldFinished = CompletableDeferred<Unit>()
        val epoch = mutableStateOf(0)
        val wire = object : ObservedWire(snapshot(3)) {
            override suspend fun refreshHostDescription() {
                if (starts.incrementAndGet() == 1) {
                    try { awaitCancellation() }
                    finally { withContext(NonCancellable) {
                        oldCleanup.complete(Unit)
                        oldRelease.await()
                        current = snapshot(88)
                        oldFinished.complete(Unit)
                    } }
                } else current = snapshot(99)
            }
        }
        try {
            val frames = observe(wire, epoch)
            compose.waitUntil(10_000) { starts.get() == 1 }
            compose.runOnUiThread { epoch.value = 1 }
            compose.waitUntil(10_000) { oldCleanup.isCompleted && frames.lastOrNull()?.let {
                it.epoch == 1 && it.observation.completed && it.observation.snapshot?.description?.sessionFormatVersion == 99L
            } == true }
            oldRelease.complete(Unit)
            compose.waitUntil(10_000) { oldFinished.isCompleted }
            compose.waitForIdle()
            val current = frames.last().observation
            assertEquals(99L, current.snapshot?.description?.sessionFormatVersion)
            assertTrue(current.completed)
            assertFalse(current.failed)
            assertEquals(NativeViewLinkCapability.READY, nativeViewLinkCapability(current))
            assertTrue(frames.filter { it.epoch == 1 && it.observation.completed }.all {
                !it.observation.failed && it.observation.snapshot?.description?.sessionFormatVersion == 99L
            })
            assertEquals(2, starts.get())
        } finally { oldRelease.complete(Unit) }
    }

    @Test fun failedQueryWithRetainedAvailableFactsRequiresTheExplicitRetryQuery() {
        val starts = AtomicInteger()
        val retryEntered = CompletableDeferred<Unit>()
        val retryRelease = CompletableDeferred<Unit>()
        val epoch = mutableStateOf(0)
        val wire = object : ObservedWire(snapshot(3)) {
            override suspend fun refreshHostDescription() {
                if (starts.incrementAndGet() == 1) throw IOException("controlled refresh failure")
                retryEntered.complete(Unit)
                retryRelease.await()
                current = snapshot(4)
            }
        }
        try {
            val frames = observe(wire, epoch)
            compose.waitUntil(10_000) { frames.lastOrNull()?.observation?.completed == true }
            val failed = frames.last().observation
            assertTrue(failed.failed)
            assertEquals(NativeDescriptionState.AVAILABLE, failed.snapshot?.descriptionState)
            assertEquals(NativeViewLinkCapability.FAILED, nativeViewLinkCapability(failed))
            compose.runOnUiThread { epoch.value = 1 }
            compose.waitUntil(10_000) { retryEntered.isCompleted && frames.lastOrNull()?.epoch == 1 }
            compose.waitForIdle()
            val waiting = frames.last().observation
            assertTrue(waiting.refreshing)
            assertFalse(waiting.completed)
            assertFalse(waiting.failed)
            assertEquals(NativeViewLinkCapability.WAITING, nativeViewLinkCapability(waiting))
            assertTrue(frames.filter { it.epoch == 1 }.all { nativeViewLinkCapability(it.observation) == NativeViewLinkCapability.WAITING })
            retryRelease.complete(Unit)
            compose.waitUntil(10_000) { frames.lastOrNull()?.observation?.completed == true }
            assertEquals(NativeViewLinkCapability.READY, nativeViewLinkCapability(frames.last().observation))
            assertEquals(4L, frames.last().observation.snapshot?.description?.sessionFormatVersion)
            assertEquals(2, starts.get())
        } finally { retryRelease.complete(Unit) }
    }

    @Test fun explicitRefreshCannotAdmitFromAnEarlierSuccessfulAvailableResult() {
        val starts = AtomicInteger()
        val retryEntered = CompletableDeferred<Unit>()
        val retryRelease = CompletableDeferred<Unit>()
        val epoch = mutableStateOf(0)
        val wire = object : ObservedWire(snapshot(3)) {
            override suspend fun refreshHostDescription() {
                if (starts.incrementAndGet() > 1) { retryEntered.complete(Unit); retryRelease.await() }
                current = snapshot(starts.get().toLong())
            }
        }
        try {
            val frames = observe(wire, epoch)
            compose.waitUntil(10_000) { frames.lastOrNull()?.observation?.completed == true }
            assertEquals(NativeViewLinkCapability.READY, nativeViewLinkCapability(frames.last().observation))
            compose.runOnUiThread { epoch.value = 1 }
            compose.waitUntil(10_000) { retryEntered.isCompleted && frames.lastOrNull()?.epoch == 1 }
            compose.waitForIdle()
            assertTrue(frames.filter { it.epoch == 1 }.all { nativeViewLinkCapability(it.observation) == NativeViewLinkCapability.WAITING })
            retryRelease.complete(Unit)
            compose.waitUntil(10_000) { frames.lastOrNull()?.observation?.completed == true }
            assertEquals(NativeViewLinkCapability.READY, nativeViewLinkCapability(frames.last().observation))
            assertEquals(2L, frames.last().observation.snapshot?.description?.sessionFormatVersion)
            assertEquals(2, starts.get())
        } finally { retryRelease.complete(Unit) }
    }

    @Test fun initialMissingObservationWaitsButACompletedQueryWithoutFactsFails() {
        assertEquals(NativeViewLinkCapability.WAITING, nativeViewLinkCapability(NativeHostObservation()))
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val wire = object : ObservedWire(null) {
            override suspend fun refreshHostDescription() { entered.complete(Unit); release.await() }
        }
        try {
            val frames = observe(wire)
            compose.waitUntil(10_000) { entered.isCompleted && frames.isNotEmpty() }
            assertEquals(NativeViewLinkCapability.WAITING, nativeViewLinkCapability(frames.last().observation))
            assertNull(frames.last().observation.snapshot)
            release.complete(Unit)
            compose.waitUntil(10_000) { frames.lastOrNull()?.observation?.completed == true }
            val completed = frames.last().observation
            assertFalse(completed.refreshing)
            assertNull(completed.snapshot)
            assertEquals(NativeViewLinkCapability.FAILED, nativeViewLinkCapability(completed))
        } finally { release.complete(Unit) }
    }

    @Test fun cancelledQueryWaitingForTheLockFailsDespiteRetainedAvailableFacts() {
        val owner = ControlledLifecycle()
        val entered = CompletableDeferred<Unit>()
        val lock = Mutex(locked = true)
        val queries = AtomicInteger()
        val wire = object : ObservedWire(snapshot(3)) {
            override suspend fun refreshHostDescription() {
                entered.complete(Unit)
                lock.withLock { queries.incrementAndGet(); current = snapshot(4) }
            }
        }
        compose.runOnUiThread { owner.registry.currentState = Lifecycle.State.RESUMED }
        try {
            val frames = observe(wire, owner = owner)
            compose.waitUntil(10_000) { entered.isCompleted && frames.isNotEmpty() }
            assertEquals(NativeViewLinkCapability.WAITING, nativeViewLinkCapability(frames.last().observation))
            compose.runOnUiThread { owner.registry.currentState = Lifecycle.State.CREATED }
            compose.waitUntil(10_000) { frames.lastOrNull()?.observation?.failed == true }
            val cancelled = frames.last().observation
            assertTrue(cancelled.completed)
            assertFalse(cancelled.refreshing)
            assertEquals(NativeDescriptionState.AVAILABLE, cancelled.snapshot?.descriptionState)
            assertEquals(NativeViewLinkCapability.FAILED, nativeViewLinkCapability(cancelled))
            assertEquals(0, queries.get())
        } finally {
            compose.runOnUiThread { owner.registry.currentState = Lifecycle.State.DESTROYED }
            lock.unlock()
        }
    }

    @Test fun completedQueriesWithNotRequestedOrCheckingSnapshotsFailWithoutAutomaticRetry() {
        val starts = AtomicInteger()
        val epoch = mutableStateOf(0)
        val wire = object : ObservedWire(snapshot(null, NativeDescriptionState.NOT_REQUESTED)) {
            override suspend fun refreshHostDescription() { starts.incrementAndGet() }
        }
        val frames = observe(wire, epoch)
        compose.waitUntil(10_000) { frames.lastOrNull()?.observation?.completed == true }
        assertEquals(NativeDescriptionState.NOT_REQUESTED, frames.last().observation.snapshot?.descriptionState)
        assertEquals(NativeViewLinkCapability.FAILED, nativeViewLinkCapability(frames.last().observation))
        assertEquals(1, starts.get())
        compose.runOnUiThread {
            wire.current = snapshot(null, NativeDescriptionState.CHECKING)
            epoch.value = 1
        }
        compose.waitUntil(10_000) { frames.lastOrNull()?.let { it.epoch == 1 && it.observation.completed } == true }
        assertEquals(NativeDescriptionState.CHECKING, frames.last().observation.snapshot?.descriptionState)
        assertEquals(NativeViewLinkCapability.FAILED, nativeViewLinkCapability(frames.last().observation))
        compose.waitForIdle()
        assertEquals(2, starts.get())
    }
}
