package ai.deepseek.dsh.companion

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProcessExitHistoryTest {
    private val product = SupportProductIdentity("0.1.2-alpha.1", 1, "dev")
    private val sha = "b".repeat(40)
    private val marker = ProcessExitBuildMarker(product, sha)

    private class Access : ProcessExitAccess {
        var registered: ByteArray? = null
        var registrations = 0
        var requested = 0
        var rows: List<ProcessExitRecord> = emptyList()
        var registrationFailure: RuntimeException? = null
        var queryFailure: RuntimeException? = null
        override fun register(summary: ByteArray) {
            registrations++
            registrationFailure?.let { throw it }
            registered = summary
        }
        override fun read(maximumRecords: Int): List<ProcessExitRecord> {
            requested = maximumRecords
            queryFailure?.let { throw it }
            return rows
        }
    }

    @Test fun buildMarkerBindsAllProductFieldsAndSourceWithoutSharingItsBytes() {
        val bytes = marker.copyBytes()
        assertEquals(36, bytes.size)
        assertContentEquals(bytes, ProcessExitBuildMarker(product, sha).copyBytes())
        for (other in listOf(ProcessExitBuildMarker(product.copy(version = "0.1.3-alpha.1"), sha),
            ProcessExitBuildMarker(product.copy(buildNumber = 2), sha),
            ProcessExitBuildMarker(product.copy(channel = "canary"), sha),
            ProcessExitBuildMarker(product, "c".repeat(40)))) {
            assertFalse(marker.matches(other.copyBytes()))
            assertTrue(marker.recognizes(other.copyBytes()))
        }
        bytes.fill(0)
        assertFalse(marker.matches(bytes))
        assertEquals(0x44.toByte(), marker.copyBytes()[0])
    }

    @Test fun onlyMatchingBuildReasonsAreAttributedAndAnExtraRecordDisclosesTheBound() {
        val access = Access().apply { rows = listOf(
            ProcessExitRecord(marker.copyBytes(), ProcessExitReason.JAVA_CRASH),
            ProcessExitRecord(ProcessExitBuildMarker(product, "c".repeat(40)).copyBytes(), ProcessExitReason.ANR),
            ProcessExitRecord("private prior metadata".toByteArray(), ProcessExitReason.NATIVE_CRASH),
            ProcessExitRecord(marker.copyBytes(), ProcessExitReason.LOW_MEMORY),
        ) }
        val history = ProcessExitHistory(product, sha, 3, access)
        val captured = history.capture() as ProcessExitDiagnostics.Collected
        assertEquals(4, access.requested)
        assertEquals(1, access.registrations)
        assertContentEquals(marker.copyBytes(), access.registered)
        assertEquals(listOf(ExitReasonCount(ProcessExitReason.JAVA_CRASH, 1)), captured.matchingBuild)
        assertEquals(1, captured.otherBuildRecords)
        assertEquals(1, captured.unmarkedRecords)
        assertEquals(3, captured.records)
        assertTrue(captured.additionalRecordObserved)
        assertFalse(captured.toJson().toString().contains("private"))
        assertFalse(captured.toJson().toString().contains("c".repeat(40)))
    }

    @Test fun emptyAndExactlyFullWindowsNeverClaimCompleteHistory() {
        val access = Access()
        val history = ProcessExitHistory(product, sha, 2, access)
        val empty = history.capture() as ProcessExitDiagnostics.Collected
        assertEquals(0, empty.records)
        assertFalse(empty.additionalRecordObserved)
        assertEquals("false", empty.toJson()["historyComplete"].toString())
        access.rows = List(2) { ProcessExitRecord(marker.copyBytes(), ProcessExitReason.ANR) }
        val full = history.capture() as ProcessExitDiagnostics.Collected
        assertEquals(2, full.matchingBuildRecords)
        assertFalse(full.additionalRecordObserved)
        assertEquals("\"last-known\"", full.toJson()["observation"].toString())
        assertEquals(1, access.registrations)
    }

    @Test fun aCapturedSnapshotDoesNotRetainNativeArraysOrLaterQueryResults() {
        val summary = marker.copyBytes()
        val rows = mutableListOf(ProcessExitRecord(summary, ProcessExitReason.NATIVE_CRASH))
        val access = Access().apply { this.rows = rows }
        val history = ProcessExitHistory(product, sha, 32, access)
        val before = history.capture() as ProcessExitDiagnostics.Collected
        summary.fill(0)
        rows.clear()
        assertEquals(1, before.matchingBuildRecords)
        assertEquals(listOf(ExitReasonCount(ProcessExitReason.NATIVE_CRASH, 1)), before.matchingBuild)
        assertEquals(0, (history.capture() as ProcessExitDiagnostics.Collected).records)
    }

    @Test fun nullForeignAndUnsupportedMarkerVersionsRemainUnattributed() {
        val access = Access().apply { rows = listOf(null, ByteArray(36), marker.copyBytes().also { it[3] = 2 },
            marker.copyBytes() + 0.toByte()).map { ProcessExitRecord(it, ProcessExitReason.JAVA_CRASH) } }
        val captured = ProcessExitHistory(product, sha, 4, access).capture() as ProcessExitDiagnostics.Collected
        assertEquals(4, captured.unmarkedRecords)
        assertEquals(0, captured.matchingBuildRecords)
        assertEquals(0, captured.otherBuildRecords)
    }

    @Test fun registrationFailureAndCollectionResultsRemainIndependent() {
        val access = Access().apply {
            registrationFailure = IllegalStateException("private binder response")
            rows = listOf(ProcessExitRecord(marker.copyBytes(), ProcessExitReason.LOW_MEMORY))
        }
        val history = ProcessExitHistory(product, sha, 32, access)
        assertEquals(ExitMarkerRegistration.FAILED, history.registration)
        val captured = history.capture() as ProcessExitDiagnostics.Collected
        assertEquals(ExitMarkerRegistration.FAILED, captured.registration)
        assertEquals(1, captured.matchingBuildRecords)
        assertFalse(captured.toJson().toString().contains("private"))
    }

    @Test fun failedQueriesErasePriorResultsAndPreserveOnlyFixedFailureCategories() {
        val access = Access().apply { rows = listOf(ProcessExitRecord(marker.copyBytes(), ProcessExitReason.ANR)) }
        val history = ProcessExitHistory(product, sha, 32, access)
        assertEquals(1, (history.capture() as ProcessExitDiagnostics.Collected).records)
        for ((failure, expected) in listOf(SecurityException("private permission") to ExitHistoryFailure.PERMISSION_DENIED,
            IllegalStateException("private system response") to ExitHistoryFailure.QUERY_FAILED)) {
            access.queryFailure = failure
            val captured = history.capture()
            assertEquals(ProcessExitDiagnostics.Failed(ExitMarkerRegistration.REGISTERED, expected), captured)
            assertFalse(captured.toJson().containsKey("matchingBuildReasons"))
            assertFalse(captured.toJson().toString().contains("private"))
        }
    }

    @Test fun oversizedNativeResponsesFailInsteadOfSilentlyDiscardingRecords() {
        val access = Access().apply { rows = List(4) { ProcessExitRecord(null, ProcessExitReason.OTHER) } }
        assertEquals(ProcessExitDiagnostics.Failed(ExitMarkerRegistration.REGISTERED, ExitHistoryFailure.INVALID_RESPONSE),
            ProcessExitHistory(product, sha, 2, access).capture())
    }

    @Test fun invalidBuildOrCollectionPolicyIsRejectedBeforeRegistration() {
        val access = Access()
        for (limit in listOf(0, 129)) assertFailsWith<IllegalArgumentException> { ProcessExitHistory(product, sha, limit, access) }
        assertFailsWith<IllegalArgumentException> { ProcessExitHistory(product, "invalid", 32, access) }
        assertEquals(0, access.registrations)
    }
}
