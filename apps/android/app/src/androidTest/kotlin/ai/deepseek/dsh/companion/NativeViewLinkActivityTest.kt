package ai.deepseek.dsh.companion

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.test.rule.ActivityTestRule
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Implicit BROWSABLE delivery changes getIntent while the same Activity and retained owner remain authoritative. */
class NativeViewLinkActivityTest {
    @get:Rule(order = 0) val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    @Suppress("DEPRECATION")
    @get:Rule(order = 1) val compose = AndroidComposeTestRule(object : ActivityTestRule<MainActivity>(MainActivity::class.java) {
        override fun getActivityIntent() = Intent(Intent.ACTION_VIEW,
            Uri.parse(NativeViewLocations.encodeDeepLink(NativeViewLocation("view-intent-test-untrusted-host", "startup", 0))))
            .addCategory(Intent.CATEGORY_BROWSABLE)
    }) { it.activity }

    @Test fun coldAndWarmImplicitViewsKeepSingleTaskOwnershipAndRotationDoesNotReplay() {
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("support-export").fetchSemanticsNodes(false).isNotEmpty() }
        val firstActivity = compose.activity
        val owner = firstActivity.viewLinkIntake
        compose.waitUntil(10_000) { owner.phase == NativeViewLinkPhase.FAILED }
        assertEquals(1L, owner.arrival); assertEquals(1L, owner.attempt)
        assertEquals("startup", owner.location?.sessionId)
        assertTrue(owner.issue in setOf(NativeViewLinkIssue.UNPAIRED, NativeViewLinkIssue.WRONG_HOST, NativeViewLinkIssue.HOST_UNAVAILABLE))
        fun delivery(session: String) = Intent(Intent.ACTION_VIEW,
            Uri.parse(NativeViewLocations.encodeDeepLink(NativeViewLocation("view-intent-test-untrusted-host", session, 0))))
            .addCategory(Intent.CATEGORY_BROWSABLE).setPackage(firstActivity.packageName)
        compose.runOnUiThread {
            val info = firstActivity.packageManager.getActivityInfo(firstActivity.componentName, 0)
            assertEquals(ActivityInfo.LAUNCH_SINGLE_TASK, info.launchMode)
            val incoming = delivery("warm")
            assertEquals(0, incoming.flags); assertNull(incoming.component)
            val resolved = firstActivity.packageManager.resolveActivity(incoming, PackageManager.MATCH_DEFAULT_ONLY)
            assertEquals(MainActivity::class.java.name, resolved?.activityInfo?.name)
            firstActivity.startActivity(incoming)
        }
        compose.waitUntil(10_000) { owner.arrival == 2L }
        compose.runOnIdle {
            assertSame(firstActivity, compose.activity); assertSame(owner, compose.activity.viewLinkIntake)
            assertEquals(delivery("warm").dataString, compose.activity.intent.dataString)
            assertEquals("warm", owner.location?.sessionId)
        }
        compose.onNodeWithTag("view-link-state").assertIsDisplayed()
        compose.runOnUiThread { firstActivity.recreate() }
        compose.waitUntil(10_000) {
            firstActivity.isDestroyed && compose.activity !== firstActivity && compose.activity.lifecycle.currentState == Lifecycle.State.RESUMED
        }
        compose.runOnIdle {
            assertSame(owner, ViewModelProvider(compose.activity)[NativeViewLinkIntake::class.java])
            assertEquals(2L, owner.arrival); assertEquals(2L, owner.attempt)
            assertEquals("warm", owner.location?.sessionId)
        }
        compose.runOnUiThread { compose.activity.startActivity(delivery("warm")) }
        compose.waitUntil(10_000) { owner.arrival == 3L }
        compose.runOnIdle {
            assertEquals(3L, owner.attempt); assertEquals("warm", owner.location?.sessionId)
            owner.dismiss()
        }
    }
}
