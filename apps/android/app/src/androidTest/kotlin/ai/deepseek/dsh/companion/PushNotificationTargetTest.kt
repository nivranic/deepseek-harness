package ai.deepseek.dsh.companion

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Verifies the actual Android notification and PendingIntent registry, without tapping the notification. */
class PushNotificationTargetTest {
    @get:Rule
    val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)

    @Test
    fun postsAnImmutableIntentForTheExplicitMainActivity() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancelAll()
        try {
            PushNotifications.present(context, CompanionPush.ApprovalWaiting("test-session", "test-event"))
            withTimeout(5_000) {
                while (manager.activeNotifications.none { it.notification.channelId == "dsh-link-push" }) delay(20)
            }
            val posted = manager.activeNotifications.single { it.notification.channelId == "dsh-link-push" }.notification
            val expected = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            )
            assertNotNull(expected)
            assertEquals(expected, posted.contentIntent)
            assertEquals(context.packageName, posted.contentIntent.creatorPackage)
            assertTrue(posted.contentIntent.isImmutable)
            val otherComponent = Intent().setClassName(context, "${context.packageName}.UnregisteredActivity")
            assertNull(PendingIntent.getActivity(context, 0, otherComponent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE))
        } finally {
            manager.cancelAll()
        }
    }
}
