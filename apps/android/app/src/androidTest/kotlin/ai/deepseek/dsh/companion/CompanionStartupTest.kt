package ai.deepseek.dsh.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.rule.GrantPermissionRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue

/** Exercises the real unpaired activity, including theme decoding and remote-stream admission. */
class CompanionStartupTest {
    @get:Rule(order = 0)
    val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun firstCompositionDisplaysTheCompanion() {
        // The activity restores its credentials on IO before attaching Compose.
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(isRoot()).fetchSemanticsNodes(atLeastOneRootRequired = false).isNotEmpty()
        }
        compose.onNodeWithText("配对到宿主").assertIsDisplayed()
        val export = compose.onNodeWithTag("support-export").assertIsDisplayed()
        val buttonTop = export.fetchSemanticsNode().boundsInWindow.top
        var statusBarTop = 0
        compose.runOnIdle {
            val insets = requireNotNull(ViewCompat.getRootWindowInsets(compose.activity.window.decorView))
            statusBarTop = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
        }
        assertTrue("The runner must expose the system status bar", statusBarTop > 0)
        assertTrue("The export button must remain below the system status bar", buttonTop >= statusBarTop)
    }
}
