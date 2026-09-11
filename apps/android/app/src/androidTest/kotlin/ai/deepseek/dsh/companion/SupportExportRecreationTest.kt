package ai.deepseek.dsh.companion

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onNodeWithText
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test

/** Real Activity recreation retains the production approval owner; final destruction clears its bytes. */
class SupportExportRecreationTest {
    @get:Rule(order = 0) val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()

    private fun awaitApp() {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(isRoot()).fetchSemanticsNodes(atLeastOneRootRequired = false).isNotEmpty()
        }
        compose.waitForIdle()
    }

    private fun approvedDocument() = runBlocking(Dispatchers.IO) {
        val scanner = AndroidSupportScanner(InstrumentationRegistry.getInstrumentation().targetContext)
        SupportDocumentExporter(scanner, SupportExportPolicy(1024 * 1024, 10_000)).prepare(
            SupportProductIdentity("0.1.2-alpha.1", 1, "dev"),
            SupportLocalSnapshot(false, null, ConnectionSnapshots.unavailable),
        )
    }

    @Test fun recreationRetainsTheExactApprovalAndConsumesItOnce() {
        awaitApp()
        val document = approvedDocument()
        lateinit var before: SupportExportState
        compose.activityRule.scenario.onActivity { activity ->
            before = ViewModelProvider(activity)[SupportExportState::class.java]
            before.approve(document)
        }
        compose.onNodeWithText("Choose a local destination").assertExists()
        compose.activityRule.scenario.recreate()
        awaitApp()
        compose.onNodeWithText("Choose a local destination").assertExists()
        compose.activityRule.scenario.onActivity { activity ->
            val after = ViewModelProvider(activity)[SupportExportState::class.java]
            assertSame(before, after)
            assertArrayEquals(document.copyBytes(), requireNotNull(after.takeApproval()).copyBytes())
            assertNull(after.takeApproval())
            after.stage.value = SupportExportStage.CANCELLED
        }
    }

    @Test fun finalActivityDestructionDiscardsApproval() {
        awaitApp()
        val document = approvedDocument()
        lateinit var owner: SupportExportState
        compose.activityRule.scenario.onActivity { activity ->
            owner = ViewModelProvider(activity)[SupportExportState::class.java]
            owner.approve(document)
        }
        compose.activityRule.scenario.close()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { assertNull(owner.takeApproval()) }
    }
}
