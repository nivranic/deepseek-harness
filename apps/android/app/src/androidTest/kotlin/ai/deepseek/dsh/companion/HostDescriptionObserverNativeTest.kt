package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.lifecycle.Lifecycle
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Real Activity lifecycle drives the production observer; a controlled wire exposes query ownership. */
class HostDescriptionObserverNativeTest {
    @get:Rule(order = 0) val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()

    private fun awaitApp() {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(isRoot()).fetchSemanticsNodes(atLeastOneRootRequired = false).isNotEmpty()
        }
        compose.onNodeWithTag("support-export").assertExists()
    }

    private class ObservedWire : WireDriving {
        val starts = AtomicInteger()
        val first = CountDownLatch(1)
        val second = CountDownLatch(1)
        val cancelled = CountDownLatch(1)
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected RPC")
        override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = error("unexpected stream")
        override suspend fun refreshHostDescription() {
            if (starts.incrementAndGet() == 1) {
                first.countDown()
                try { awaitCancellation() } finally { cancelled.countDown() }
            } else second.countDown()
        }
    }

    @Test fun stoppingCancelsTheQueryAndRestartingRefreshesOnce() {
        awaitApp()
        val wire = ObservedWire()
        compose.runOnUiThread { compose.activity.setContent { HostDescriptionObserver(wire, true) } }
        compose.waitForIdle()
        assertTrue(wire.first.await(5, TimeUnit.SECONDS))
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        assertTrue(wire.cancelled.await(5, TimeUnit.SECONDS))
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitForIdle()
        assertTrue(wire.second.await(5, TimeUnit.SECONDS))
        compose.waitForIdle()
        assertEquals(2, wire.starts.get())
    }

    @Test fun unpairedCompositionDoesNotQueryAndPairingChangeStartsOneQuery() {
        awaitApp()
        val wire = ObservedWire(); val paired = mutableStateOf(false)
        compose.runOnUiThread { compose.activity.setContent { HostDescriptionObserver(wire, paired.value) } }
        compose.waitForIdle()
        assertEquals(0, wire.starts.get())
        compose.runOnUiThread { paired.value = true }
        compose.waitForIdle()
        assertTrue(wire.first.await(5, TimeUnit.SECONDS))
        compose.runOnUiThread { paired.value = false }
        compose.waitForIdle()
        assertTrue(wire.cancelled.await(5, TimeUnit.SECONDS))
        compose.waitForIdle()
        assertEquals(1, wire.starts.get())
    }
}
