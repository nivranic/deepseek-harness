package ai.deepseek.dsh.companion

/** One explicit prompt intent. Retrying unchanged text retains its Host deduplication identity. */
data class SessionDraft(val text: String, val requestId: String)

/** A failed prompt keeps its target and complete refusal separate from its diagnostic category. */
data class PromptSubmissionFailure(val sessionId: String, val category: ConnectionFailure, val refusal: GatewayFailureEnvelope?)

/** An explicit interaction reply failure retains its Gateway envelope for classification and diagnostics. */
data class InteractionReplyFailure(val category: ConnectionFailure, val refusal: GatewayFailureEnvelope?)

/** User answers belong to one Host-delivered revision in the current connection's model set. */
data class QuestionDraftKey(val sessionId: String, val interactionId: String, val revision: Long)

/** Identity used to retain answers through UI disposal and event-stream replacement. */
val PendingInteraction.questionDraftKey: QuestionDraftKey
    get() = QuestionDraftKey(sessionId, id, revision)
