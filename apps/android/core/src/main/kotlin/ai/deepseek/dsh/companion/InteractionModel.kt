package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex

/** One Host question; selected labels and custom text retain their separate wire meanings. */
data class CompanionQuestion(val id: String, val question: String, val detail: String?, val options: List<CompanionQuestionOption>, val multiSelect: Boolean)

/** A choice keeps its explanatory text separate from the exact label returned to the Host. */
data class CompanionQuestionOption(val label: String, val description: String?)

/** Human input for one question in a Host-owned request. */
data class CompanionQuestionAnswer(val id: String, val selected: List<String>, val custom: String? = null)

/** Protocol-2 interaction inbox. Host pending snapshots retire closed cards on reconnect;
 * replies carry the delivered revision and current event-client identity.
 * Failed replies retain the card for explicit retry; they never fabricate completion.
 */
class InteractionModel(
    private val wire: WireDriving,
    private val scope: CoroutineScope,
    private val reconnectDelayMillis: Long = 1000,
) {
    init { require(reconnectDelayMillis > 0) }
    private val _inbox = MutableStateFlow<List<PendingInteraction>>(emptyList())
    val inbox: StateFlow<List<PendingInteraction>> = _inbox
    private val _answering = MutableStateFlow(false)
    val answering: StateFlow<Boolean> = _answering
    private val _clientId = MutableStateFlow("")
    val clientId: StateFlow<String> = _clientId
    private val _lastRefusal = MutableStateFlow<String?>(null)
    val lastRefusal: StateFlow<String?> = _lastRefusal
    private val _replyFailure = MutableStateFlow<InteractionReplyFailure?>(null)
    val replyFailure: StateFlow<InteractionReplyFailure?> = _replyFailure
    private val _streamFailure = MutableStateFlow<String?>(null)
    val streamFailure: StateFlow<String?> = _streamFailure
    private val _drafts = MutableStateFlow<Map<QuestionDraftKey, List<CompanionQuestionAnswer>>>(emptyMap())
    val drafts: StateFlow<Map<QuestionDraftKey, List<CompanionQuestionAnswer>>> = _drafts
    private val answerLock = Mutex()
    private val watchOwner = StreamTransitionOwner(scope)
    val connectionSnapshot: ConnectionSnapshot get() = watchOwner.connectionSnapshot

    /** Edit one answer without dispatching it; stale cards cannot recreate retired input. */
    fun updateAnswer(pending: PendingInteraction, answer: CompanionQuestionAnswer) {
        if (_inbox.value.none { it.questionDraftKey == pending.questionDraftKey }) return
        require(pending.kind == PendingInteraction.Kind.QUESTION && pending.questions.any { it.id == answer.id })
        _drafts.update { drafts ->
            val previous = drafts[pending.questionDraftKey].orEmpty()
            drafts + (pending.questionDraftKey to (previous.filterNot { it.id == answer.id } + answer))
        }
    }

    fun startWatching() = watchOwner.replaceAsync(create = { generation -> watch(generation) },
        publish = { _clientId.value = ""; _streamFailure.value = null }, invalidate = { _clientId.value = "" })

    fun stopWatching() { watchOwner.stop { _clientId.value = "" } }
    suspend fun stopWatchingAndAwait() { watchOwner.stopAndAwait { _clientId.value = "" } }

    /** UI disposal does not cancel a reply; retiring the connection's model set still does. */
    fun submitQuestions(pending: PendingInteraction, answers: List<CompanionQuestionAnswer>): Job =
        scope.launch(start = CoroutineStart.UNDISPATCHED) { answerQuestions(pending, answers) }

    /** Start one explicit approval in the same lifetime as the other connection-owned mutations. */
    fun submitApproval(pending: PendingInteraction, allowedOnce: Boolean): Job =
        scope.launch(start = CoroutineStart.UNDISPATCHED) { answer(pending, allowedOnce) }

    private fun watch(generation: Long): Job = scope.launch(start = CoroutineStart.LAZY) {
        while (isActive && watchOwner.isCurrent(generation)) {
            _clientId.value = ""
            watchOwner.attempt(generation)
            try {
                wire.stream("\$events").collect { frame ->
                    if (!watchOwner.isCurrent(generation)) return@collect
                    collect(frame)
                    _streamFailure.value = null
                    watchOwner.received(generation)
                }
                watchOwner.interrupted(generation, null)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                watchOwner.interrupted(generation, error)
                if (watchOwner.isCurrent(generation)) _streamFailure.value = observationFailureText(error)
                if (!canReconnectObservation(error)) return@launch
            } finally {
                if (watchOwner.isCurrent(generation)) _clientId.value = ""
            }
            if (isActive && watchOwner.isCurrent(generation)) {
                watchOwner.retrying(generation)
                delay(reconnectDelayMillis)
            }
        }
    }

    fun collect(frame: WireValue) {
        when (WireShape.string(frame, "type")) {
            "ready" -> {
                val client = string(frame, "clientId")
                val pending = strings(WireShape.array(frame, "pendingInteractionIds") ?: invalid("pending interactions"))
                _inbox.update { cards -> cards.filter { it.id in pending } }
                _drafts.update { drafts -> drafts.filterKeys { it.interactionId in pending } }
                _clientId.value = client
                return
            }
            "cancel" -> {
                val id = WireShape.string(frame, "eventId") ?: return
                _inbox.update { cards -> cards.filterNot { it.id == id } }
                _drafts.update { drafts -> drafts.filterKeys { it.interactionId != id } }
                return
            }
            "waterfall" -> Unit
            else -> return
        }
        val event = WireShape.string(frame, "event")
        val kind = when (event) {
            "approval/request" -> PendingInteraction.Kind.APPROVAL
            "user-questions/request" -> PendingInteraction.Kind.QUESTION
            else -> return
        }
        val id = WireShape.string(frame, "eventId")?.takeIf(String::isNotBlank) ?: return
        WireShape.string(frame, "agentId")?.takeIf(String::isNotBlank) ?: return
        val interaction = WireShape.objectValue(frame, "interaction") ?: invalid("interaction metadata")
        val expectedType = if (kind == PendingInteraction.Kind.APPROVAL) "approval" else "question"
        if (string(interaction, "requestId") != id || string(interaction, "type") != expectedType ||
            string(interaction, "requiredPermission") != "$expectedType.respond" || string(interaction, "status") != "pending") {
            invalid("interaction ownership")
        }
        val revision = WireShape.number(interaction, "revision") ?: invalid("interaction revision")
        if (revision < 1 || revision > 9_007_199_254_740_991.0 || revision % 1.0 != 0.0) invalid("interaction revision")
        val request = WireShape.objectValue(frame, "request") ?: invalid("interaction request")
        val questions = if (kind == PendingInteraction.Kind.QUESTION) parseQuestions(request) else emptyList()
        val pending = PendingInteraction(id, kind, string(interaction, "sessionId"),
            if (kind == PendingInteraction.Kind.APPROVAL) string(request, "toolName") else questions.first().question,
            if (kind == PendingInteraction.Kind.APPROVAL) WireShape.string(request, "reason") ?: ""
            else questions.first().detail ?: "", revision.toLong(), questions)
        _inbox.update { cards ->
            if (cards.any { it.id == id && it.revision == pending.revision }) cards
            else cards.filterNot { it.id == id } + pending
        }
        _drafts.update { drafts -> drafts.filterKeys { it.interactionId != id || it == pending.questionDraftKey } }
    }

    /** A boolean approval never substitutes for structured Question answers. */
    suspend fun answer(pending: PendingInteraction, allowedOnce: Boolean) {
        require(pending.kind == PendingInteraction.Kind.APPROVAL) { "Question requires structured answers" }
        submit(pending, WireValue.StringValue(if (allowedOnce) "allowed-once" else "rejected"))
    }

    /** Validate the user's selected labels and custom text before encoding a complete answer set. */
    suspend fun answerQuestions(pending: PendingInteraction, answers: List<CompanionQuestionAnswer>) {
        require(pending.kind == PendingInteraction.Kind.QUESTION)
        require(answers.size == pending.questions.size && answers.map { it.id }.toSet() == pending.questions.map { it.id }.toSet())
        val indexed = answers.associateBy { it.id }
        val encoded = pending.questions.map { question ->
            val answer = indexed.getValue(question.id)
            require(answer.selected.distinct().size == answer.selected.size && answer.selected.all { selected -> question.options.any { it.label == selected } })
            require(question.multiSelect || answer.selected.size <= 1)
            val custom = answer.custom?.trim()?.takeIf(String::isNotEmpty)
            require(answer.selected.isNotEmpty() || custom != null)
            require(question.multiSelect || answer.selected.isEmpty() || custom == null)
            WireValue.ObjectValue(buildMap {
                put("id", WireValue.StringValue(question.id))
                put("selected", WireValue.ArrayValue(answer.selected.map(WireValue::StringValue)))
                if (custom != null) put("custom", WireValue.StringValue(custom))
            })
        }
        if (_inbox.value.any { it.questionDraftKey == pending.questionDraftKey }) {
            _drafts.update { it + (pending.questionDraftKey to answers.map { answer -> answer.copy(selected = answer.selected.toList()) }) }
        }
        submit(pending, WireValue.ObjectValue(mapOf("answers" to WireValue.ArrayValue(encoded))))
    }

    private suspend fun submit(pending: PendingInteraction, value: WireValue) {
        if (!answerLock.tryLock()) return
        _answering.value = true
        _lastRefusal.value = null
        _replyFailure.value = null
        try {
            val client = _clientId.value
            if (client.isEmpty()) { _lastRefusal.value = "Remote Event stream is not ready."; return }
            if (_inbox.value.none { it.id == pending.id && it.revision == pending.revision }) {
                _lastRefusal.value = "Interaction is no longer pending."
                return
            }
            wire.call("\$events/result", mapOf("clientId" to WireValue.StringValue(client),
                "eventId" to WireValue.StringValue(pending.id), "interactionRevision" to WireValue.NumberValue(pending.revision.toDouble()),
                "outcome" to WireValue.ObjectValue(mapOf("kind" to WireValue.StringValue("result"), "value" to value))))
            _inbox.update { cards -> cards.filterNot { it.id == pending.id && it.revision == pending.revision } }
            _drafts.update { it - pending.questionDraftKey }
        } catch (error: CancellationException) {
            _replyFailure.value = InteractionReplyFailure(ConnectionFailure.CANCELLED, null)
            throw error
        }
        catch (error: Exception) {
            _replyFailure.value = InteractionReplyFailure(ConnectionFailure.from(error),
                (error as? LinkClientException.Refused)?.let(GatewayFailureEnvelope::from))
            _lastRefusal.value = observationFailureText(error)
        }
        finally { _answering.value = false; answerLock.unlock() }
    }

    private fun parseQuestions(request: WireValue): List<CompanionQuestion> {
        val questions = (WireShape.array(request, "questions") ?: invalid("questions")).map { item ->
            val options = WireShape.array(item, "options")?.map {
                CompanionQuestionOption(string(it, "label"), WireShape.string(it, "description"))
            } ?: emptyList()
            if (options.map { it.label }.distinct().size != options.size) invalid("duplicate question option")
            CompanionQuestion(string(item, "id"), string(item, "question"), WireShape.string(item, "detail"),
                options, WireShape.boolean(item, "multiSelect") ?: false)
        }
        if (questions.isEmpty() || questions.map { it.id }.distinct().size != questions.size) invalid("question identities")
        return questions
    }

    private fun string(value: WireValue, field: String): String =
        WireShape.string(value, field)?.takeIf(String::isNotBlank) ?: invalid(field)

    private fun strings(values: List<WireValue>): Set<String> = values.map {
        (it as? WireValue.StringValue)?.value?.takeIf(String::isNotBlank) ?: invalid("interaction id")
    }.toSet()

    private fun invalid(field: String): Nothing = throw LinkClientException.BadWire("invalid $field")
}
