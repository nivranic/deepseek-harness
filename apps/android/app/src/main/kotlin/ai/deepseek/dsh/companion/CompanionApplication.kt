package ai.deepseek.dsh.companion

import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.content.pm.PackageManager

/** Build validation and process marking run before any Activity; no background history collection is started. */
class CompanionApplication : Application() {
    lateinit var supportProduct: SupportProductIdentity
        private set
    var supportSource: SupportApplicationSource? = null
        private set
    var exitHistory: ProcessExitHistory? = null
        private set

    override fun onCreate() {
        super.onCreate()
        val info = packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
        val application = packageManager.getApplicationInfo(packageName,
            PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
        supportProduct = SupportProductIdentity(info.versionName.orEmpty(), info.longVersionCode,
            application.metaData?.getString("ai.deepseek.dsh.distributionChannel").orEmpty())
        @Suppress("DEPRECATION")
        val source = SupportApplicationSource.fromMetadata(application.metaData?.get("ai.deepseek.dsh.applicationSource"),
            application.metaData?.get("ai.deepseek.dsh.applicationTree"))
        supportSource = source
        if (source == null) return
        val manager = getSystemService(ActivityManager::class.java)
        exitHistory = ProcessExitHistory(supportProduct, source.sourceSha, resources.getInteger(R.integer.support_exit_history_limit),
            object : ProcessExitAccess {
                override fun register(summary: ByteArray) {
                    checkNotNull(manager).setProcessStateSummary(summary)
                }
                override fun read(maximumRecords: Int): List<ProcessExitRecord> =
                    checkNotNull(manager).getHistoricalProcessExitReasons(packageName, 0, maximumRecords).map {
                        ProcessExitRecord(it.processStateSummary, exitReason(it.reason))
                    }
            })
    }
}

/** Only Android's fixed reason value and the build marker are read; traces, names and timestamps stay with the OS. */
internal fun exitReason(reason: Int): ProcessExitReason = when (reason) {
    ApplicationExitInfo.REASON_UNKNOWN -> ProcessExitReason.UNKNOWN
    ApplicationExitInfo.REASON_EXIT_SELF -> ProcessExitReason.EXIT_SELF
    ApplicationExitInfo.REASON_SIGNALED -> ProcessExitReason.SIGNALED
    ApplicationExitInfo.REASON_LOW_MEMORY -> ProcessExitReason.LOW_MEMORY
    ApplicationExitInfo.REASON_CRASH -> ProcessExitReason.JAVA_CRASH
    ApplicationExitInfo.REASON_CRASH_NATIVE -> ProcessExitReason.NATIVE_CRASH
    ApplicationExitInfo.REASON_ANR -> ProcessExitReason.ANR
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> ProcessExitReason.INITIALIZATION_FAILURE
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> ProcessExitReason.PERMISSION_CHANGE
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> ProcessExitReason.EXCESSIVE_RESOURCE_USAGE
    ApplicationExitInfo.REASON_USER_REQUESTED -> ProcessExitReason.USER_REQUESTED
    ApplicationExitInfo.REASON_USER_STOPPED -> ProcessExitReason.USER_STOPPED
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> ProcessExitReason.DEPENDENCY_DIED
    ApplicationExitInfo.REASON_OTHER -> ProcessExitReason.OTHER
    ApplicationExitInfo.REASON_FREEZER -> ProcessExitReason.FREEZER
    ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> ProcessExitReason.PACKAGE_STATE_CHANGE
    ApplicationExitInfo.REASON_PACKAGE_UPDATED -> ProcessExitReason.PACKAGE_UPDATED
    else -> ProcessExitReason.UNRECOGNIZED
}
