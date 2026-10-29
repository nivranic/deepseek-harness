package ai.deepseek.dsh.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * The platform presentation of the chapter-70 push chain: one local
 * notification per minimized push, title and body device-side localized,
 * tapping reopening the app where details load over the secure link.
 * Presenting is best-effort — without the runtime grant (minSdk 33 asks
 * at runtime) the system drops the notification silently.
 */
object PushNotifications {
    private const val CHANNEL_ID = "dsh-link-push"
    private const val NOTIFICATION_ID = 70

    /** The system's enablement read the grant projection and the presenter
     * share. */
    fun notificationsEnabled(context: Context): Boolean {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return manager.areNotificationsEnabled()
    }

    fun present(context: Context, push: CompanionPush) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "宿主推送", NotificationManager.IMPORTANCE_DEFAULT),
        )
        if (!manager.areNotificationsEnabled()) return
        val intent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = android.app.Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(pushTitle(push))
            .setContentText(pushBody())
            .setContentIntent(intent)
            .setAutoCancel(true)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }
}
