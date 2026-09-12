package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkDiagnosticSnapshot
import ai.deepseek.dsh.link.LinkDescriptionState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.put
import java.security.MessageDigest

/** Fixed refusals contain no underlying messages, findings, paths or document content. */
enum class SupportExportFailure {
    INVALID_IDENTITY, INVALID_POLICY, UNAVAILABLE, INVALID_SCANNER, OVERSIZED,
    SCAN_FAILED, SECRETS_DETECTED, TIMED_OUT, CANCELLED, SAVE_FAILED,
}

class SupportExportException(val failure: SupportExportFailure) : Exception(failure.name)

/** Carrier-owned limits apply to the complete UTF-8 document and one joined scan. */
data class SupportExportPolicy(val maximumBytes: Int, val scanMilliseconds: Long) {
    init {
        if (maximumBytes !in 1..16 * 1024 * 1024 || scanMilliseconds !in 1..60_000) {
            throw SupportExportException(SupportExportFailure.INVALID_POLICY)
        }
    }
}

/** Product fields come from installed application metadata, never a Host description. */
data class SupportProductIdentity(val version: String, val buildNumber: Long, val channel: String) {
    init {
        val parts = version.split('-', limit = 2)
        val numbers = parts[0].split('.')
        val validNumbers = numbers.size == 3 && numbers.all { part ->
            part.toIntOrNull()?.let { it in 0..65535 && it.toString() == part } == true
        }
        val prerelease = parts.getOrNull(1)
        val validPrerelease = prerelease == null || prerelease.split('.').all { part ->
            part.isNotEmpty() && part.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '-' } &&
                (!part.all { it in '0'..'9' } || part == "0" || !part.startsWith('0'))
        }
        if (version.length !in 1..128 || !validNumbers || !validPrerelease || buildNumber !in 1..65535 ||
            channel !in setOf("dev", "canary", "beta", "stable") ||
            channel == "stable" && prerelease != null || channel == "canary" && prerelease == null ||
            channel == "beta" && prerelease?.substringBefore('.') !in setOf("beta", "rc")) {
            throw SupportExportException(SupportExportFailure.INVALID_IDENTITY)
        }
    }
}

/** Captured from the current owners before encoding or scanning; reading it performs no I/O. */
data class SupportLocalSnapshot(
    val identityRestored: Boolean,
    val link: LinkDiagnosticSnapshot?,
    val connections: ConnectionSnapshots,
)

data class SupportScannerIdentity(val version: String, val rulesDigest: String, val sourceSha: String, val nativeSha256: String)

/** A synchronous native operation; cancellation must return only after any running scan finishes. */
interface SupportScanOperation {
    fun run(): SupportScanResult
    fun cancelAndJoin()
}

data class SupportScanResult(val status: String, val bytes: ByteArray?, val digest: String)

/** Each operation must own a copy of its input before [open] returns. */
interface SupportDocumentScanner {
    fun identity(): SupportScannerIdentity
    fun open(document: ByteArray, policy: SupportExportPolicy): SupportScanOperation
}

/** Approved bytes stay immutable; a destination receives a fresh copy. */
class ApprovedSupportDocument private constructor(private val data: ByteArray) {
    val digest: String = supportSha256(data)
    fun copyBytes(): ByteArray = data.copyOf()

    companion object {
        internal fun admitted(input: ByteArray, result: SupportScanResult): ApprovedSupportDocument {
            if (result.status != "approved") {
                val reason = when (result.status) {
                    "cancelled" -> SupportExportFailure.CANCELLED
                    "timed-out" -> SupportExportFailure.TIMED_OUT
                    "invalid-scanner" -> SupportExportFailure.INVALID_SCANNER
                    "secrets-detected" -> SupportExportFailure.SECRETS_DETECTED
                    else -> SupportExportFailure.SCAN_FAILED
                }
                throw SupportExportException(reason)
            }
            val bytes = result.bytes
            if (bytes == null || !input.contentEquals(bytes) || supportSha256(bytes) != result.digest) {
                throw SupportExportException(SupportExportFailure.INVALID_SCANNER)
            }
            return ApprovedSupportDocument(bytes.copyOf())
        }
    }
}

