package ai.deepseek.dsh.companion

import java.security.MessageDigest
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Fixed Android exit categories; an unknown platform value is not an application exception message. */
enum class ProcessExitReason(val wire: String) {
    UNKNOWN("unknown"), EXIT_SELF("exit-self"), SIGNALED("signaled"), LOW_MEMORY("low-memory"),
    JAVA_CRASH("java-crash"), NATIVE_CRASH("native-crash"), ANR("anr"),
    INITIALIZATION_FAILURE("initialization-failure"), PERMISSION_CHANGE("permission-change"),
    EXCESSIVE_RESOURCE_USAGE("excessive-resource-usage"), USER_REQUESTED("user-requested"),
    USER_STOPPED("user-stopped"), DEPENDENCY_DIED("dependency-died"), OTHER("other"),
    FREEZER("freezer"), PACKAGE_STATE_CHANGE("package-state-change"), PACKAGE_UPDATED("package-updated"),
    UNRECOGNIZED("unrecognized"),
}

/** Native metadata is reduced before crossing into the exporter; traces and identities are not accepted. */
data class ProcessExitRecord(val summary: ByteArray?, val reason: ProcessExitReason)

/** The application exclusively owns Android's process summary slot; reads request only retained package records. */
interface ProcessExitAccess {
    fun register(summary: ByteArray)
    fun read(maximumRecords: Int): List<ProcessExitRecord>
}

enum class ExitMarkerRegistration(val wire: String) { REGISTERED("registered"), FAILED("failed") }
enum class ExitHistoryFailure(val wire: String) {
    PERMISSION_DENIED("permission-denied"), QUERY_FAILED("query-failed"), INVALID_RESPONSE("invalid-response"),
}

/** A build-only 36-byte marker fits Android's 128-byte slot and contains no process or user identity. */
class ProcessExitBuildMarker(product: SupportProductIdentity, val sourceSha: String) {
    private val prefix = byteArrayOf(0x44, 0x53, 0x48, 1)
    private val bytes: ByteArray

    init {
        require(Regex("[a-f0-9]{40}").matches(sourceSha)) { "Exit marker requires a full source SHA" }
        val input = "DSH-Android-exit-v1\u0000${product.version}\u0000${product.buildNumber}\u0000${product.channel}\u0000$sourceSha"
        bytes = prefix + MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    }

    fun copyBytes(): ByteArray = bytes.copyOf()
    internal fun matches(summary: ByteArray?): Boolean = summary != null && bytes.contentEquals(summary)
    internal fun recognizes(summary: ByteArray?): Boolean =
        summary != null && summary.size == bytes.size && prefix.indices.all { prefix[it] == summary[it] }
}

data class ExitReasonCount(val reason: ProcessExitReason, val count: Int)

/** A successful query covers a bounded retained window, never the complete crash history or present health. */
sealed interface ProcessExitDiagnostics {
    data object Unavailable : ProcessExitDiagnostics
    data class Failed(val registration: ExitMarkerRegistration, val failure: ExitHistoryFailure) : ProcessExitDiagnostics
    data class Collected(
        val sourceSha: String,
        val registration: ExitMarkerRegistration,
        val recordLimit: Int,
        val additionalRecordObserved: Boolean,
        val matchingBuild: List<ExitReasonCount>,
        val otherBuildRecords: Int,
        val unmarkedRecords: Int,
    ) : ProcessExitDiagnostics {
        val matchingBuildRecords: Int get() = matchingBuild.sumOf { it.count }
        val records: Int get() = matchingBuildRecords + otherBuildRecords + unmarkedRecords
    }
}

/** Registers once at process startup and copies bounded history on explicit export; neither operation starts a monitor. */
class ProcessExitHistory(
    product: SupportProductIdentity,
    sourceSha: String,
    private val maximumRecords: Int,
    private val access: ProcessExitAccess,
) {
    private val marker = ProcessExitBuildMarker(product, sourceSha)
    val registration: ExitMarkerRegistration

    init {
        require(maximumRecords in 1..128) { "Exit history record limit must be from 1 to 128" }
        registration = try {
            access.register(marker.copyBytes())
            ExitMarkerRegistration.REGISTERED
        } catch (_: RuntimeException) {
            // Binder failures and system throttling leave registration failed without replacing application startup.
            ExitMarkerRegistration.FAILED
        }
    }

    fun capture(): ProcessExitDiagnostics {
        val records = try {
            access.read(maximumRecords + 1)
        } catch (_: SecurityException) {
            return ProcessExitDiagnostics.Failed(registration, ExitHistoryFailure.PERMISSION_DENIED)
        } catch (_: RuntimeException) {
            return ProcessExitDiagnostics.Failed(registration, ExitHistoryFailure.QUERY_FAILED)
        }
        if (records.size > maximumRecords + 1) {
            return ProcessExitDiagnostics.Failed(registration, ExitHistoryFailure.INVALID_RESPONSE)
        }
        val counts = IntArray(ProcessExitReason.entries.size)
        var other = 0
        var unmarked = 0
        for (record in records.take(maximumRecords)) {
            when {
                marker.matches(record.summary) -> counts[record.reason.ordinal]++
                marker.recognizes(record.summary) -> other++
                else -> unmarked++
            }
        }
        return ProcessExitDiagnostics.Collected(marker.sourceSha, registration, maximumRecords,
            records.size > maximumRecords, ProcessExitReason.entries.mapNotNull { reason ->
                counts[reason.ordinal].takeIf { it > 0 }?.let { ExitReasonCount(reason, it) }
            }, other, unmarked)
    }
}

internal fun ProcessExitDiagnostics.toJson() = buildJsonObject {
    put("producer", "ActivityManager.getHistoricalProcessExitReasons")
    put("scope", "system-retained-package-history")
    put("historyComplete", false)
    when (val value = this@toJson) {
        ProcessExitDiagnostics.Unavailable -> put("observation", "unavailable")
        is ProcessExitDiagnostics.Failed -> {
            put("observation", "failed")
            put("markerRegistration", value.registration.wire)
            put("failure", value.failure.wire)
        }
        is ProcessExitDiagnostics.Collected -> {
            put("observation", "last-known")
            put("markerRegistration", value.registration.wire)
            put("sourceSha", value.sourceSha)
            put("recordLimit", value.recordLimit)
            put("additionalRecordObserved", value.additionalRecordObserved)
            put("records", value.records)
            put("matchingBuildRecords", value.matchingBuildRecords)
            put("otherBuildRecords", value.otherBuildRecords)
            put("unmarkedRecords", value.unmarkedRecords)
            put("matchingBuildReasons", buildJsonArray {
                value.matchingBuild.forEach { row -> add(buildJsonObject {
                    put("reason", row.reason.wire); put("count", row.count)
                }) }
            })
        }
    }
}
