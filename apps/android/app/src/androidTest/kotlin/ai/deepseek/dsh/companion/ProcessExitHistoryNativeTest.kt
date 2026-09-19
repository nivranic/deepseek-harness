package ai.deepseek.dsh.companion

import android.app.ApplicationExitInfo
import android.app.ActivityManager
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Uses the installed Application's actual process marker and Android's retained exit history. */
class ProcessExitHistoryNativeTest {
    @Test fun applicationRegistersItsBuildAndQueriesBoundedSystemHistory() {
        val application = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as CompanionApplication
        assertEquals(ExitMarkerRegistration.REGISTERED, requireNotNull(application.exitHistory).registration)
        val snapshot = requireNotNull(application.exitHistory).capture()
        assertTrue(snapshot is ProcessExitDiagnostics.Collected)
        snapshot as ProcessExitDiagnostics.Collected
        assertEquals(requireNotNull(application.supportSource).sourceSha, snapshot.sourceSha)
        assertEquals(32, snapshot.recordLimit)
        assertTrue(snapshot.records in 0..snapshot.recordLimit)
        assertEquals(ExitMarkerRegistration.REGISTERED, snapshot.registration)
        InstrumentationRegistry.getArguments().getString("dshExitProbePid")?.let { raw ->
            val pid = requireNotNull(raw.toIntOrNull()).also { require(it > 0) }
            val manager = requireNotNull(application.getSystemService(ActivityManager::class.java))
            val records = manager.getHistoricalProcessExitReasons(application.packageName, pid, 1)
            assertEquals(1, records.size)
            assertEquals(ApplicationExitInfo.REASON_CRASH_NATIVE, records.single().reason)
            assertArrayEquals(ProcessExitBuildMarker(application.supportProduct, snapshot.sourceSha).copyBytes(),
                records.single().processStateSummary)
        }
    }

    @Test fun systemFailureCategoriesRemainDistinctAndUnknownValuesStayFixed() {
        assertEquals(ProcessExitReason.JAVA_CRASH, exitReason(ApplicationExitInfo.REASON_CRASH))
        assertEquals(ProcessExitReason.NATIVE_CRASH, exitReason(ApplicationExitInfo.REASON_CRASH_NATIVE))
        assertEquals(ProcessExitReason.ANR, exitReason(ApplicationExitInfo.REASON_ANR))
        assertEquals(ProcessExitReason.LOW_MEMORY, exitReason(ApplicationExitInfo.REASON_LOW_MEMORY))
        assertEquals(ProcessExitReason.UNKNOWN, exitReason(ApplicationExitInfo.REASON_UNKNOWN))
        assertEquals(ProcessExitReason.UNRECOGNIZED, exitReason(Int.MAX_VALUE))
    }
}