/** Serialize before admission; cancellation joins native work before returning to the caller. */
class SupportDocumentExporter(private val scanner: SupportDocumentScanner, private val policy: SupportExportPolicy) {
    suspend fun prepare(product: SupportProductIdentity, snapshot: SupportLocalSnapshot): ApprovedSupportDocument =
        supervisorScope {
            val input = withContext(Dispatchers.IO) { encodeSupportDocument(product, snapshot, scanner.identity(), policy.maximumBytes) }
            val operation = withContext(Dispatchers.IO) { scanner.open(input, policy) }
            val worker = async(Dispatchers.IO) { operation.run() }
            try {
                val result = worker.await()
                currentCoroutineContext().ensureActive()
                ApprovedSupportDocument.admitted(input, result)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: SupportExportException) {
                throw failure
            } catch (_: Exception) {
                throw SupportExportException(SupportExportFailure.SCAN_FAILED)
            } finally {
                withContext(NonCancellable + Dispatchers.IO) {
                    try { operation.cancelAndJoin() } finally { worker.join() }
                }
            }
        }
}

internal fun supportSha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }

/** Explicit projection excludes identity storage, messages and arbitrary protocol fields. */
internal fun encodeSupportDocument(product: SupportProductIdentity, snapshot: SupportLocalSnapshot,
                                   scanner: SupportScannerIdentity, maximumBytes: Int): ByteArray {
    if (!Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(scanner.version) || scanner.version.length > 32 ||
        !Regex("[a-f0-9]{40}").matches(scanner.sourceSha) ||
        listOf(scanner.rulesDigest, scanner.nativeSha256).any { !Regex("[a-f0-9]{64}").matches(it) }) {
        throw SupportExportException(SupportExportFailure.INVALID_SCANNER)
    }
    val value = buildJsonObject {
        put("schemaVersion", 1)
        put("platform", "android")
        put("runtimeClass", "companion")
        put("complete", false)
        put("product", buildJsonObject {
            put("version", product.version); put("buildNumber", product.buildNumber); put("channel", product.channel)
        })
        put("localIdentity", buildJsonObject {
            put("producer", "CompanionRuntime"); put("observation", "current"); put("restored", snapshot.identityRestored)
        })
        put("transport", buildJsonObject {
            put("producer", "LinkClient"); put("observation", if (snapshot.link == null) "unavailable" else "current")
            snapshot.link?.requests?.let {
                put("closed", it.closed); put("pendingRequests", it.pendingRequests)
                put("startedRequests", it.startedRequests); put("finishedRequests", it.finishedRequests)
                put("countsSaturated", it.startedRequests == Long.MAX_VALUE || it.finishedRequests == Long.MAX_VALUE)
            }
        })
        put("connections", snapshot.connections.toJson())
        put("role", buildJsonObject {
            put("producer", "LinkCredentials")
            val role = snapshot.link?.lastKnownRole
            put("observation", if (role == null) "unavailable" else "last-known")
            role?.let { put("value", it.wire) }
        })
        val description = snapshot.link?.description
        val descriptionObservation = when {
            description != null -> "last-known"
            snapshot.link?.descriptionState == LinkDescriptionState.FAILED -> "failed"
            else -> "unavailable"
        }
        put("protocol", buildJsonObject {
            put("producer", "LinkClient.describe"); put("observation", descriptionObservation)
            put("queryState", snapshot.link?.descriptionState?.wire ?: "unavailable")
            snapshot.link?.descriptionFailure?.let { put("failure", it.wire) }
            description?.let {
                put("linkProtocolVersion", it.linkProtocolVersion); put("contractVersion", it.contractVersion)
                put("sessionFormatVersion", it.sessionFormatVersion); put("runtimeClass", it.runtimeClass.wire)
                put("allowRemoteApproval", it.allowRemoteApproval)
            }
        })
        put("capabilities", buildJsonObject {
            put("producer", "LinkClient.describe"); put("observation", descriptionObservation)
            description?.capabilities?.let {
                put("session", buildJsonObject {
                    put("list", it.session.list); put("history", it.session.history); put("follow", it.session.follow)
                    put("prompt", it.session.prompt); put("cancel", it.session.cancel)
                })
                put("workspace", buildJsonObject { put("follow", it.workspace.follow) })
                put("interaction", buildJsonObject { put("approval", it.interaction.approval); put("question", it.interaction.question) })
            }
        })
        put("scanner", buildJsonObject {
            put("version", scanner.version); put("rulesDigest", scanner.rulesDigest)
            put("sourceSha", scanner.sourceSha); put("nativeSha256", scanner.nativeSha256)
        })
        put("uncollected", buildJsonArray {
            listOf("runtime-health", "updates", "native-crashes", "session-diagnostics").forEach { add(it) }
        })
    }
    val bytes = (Json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), value) + "\n").toByteArray(Charsets.UTF_8)
    if (bytes.size > maximumBytes) throw SupportExportException(SupportExportFailure.OVERSIZED)
    return bytes
}
