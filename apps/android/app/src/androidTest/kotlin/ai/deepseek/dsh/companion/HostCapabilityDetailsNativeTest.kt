package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeDescriptionState
import ai.deepseek.dsh.gateway.NativeGatewayDiagnosticSnapshot
import ai.deepseek.dsh.gateway.NativeObservedCapability
import ai.deepseek.dsh.gateway.NativeObservedRole
import ai.deepseek.dsh.gateway.NativeProtocolObservation
import ai.deepseek.dsh.link.WireValue
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Controlled query completion exercises the installed Compose UI and generation-owned state. */
class HostCapabilityDetailsNativeTest {
    @get:Rule(order = 0) val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()

    private fun snapshot(state: NativeDescriptionState, version: Long? = 3) = NativeGatewayDiagnosticSnapshot(
        false, 0, 0, 0, 0, 0, NativeObservedRole.VIEWER, state, null,
        version?.let { NativeProtocolObservation(it, setOf(NativeObservedCapability.SESSION_FOLLOW)) },
    )

    private fun awaitApp() {
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("support-export").fetchSemanticsNodes(false).isNotEmpty() }
    }

    @Test fun detailsDistinguishRetainedFactsFromFailuresAndUnobservedCapabilities() {
        awaitApp()
        val observation = mutableStateOf(NativeHostObservation(false, snapshot(NativeDescriptionState.AVAILABLE)))
        val refreshes = AtomicInteger()
        compose.runOnUiThread { compose.activity.setContent { CompanionTheme {
            HostCapabilityDetails(observation.value, 1) { refreshes.incrementAndGet() }
        } } }
        compose.onNodeWithTag("native-capabilities-open").performClick()
        compose.onNodeWithTag("native-capabilities-state").assertTextEquals("最近一次查询成功")
        compose.onNodeWithTag("native-capability-session.follow.v1").performScrollTo().assertTextEquals("跟随会话：已声明支持")
        compose.onNodeWithTag("native-capability-session.control.v1").performScrollTo().assertTextEquals("控制会话：未声明支持")
        compose.onNodeWithTag("native-capabilities-refresh").performClick()
        assertEquals(1, refreshes.get())
        compose.runOnUiThread { observation.value = NativeHostObservation(true, snapshot(NativeDescriptionState.CHECKING)) }
        compose.onNodeWithTag("native-capabilities-refresh").assertIsNotEnabled()
        compose.runOnUiThread { observation.value = NativeHostObservation(false, snapshot(NativeDescriptionState.FAILED)) }
        compose.onNodeWithTag("native-capabilities-state").performScrollTo().assertTextContains("保留最近一次成功观察", substring = true)
        compose.onNodeWithTag("native-capability-session.follow.v1").performScrollTo().assertTextEquals("跟随会话：已声明支持")
        compose.runOnUiThread { observation.value = NativeHostObservation(false, snapshot(NativeDescriptionState.FAILED, null)) }
        compose.onNodeWithTag("native-capabilities-state").performScrollTo().assertTextContains("尚无成功观察", substring = true)
        compose.onNodeWithTag("native-capability-session.follow.v1").assertDoesNotExist()
        compose.onNodeWithTag("native-capabilities-close").performClick()
        compose.onNodeWithTag("native-capabilities-state").assertDoesNotExist()
    }

    @Test fun changingGenerationClosesOldDetails() {
        awaitApp()
        val generation = mutableStateOf(1L)
        compose.runOnUiThread { compose.activity.setContent { CompanionTheme {
            HostCapabilityDetails(NativeHostObservation(false, snapshot(NativeDescriptionState.AVAILABLE)), generation.value) {}
        } } }
        compose.onNodeWithTag("native-capabilities-open").performClick()
        compose.onNodeWithTag("native-capabilities-state").assertExists()
        compose.runOnUiThread { generation.value = 2 }
        compose.onNodeWithTag("native-capabilities-state").assertDoesNotExist()
    }

    @Test fun cancelledOldGenerationCannotReplaceNewQueryResult() {
        awaitApp()
        val starts = AtomicInteger()
        val lateRelease = CompletableDeferred<Unit>()
        val lateFinished = AtomicInteger()
        val generation = mutableStateOf(1L)
        val wire = object : WireDriving {
            @Volatile var current = snapshot(NativeDescriptionState.NOT_REQUESTED, null)
            override fun diagnosticSnapshot() = WireDiagnosticSnapshot.Native(current)
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected mutation")
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = error("unexpected stream")
            override suspend fun refreshHostDescription() {
                if (starts.incrementAndGet() == 1) {
                    try { awaitCancellation() }
                    finally { withContext(NonCancellable) {
                        lateRelease.await()
                        current = snapshot(NativeDescriptionState.AVAILABLE, 88)
                        lateFinished.incrementAndGet()
                    } }
                } else current = snapshot(NativeDescriptionState.AVAILABLE, 99)
            }
        }
        try {
            compose.runOnUiThread { compose.activity.setContent {
                val observation = HostDescriptionObserver(wire, true, generation.value)
                Text("Observed ${observation.snapshot?.description?.sessionFormatVersion}")
            } }
            compose.waitUntil(10_000) { starts.get() == 1 }
            compose.runOnUiThread { generation.value = 2 }
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Observed 99").fetchSemanticsNodes(false).isNotEmpty() }
            lateRelease.complete(Unit)
            compose.waitUntil(10_000) { lateFinished.get() == 1 }
            compose.waitForIdle()
            compose.onNodeWithText("Observed 99").assertExists()
            compose.onNodeWithText("Observed 88").assertDoesNotExist()
            assertEquals(2, starts.get())
        } finally { lateRelease.complete(Unit) }
    }
}
