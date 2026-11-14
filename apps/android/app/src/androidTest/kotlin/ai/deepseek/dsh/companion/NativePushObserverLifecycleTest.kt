package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.test.rule.GrantPermissionRule
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Real Activity transitions retain one Push producer and consume each model-owned notification once. */
class NativePushObserverLifecycleTest {
    @get:Rule(order = 0) val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()

    private class Stream {
        val frames = Channel<WireValue>(Channel.UNLIMITED)
        val finished = CountDownLatch(1)
        fun emit(eventId: String) {
            frames.trySend(WireValue.fromJsonElement(Json.parseToJsonElement(
                """{"type":"waterfall","event":"approval/request","agentId":"fixture-agent","eventId":"$eventId","interaction":{"sessionId":"fixture-session"}}"""
            ))).getOrThrow()
        }
    }

    private class ControlledWire(private val immediateEnd: Boolean = false, private val immediateFailure: Exception? = null) : WireDriving {
        val starts = AtomicInteger()
        val opened = LinkedBlockingQueue<Stream>()
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected RPC")
        override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
            check(endpoint == "\$events")
            val stream = Stream()
            starts.incrementAndGet(); opened.add(stream)
            try {
                emit(WireValue.fromJsonElement(Json.parseToJsonElement("""{"type":"ready"}""")))
                immediateFailure?.let { throw it }
                if (immediateEnd) return@flow
                for (frame in stream.frames) emit(frame)
            } finally { stream.finished.countDown() }
        }
        fun next(): Stream = checkNotNull(opened.poll(5, TimeUnit.SECONDS)) { "Push stream did not open" }
    }

    private class RetainedPushOwner(wire: WireDriving) : ViewModel() {
        val pushes = PushModel(wire, viewModelScope)
        override fun onCleared() { pushes.stopWatching() }
    }

    private lateinit var owner: RetainedPushOwner
    private val presented = CopyOnWriteArrayList<CompanionPush>()
    private val arrivals = LinkedBlockingQueue<CompanionPush>()

    private fun awaitApp() {
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("support-export").fetchSemanticsNodes(false).isNotEmpty() }
    }

    private fun attach() {
        compose.runOnUiThread { compose.activity.setContent {
            NativePushObserver(owner.pushes, true) { push -> presented.add(push); arrivals.add(push) }
            Text("Push lifecycle fixture")
        } }
        compose.waitForIdle()
    }

    private fun mount(wire: ControlledWire, expected: ConnectionState = ConnectionState.OPEN): Stream {
        awaitApp()
        compose.runOnUiThread {
            owner = RetainedPushOwner(wire)
            compose.activity.viewModelStore.put("push-lifecycle-fixture", owner)
        }
        attach()
        return wire.next().also { awaitState(expected) }
    }

    private fun awaitState(state: ConnectionState) = runBlocking {
        withTimeout(5_000) { while (owner.pushes.connectionSnapshot.state != state) delay(10) }
    }

    private fun assertNotification(eventId: String) {
        assertEquals(CompanionPush.ApprovalWaiting("fixture-session", eventId), arrivals.poll(5, TimeUnit.SECONDS))
    }

    private fun background() { compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED) }
    private fun foreground() {
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitForIdle()
    }

    private fun recreateAndAttach() {
        val before = owner
        compose.activityRule.scenario.recreate()
        awaitApp()
        compose.runOnUiThread {
            owner = ViewModelProvider(compose.activity).get("push-lifecycle-fixture", RetainedPushOwner::class.java)
            assertSame(before, owner)
        }
        attach()
    }

    @After fun retireOwnedModel() {
        if (::owner.isInitialized) runBlocking {
            withContext(Dispatchers.Main) { owner.pushes.stopWatchingAndAwait() }
        }
    }

    @Test fun initialAttachAndHealthyForegroundEntriesKeepOneBackgroundProducerAndConsumer() {
        val wire = ControlledWire()
        val stream = mount(wire)
        assertEquals(1, wire.starts.get()); assertEquals(1L, owner.pushes.connectionSnapshot.attempts)
        stream.emit("before-home"); assertNotification("before-home")
        background()
        assertEquals(1L, stream.finished.count)
        stream.emit("while-backgrounded"); assertNotification("while-backgrounded")
        foreground()
        background(); foreground()
        assertEquals(1, wire.starts.get()); assertEquals(1L, stream.finished.count)
        assertEquals(1L, owner.pushes.connectionSnapshot.attempts)
        assertEquals(2, presented.size); assertTrue(arrivals.isEmpty())
    }

    @Test fun eofWhileBackgroundedRecoversOnceOnTheNextStartedEntry() {
        val wire = ControlledWire()
        val first = mount(wire)
        first.emit("before-eof"); assertNotification("before-eof")
        background()
        first.frames.close()
        assertTrue(first.finished.await(5, TimeUnit.SECONDS)); awaitState(ConnectionState.ENDED)
        assertEquals(1, wire.starts.get()); assertEquals(1L, owner.pushes.connectionSnapshot.attempts)
        foreground()
        val second = wire.next(); awaitState(ConnectionState.OPEN)
        assertEquals(2, wire.starts.get()); assertEquals(2L, owner.pushes.connectionSnapshot.attempts)
        second.emit("after-eof"); assertNotification("after-eof")
        background(); foreground()
        assertEquals(2, wire.starts.get()); assertEquals(2, presented.size); assertTrue(arrivals.isEmpty())
    }

    @Test fun immediateEofStartsOnlyOncePerInitialAttachmentAndForegroundEntry() {
        val wire = ControlledWire(immediateEnd = true)
        mount(wire, ConnectionState.ENDED)
        compose.waitForIdle()
        assertEquals(1, wire.starts.get()); assertEquals(1L, owner.pushes.connectionSnapshot.attempts)
        background(); foreground()
        wire.next(); awaitState(ConnectionState.ENDED)
        assertEquals(2, wire.starts.get()); assertEquals(2L, owner.pushes.connectionSnapshot.attempts)
    }

    @Test fun immediateTemporaryFailureCannotRetryTwiceWithinTheSameAttachment() {
        val wire = ControlledWire(immediateFailure = IOException("immediate controlled failure"))
        mount(wire, ConnectionState.ENDED)
        compose.waitForIdle()
        assertEquals(1, wire.starts.get()); assertEquals(1L, owner.pushes.connectionSnapshot.attempts)
        background(); foreground()
        wire.next(); awaitState(ConnectionState.ENDED)
        assertEquals(2, wire.starts.get()); assertEquals(2L, owner.pushes.connectionSnapshot.attempts)
    }

    @Test fun temporaryFailureWhileForegroundedWaitsForAnotherForegroundEntry() {
        val wire = ControlledWire()
        val first = mount(wire)
        first.frames.close(IOException("controlled temporary stream failure"))
        assertTrue(first.finished.await(5, TimeUnit.SECONDS)); awaitState(ConnectionState.ENDED)
        compose.waitForIdle()
        assertEquals(1, wire.starts.get())
        background(); foreground()
        val second = wire.next(); awaitState(ConnectionState.OPEN)
        assertEquals(2L, owner.pushes.connectionSnapshot.attempts)
        second.emit("after-temporary-failure"); assertNotification("after-temporary-failure")
        assertEquals(2, wire.starts.get())
    }

    @Test fun permanentFailureCannotRestartOnStartedOrActivityRecreation() {
        val wire = ControlledWire()
        val first = mount(wire)
        first.frames.close(LinkClientException.Refused("device/already-revoked", "controlled revoked grant"))
        assertTrue(first.finished.await(5, TimeUnit.SECONDS)); awaitState(ConnectionState.ENDED)
        repeat(2) { background(); foreground() }
        recreateAndAttach()
        assertEquals(ConnectionState.ENDED, owner.pushes.connectionSnapshot.state)
        assertEquals(1L, owner.pushes.connectionSnapshot.attempts); assertEquals(1, wire.starts.get())
        assertTrue(presented.isEmpty())
    }

    @Test fun rotationKeepsTheProducerAndDrainsOnlyNotificationsNotPreviouslyPresented() {
        val wire = ControlledWire()
        val stream = mount(wire)
        stream.emit("before-rotation"); assertNotification("before-rotation")
        val before = owner
        compose.activityRule.scenario.recreate()
        awaitApp()
        compose.runOnUiThread {
            owner = ViewModelProvider(compose.activity).get("push-lifecycle-fixture", RetainedPushOwner::class.java)
            assertSame(before, owner)
        }
        assertEquals(1L, stream.finished.count); assertEquals(1, wire.starts.get())
        stream.emit("between-consumers")
        runBlocking { withTimeout(5_000) { while (owner.pushes.pushes.value.size != 2) delay(10) } }
        assertEquals(1, presented.size)
        attach()
        assertNotification("between-consumers")
        recreateAndAttach()
        assertEquals(1, wire.starts.get()); assertEquals(1L, owner.pushes.connectionSnapshot.attempts)
        assertEquals(1L, stream.finished.count)
        assertEquals(listOf("before-rotation", "between-consumers"), presented.map { (it as CompanionPush.ApprovalWaiting).eventId })
        assertTrue(arrivals.isEmpty())
    }
}
