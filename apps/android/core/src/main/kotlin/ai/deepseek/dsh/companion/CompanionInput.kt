package ai.deepseek.dsh.companion

/** One ordered Host-staged attachment; its receipt remains Session-scoped. */
sealed interface SessionAttachment {
    val receiptId: String
    val attachmentId: String
    val name: String?
    val bytes: Long
}

/** Identity-bearing exclusion between one attachment operation and prompt admission. */
internal class SessionAttachmentAdmission

data class SessionFileAttachment(override val receiptId: String, override val attachmentId: String,
                                 override val name: String, override val bytes: Long) : SessionAttachment

data class SessionImageDimensions(val width: Int, val height: Int)

/** Normalized Host image metadata, independent of the selected source's encoded size and dimensions. */
data class SessionImageAttachment(override val receiptId: String, override val attachmentId: String,
                                  val mediaType: String, override val bytes: Long, val width: Int, val height: Int,
                                  override val name: String? = null,
                                  val originalDimensions: SessionImageDimensions? = null) : SessionAttachment

/** One complete prompt intent. Retrying unchanged text and files retains its Host deduplication identity. */
data class SessionDraft(val text: String, val requestId: String, val attachments: List<SessionAttachment> = emptyList())

/** A failed prompt keeps its target and complete refusal separate from its diagnostic category. */
data class PromptSubmissionFailure(val sessionId: String, val category: ConnectionFailure, val refusal: GatewayFailureEnvelope?) {
    /** Whether the Host reports a missing staged file or image receipt. */
    val attachmentReceiptUnavailable: Boolean
        get() {
            val envelope = refusal ?: return false
            if (envelope.code != "session/attachment-invalid") return false
            return when (envelope.details?.let { WireShape.string(it, "reason") }) {
                "FILE_NOT_STAGED", "IMAGE_NOT_STAGED" -> true
                else -> false
            }
        }
}

/** An explicit interaction reply failure retains its Gateway envelope for classification and diagnostics. */
data class InteractionReplyFailure(val category: ConnectionFailure, val refusal: GatewayFailureEnvelope?)

/** User answers belong to one Host-delivered revision in the current connection's model set. */
data class QuestionDraftKey(val sessionId: String, val interactionId: String, val revision: Long)

/** Identity used to retain answers through UI disposal and event-stream replacement. */
val PendingInteraction.questionDraftKey: QuestionDraftKey
    get() = QuestionDraftKey(sessionId, id, revision)
