package ai.deepseek.dsh.companion

import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.withContext

/** One deferred provider source; an image declaration cannot fall back to generic-file admission. */
data class NativeShareItem(val source: NativeFileAttachmentSource, val requireImage: Boolean = false)

/** The reviewed target and ordered content captured by one explicit import confirmation. */
data class NativeShareRequest(val sessionId: String, val selectionGeneration: Long, val text: String,
                            val items: List<NativeShareItem>, val allowedKinds: Set<NativeAttachmentKind>)

/** Application-supplied UTF-8 limit for the incoming shared text, independent of attachment limits. */
data class NativeShareLimits(val maxTextBytes: Int) {
    init { require(maxTextBytes > 0) }
}

enum class NativeShareIssue { BUSY, STALE_TARGET, CANCELLED, EMPTY, TEXT_TOO_LARGE, KIND_UNAVAILABLE, ATTACHMENT_FAILED, INPUT_FAILED }

/** Adoption survives save failure and cancellation; retrying an adopted import would duplicate its content. */
sealed interface NativeShareResult {
    /** The complete batch is already in the draft; saved reports completion of its local checkpoint. */
    data class Adopted(val requestId: String, val saved: Boolean) : NativeShareResult
    data class NotAdopted(val issue: NativeShareIssue, val attachmentIssue: NativeFileAttachmentIssue? = null,
                         val failure: ConnectionFailure? = null, val refusal: GatewayFailureEnvelope? = null) : NativeShareResult
}

/** One model-owned import whose final result is independent of coroutine cancellation. */
class NativeShareImport internal constructor(private val job: Job, private val result: Deferred<NativeShareResult>) {
    /** Request cancellation immediately; provider and RPC work may still require awaited retirement. */
    fun cancel() { job.cancel() }

    /** Wait for the final adoption fact after owned work settles and prompt admission is released. */
    suspend fun awaitResult(): NativeShareResult = result.await()

    /** Cancel and await owned work even when the caller is cancelled, preserving any completed adoption. */
    suspend fun cancelAndAwait(): NativeShareResult = withContext(NonCancellable) {
        job.cancelAndJoin()
        result.await()
    }
}
