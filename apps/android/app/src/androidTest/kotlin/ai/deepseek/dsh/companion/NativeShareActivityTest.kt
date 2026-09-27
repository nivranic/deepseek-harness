package ai.deepseek.dsh.companion

import android.content.Intent
import android.content.pm.ActivityInfo
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Actual Activity delivery and recreation exercise the single-owner share ingress. */
class NativeShareActivityTest {
    @get:Rule(order = 0) val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createEmptyComposeRule()

    @Test fun singleTaskNewIntentReusesActivityAndRotationRetainsExactlyOneUnconfirmedShare() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // ActivityScenario tracks action/type as well as the component after the application calls setIntent.
        fun delivery(text: String) = Intent(Intent.ACTION_SEND).setType("text/plain").setClass(context, MainActivity::class.java)
            .putExtra(Intent.EXTRA_TEXT, text)
        // Scenario mutates its startup Intent with CLEAR_TASK; subsequent deliveries must be fresh Intents.
        val startup = delivery("share-activity-startup").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        ActivityScenario.launch<MainActivity>(startup).use { scenario ->
            lateinit var activity: MainActivity
            lateinit var owner: NativeShareIntake
            scenario.onActivity {
                activity = it; owner = it.shareIntake
                assertEquals("share-activity-startup", owner.payload!!.text)
                assertEquals(1L, owner.arrival); assertEquals(NativeSharePhase.REVIEW, owner.phase)
                assertFalse(owner.incomingRejected)
                owner.dismiss()
                val info = it.packageManager.getActivityInfo(it.componentName, 0)
                assertEquals(ActivityInfo.LAUNCH_SINGLE_TASK, info.launchMode)
                val first = delivery("share-activity-first")
                assertEquals(0, first.flags)
                it.startActivity(first)
            }
            compose.waitUntil(10_000) { owner.payload?.text == "share-activity-first" }
            scenario.onActivity {
                assertSame(activity, it); assertSame(owner, it.shareIntake)
                assertEquals("share-activity-first", it.intent.getStringExtra(Intent.EXTRA_TEXT))
            }
            compose.onNodeWithTag("share-intake").assertIsDisplayed()
            val arrival = owner.arrival
            scenario.recreate()
            scenario.onActivity {
                assertNotSame(activity, it)
                assertSame(owner, ViewModelProvider(it)[NativeShareIntake::class.java])
                assertEquals("share-activity-first", owner.payload!!.text); assertEquals(arrival, owner.arrival)
                assertEquals(NativeSharePhase.REVIEW, owner.phase)
                it.startActivity(delivery("share-activity-second"))
            }
            compose.waitUntil(10_000) { owner.incomingRejected }
            assertEquals("share-activity-first", owner.payload!!.text)
            compose.onNodeWithTag("share-incoming-rejected").assertIsDisplayed()
            scenario.onActivity {
                owner.dismiss()
                it.startActivity(delivery("share-activity-first"))
            }
            compose.waitUntil(10_000) { owner.arrival == arrival + 1 }
            assertEquals("share-activity-first", owner.payload!!.text)
            assertEquals(NativeSharePhase.REVIEW, owner.phase)
            scenario.onActivity { owner.dismiss() }
        }
    }
}
