package ai.deepseek.dsh.link

import ai.deepseek.dsh.companion.DomainState
import ai.deepseek.dsh.companion.InteractionModel
import ai.deepseek.dsh.companion.LinkWireDriving
import ai.deepseek.dsh.companion.PendingInteraction
import ai.deepseek.dsh.companion.SessionModel
import ai.deepseek.dsh.companion.SwitchableWireDriving
import ai.deepseek.dsh.companion.WireDriving
import ai.deepseek.dsh.companion.WireShape
import ai.deepseek.dsh.companion.toJson
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.transform
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Duration

/**
 * Runs the production Kotlin companion models against the Host-owned Link acceptance process.
 * The result is published only after every corpus step passes; configuration secrets and paired
 * credentials never enter the result document.
 */
object LinkNativeAcceptance {
    /**
     * Run the standalone acceptance driver configured by `DSH_LINK_ACCEPTANCE_CONFIG`.
     * @param args must be empty; the environment-owned config carries every input.
     */
    @JvmStatic
    fun main(args: Array<String>) {
        require(args.isEmpty()) { "native acceptance takes no command-line arguments" }
        val configPath = System.getenv(CONFIG_ENV)
            ?.takeIf { it.isNotBlank() }
            ?.let { Path.of(it) }
            ?: throw AcceptanceFailure("$CONFIG_ENV must name the acceptance config")
        val config = AcceptanceConfig.read(configPath)
        val corpusBytes = Files.readAllBytes(config.corpusPath)
        val corpus = AcceptanceCorpus.parse(corpusBytes)
        corpus.validateConfig(config)
        validateCandidateResultPath(config.dshHome, config.candidateResultPath)
        val result = runBlocking { AcceptanceRun(config, corpus).execute() }
        writeAtomically(config.dshHome, config.candidateResultPath, result.toJson())
    }

    private const val CONFIG_ENV = "DSH_LINK_ACCEPTANCE_CONFIG"
}

private class AcceptanceRun(
    private val config: AcceptanceConfig,
    private val corpus: AcceptanceCorpus,
) {
    private val steps = StepRecorder(corpus.stepIds)
    private val scopeJob = SupervisorJob()
    private val scope = CoroutineScope(scopeJob + Dispatchers.IO)
    private val transportConfig = LinkTransportConfig(
        connectTimeoutMillis = 10_000,
        writeTimeoutMillis = 30_000,
        unaryReadTimeoutMillis = 30_000,
        unaryCallTimeoutMillis = 60_000,
        streamReadTimeoutMillis = 0,
        streamCallTimeoutMillis = 0,
    )
    private val control = AcceptanceControl(config.controlEndpoint, config.controlToken)
    private val store = MemoryLinkCredentialsStore()
    private val client = LinkClient(
        baseUrl = config.pairing.endpoint,
        pinnedFingerprint = config.pairing.spkiFingerprint,
        store = store,
        transportConfig = transportConfig,
    )
    private val unpairedClient = LinkClient(
        baseUrl = config.pairing.endpoint,
        pinnedFingerprint = config.pairing.spkiFingerprint,
        store = MemoryLinkCredentialsStore(),
        transportConfig = transportConfig,
    )
    private val switchable = SwitchableWireDriving(LinkWireDriving(unpairedClient))
    private val wire = ObservingWireDriving(switchable)
    private val sessionModel = SessionModel(wire, scope, reconnectDelayMillis = 100)
    private val interactionModel = InteractionModel(wire, scope, reconnectDelayMillis = 100)

    suspend fun execute(): AcceptanceResult {
        var result: AcceptanceResult? = null
        var primary: Throwable? = null
        try {
            pair()
            val description = connect()
            describe(description)
            list()

            val opening = open()
            history(opening)
            follow(opening)

            val promptMark = prompt()
            val completedTurn = stream(opening, promptMark)
            val approval = approval(opening, completedTurn)
            val cancelledTurn = cancel(opening, approval.turn)
            val recovery = reconnect(opening, completedTurn, approval, cancelledTurn)
            revoke()

            steps.requireComplete()
            result = AcceptanceResult(
                corpusSha256 = LinkSigning.sha256Hex(corpus.bytes),
                hostCommit = config.hostCommit,
                clientCommit = config.clientCommit,
                linkProtocolVersion = description.linkProtocolVersion.toInt(),
                contractVersion = description.contractVersion.toInt(),
                sessionFormatVersion = description.sessionFormatVersion.toInt(),
                steps = steps.result(),
                recovery = recovery,
            )
        } catch (failure: Throwable) {
            primary = failure
        }
        val cleanupFailures = withContext(NonCancellable) { collectCleanupFailures() }
        val failure = primary ?: cleanupFailures.firstOrNull()
        if (failure != null) {
            val suppressed = if (primary == null) cleanupFailures.drop(1) else cleanupFailures
            suppressed.filter { it !== failure }.forEach(failure::addSuppressed)
            throw failure
        }
        return result ?: throw AcceptanceFailure("acceptance completed without a result")
    }

    private suspend fun pair() {
        accept(client.credentials == null, "acceptance client was paired before the pair step")
        accept(unpairedClient.credentials == null, "SwitchableWireDriving did not start unpaired")
        val credentials = client.pair(config.pairing, config.deviceName)
        accept(credentials.deviceId.isNotEmpty(), "pair returned an empty device id")
        accept(credentials.hostId == config.pairing.hostId, "pair returned the wrong host id")
        accept(credentials.role == "controller", "pair did not grant the controller role")
        accept(store.load() == credentials, "pair did not persist the returned credentials")
        accept(unpairedClient.credentials == null, "pair mutated the pre-pairing wire")
        switchable.replaceAndAwait(LinkWireDriving(client))
        steps.pass("pair")
    }

    private suspend fun connect(): LinkHostDescription {
        val description = client.describe()
        accept(description.hostId == config.pairing.hostId, "authenticated describe returned the wrong host")
        steps.pass("connect")
        return description
    }

    private fun describe(description: LinkHostDescription) {
        accept(description.linkProtocolVersion == 1.0, "Host Link protocol version is not 1")
        accept(
            description.contractVersion == corpus.contractVersion.toDouble(),
            "Host contract version does not match corpus",
        )
        accept(description.sessionFormatVersion == 0.0, "Host Session format version is not 0")
        accept(description.runtimeClass == "full", "Host runtime class is not full")
        accept(description.allowRemoteApproval, "Host remote approval is disabled")
        with(description.capabilities.session) {
            accept(list && history && follow && prompt && cancel, "Host omitted a required session capability")
        }
        accept(description.capabilities.interaction.approval, "Host omitted the approval capability")
        accept(description.capabilities.interaction.question, "Host omitted the question capability")
        steps.pass("describe")
    }

    private suspend fun list() {
        val semantics = corpus.list
        val mark = wire.mark()
        sessionModel.loadSessions()
        accept(sessionModel.listState.value == "ready", "SessionModel did not reach the ready list state")
        accept(
            sessionModel.sessions.value.map { it.id } == semantics.expectedSessionIds,
            "SessionModel session/list did not match the corpus output",
        )
        val call = wire.awaitCall(mark, "session/list")
        val request = call.args["_request"] as? WireValue.ObjectValue
            ?: throw AcceptanceFailure("SessionModel session/list omitted _request")
        accept(request.entries.isEmpty(), "SessionModel session/list _request was not empty")
        accept(
            sessionIds(call.result) == semantics.expectedSessionIds,
            "session/list result did not match the corpus output",
        )
        accept(
            semantics.decoySessionId !in semantics.expectedSessionIds,
            "corpus session/list output exposed its decoy session",
        )
        steps.pass("list")
    }

    private suspend fun open(): OpeningSnapshot {
        val mark = wire.mark()
        sessionModel.openSession(config.sessionId)
        val opened = wire.awaitStreamOpen(mark, "session/follow")
        validateFollowPayload(opened.payload, config.sessionId)
        val frame = wire.awaitFrame(opened.sequence, "session/follow", opened.generation) { value ->
            WireShape.string(value, "type") == "snapshot"
        }
        val opening = OpeningSnapshot.parse(frame.value, config.sessionId, opened.generation)
        steps.pass("open")
        return opening
    }

    private suspend fun history(opening: OpeningSnapshot) {
        val semantics = corpus.history
        val value = wire.call(
            "session/page",
            mapOf(
                "request" to WireValue.ObjectValue(
                    mapOf(
                        "address" to sessionAddress(semantics.targetSessionId),
                        "throughSeq" to WireValue.NumberValue(opening.cursor.toDouble()),
                        "maxMessages" to WireValue.NumberValue(MAX_MESSAGES.toDouble()),
                    ),
                ),
            ),
        )
        val records = WireShape.array(value, "records")
            ?: throw AcceptanceFailure("session/page omitted records")
        val hasMore = WireShape.boolean(value, "hasMore")
            ?: throw AcceptanceFailure("session/page omitted hasMore")
        when (semantics.expectedTargetRelation) {
            "matches-follow-opening" -> {
                accept(records == opening.records, "session/page and follow snapshot returned different records")
                accept(hasMore == opening.hasMore, "session/page and follow snapshot disagreed on hasMore")
            }
            else -> throw AcceptanceFailure("unsupported history target relation")
        }
        expectRefused(semantics.decoyErrorCode) {
            wire.call(
                "session/page",
                mapOf(
                    "request" to WireValue.ObjectValue(
                        mapOf(
                            "address" to sessionAddress(semantics.decoySessionId),
                            "throughSeq" to WireValue.NumberValue(opening.cursor.toDouble()),
                            "maxMessages" to WireValue.NumberValue(MAX_MESSAGES.toDouble()),
                        ),
                    ),
                ),
            )
        }
        steps.pass("history")
    }

    private suspend fun follow(opening: OpeningSnapshot) {
        validateSnapshot(opening)
        awaitSessionState("SessionModel opening snapshot") { state ->
            state.cursor == opening.cursor && state.items.isNotEmpty()
        }
        steps.pass("follow")
    }

    private suspend fun prompt(): Long {
        val semantics = corpus.prompt
        expectRefused(semantics.decoyErrorCode) {
            wire.call(
                "session/prompt",
                mapOf(
                    "request" to WireValue.ObjectValue(
                        mapOf(
                            "requestId" to WireValue.StringValue("kotlin-decoy-${java.util.UUID.randomUUID()}"),
                            "sessionId" to WireValue.StringValue(semantics.decoySessionId),
                            "mode" to WireValue.StringValue("queue"),
                            "content" to WireValue.ArrayValue(
                                listOf(
                                    WireValue.ObjectValue(
                                        mapOf(
                                            "type" to WireValue.StringValue("text"),
                                            "text" to WireValue.StringValue(semantics.text),
                                        ),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            )
        }
        val mark = wire.mark()
        sessionModel.send(semantics.text)
        accept(!sessionModel.sending.value, "SessionModel remained in the sending state")
        val call = wire.awaitCall(mark, "session/prompt")
        validatePromptCall(
            call,
            targetSessionId = semantics.targetSessionId,
            text = semantics.text,
            expectedAccepted = semantics.expectedAccepted,
        )
        steps.pass("prompt")
        return mark
    }

    private suspend fun stream(opening: OpeningSnapshot, after: Long): CompletedTurn {
        val started = wire.awaitFrame(after, "session/follow", opening.generation) { value ->
            eventOf(value)?.let { event -> WireShape.string(event, "type") == "turn/start" } == true
        }
        val turn = eventTurn(eventOf(started.value) ?: throw AcceptanceFailure("turn/start omitted event"))
            ?: throw AcceptanceFailure("turn/start omitted turn")
        val assistant = wire.awaitFrame(started.sequence, "session/follow", opening.generation) { value ->
            val event = eventOf(value) ?: return@awaitFrame false
            WireShape.string(event, "type") == "assistant/message"
                && eventTurn(event) == turn
                && assistantText(event) == corpus.prompt.expectedResponseText
        }
        val assistantSeq = eventSeq(
            eventOf(assistant.value) ?: throw AcceptanceFailure("assistant/message omitted event"),
        ) ?: throw AcceptanceFailure("assistant/message omitted seq")
        val completed = wire.awaitFrame(assistant.sequence, "session/follow", opening.generation) { value ->
            val event = eventOf(value) ?: return@awaitFrame false
            WireShape.string(event, "type") == "turn/end"
                && eventTurn(event) == turn
        }
        val completedEvent = eventOf(completed.value)
            ?: throw AcceptanceFailure("completed turn/end omitted event")
        accept(turnEndKind(completedEvent) == "completed", "success turn did not end as completed")
        val completedSeq = eventSeq(
            completedEvent,
        ) ?: throw AcceptanceFailure("completed turn/end omitted seq")
        awaitSessionState("SessionModel completed turn") { state ->
            state.items.any { it.seq == completedSeq && it.kind == "turn/end" }
                && state.items.any {
                    it.seq == assistantSeq
                        && it.kind == "assistant/message"
                        && it.text == corpus.prompt.expectedResponseText
                }
        }
        steps.pass("stream")
        return CompletedTurn(turn = turn, assistantSeq = assistantSeq, seq = completedSeq)
    }

    private suspend fun approval(opening: OpeningSnapshot, completed: CompletedTurn): ApprovalState {
        val eventsMark = wire.mark()
        interactionModel.startWatching()
        val eventStream = wire.awaitStreamOpen(eventsMark, "\$events")
        accept(eventStream.payload.isEmpty(), "InteractionModel \$events payload was not empty")
        val ready = wire.awaitFrame(eventStream.sequence, "\$events", eventStream.generation) { value ->
            WireShape.string(value, "type") == "ready"
        }
        val clientId = WireShape.string(ready.value, "clientId")
            ?.takeIf { it.isNotEmpty() }
            ?: throw AcceptanceFailure("\$events ready omitted clientId")
        awaitClientId(clientId)

        val promptMark = wire.mark()
        sessionModel.send(corpus.stallPrompt)
        validatePromptCall(
            wire.awaitCall(promptMark, "session/prompt"),
            targetSessionId = corpus.prompt.targetSessionId,
            text = corpus.stallPrompt,
            expectedAccepted = true,
        )
        val started = wire.awaitFrame(promptMark, "session/follow", opening.generation) { value ->
            val event = eventOf(value) ?: return@awaitFrame false
            WireShape.string(event, "type") == "step/start"
        }
        val startedEvent = eventOf(started.value) ?: throw AcceptanceFailure("step/start omitted event")
        val stalledTurn = eventTurn(startedEvent) ?: throw AcceptanceFailure("step/start omitted turn")
        val stepSeq = eventSeq(startedEvent) ?: throw AcceptanceFailure("step/start omitted seq")
        accept(
            stalledTurn > completed.turn && stepSeq > completed.seq,
            "stalled step did not advance beyond the completed turn",
        )
        awaitSessionState("SessionModel stalled step") { state ->
            state.items.any { it.seq == stepSeq && it.kind == "step/start" }
        }

        control.startApproval()
        val waterfall = wire.awaitFrame(ready.sequence, "\$events", eventStream.generation) { value ->
            WireShape.string(value, "type") == "waterfall"
                && WireShape.string(value, "event") == "approval/request"
        }
        validateApprovalWaterfall(waterfall.value)
        val eventId = WireShape.string(waterfall.value, "eventId")
            ?: throw AcceptanceFailure("approval waterfall omitted eventId")
        val pending = awaitPendingInteraction(eventId)
        accept(pending.kind == PendingInteraction.Kind.APPROVAL, "InteractionModel classified the approval incorrectly")
        accept(pending.title == "link-native-acceptance", "InteractionModel carried the wrong approval title")
        accept(pending.detail == "cross-language acceptance", "InteractionModel carried the wrong approval detail")
        accept(corpus.approvalOutcome == "allowed-once", "corpus approval outcome is not allowed-once")

        val answerMark = wire.mark()
        interactionModel.answer(pending, allowedOnce = true)
        accept(interactionModel.lastRefusal.value == null, "Host refused the InteractionModel approval answer")
        accept(interactionModel.inbox.value.none { it.id == eventId }, "answered approval remained in the inbox")
        validateAnswerCall(wire.awaitCall(answerMark, "\$events/result"), clientId, eventId)
        control.awaitApproval(corpus.approvalOutcome)
        steps.pass("approval")
        return ApprovalState(turn = stalledTurn, eventGeneration = eventStream.generation)
    }

    private suspend fun cancel(opening: OpeningSnapshot, stalledTurn: Long): CancelledTurn {
        val mark = wire.mark()
        sessionModel.cancelActive()
        val call = wire.awaitCall(mark, "session/cancel")
        accept(WireShape.boolean(call.result, "accepted") == true, "session/cancel was not accepted")
        val request = call.args["request"]
            ?: throw AcceptanceFailure("SessionModel cancel omitted request")
        accept(WireShape.string(request, "sessionId") == config.sessionId, "SessionModel cancelled the wrong session")
        val terminal = wire.awaitFrame(mark, "session/follow", opening.generation) { value ->
            val event = eventOf(value) ?: return@awaitFrame false
            WireShape.string(event, "type") == "turn/end" && eventTurn(event) == stalledTurn
        }
        val terminalEvent = eventOf(terminal.value) ?: throw AcceptanceFailure("cancel terminal omitted event")
        accept(isUserAbortedTurn(terminalEvent), "session/cancel did not end as aborted by the user")
        val seq = eventSeq(terminalEvent)
            ?: throw AcceptanceFailure("cancel terminal omitted seq")
        awaitSessionState("SessionModel cancelled turn") { state ->
            state.items.any { it.seq == seq && it.kind == "turn/end" }
        }
        steps.pass("cancel")
        return CancelledTurn(turn = stalledTurn, seq = seq)
    }

    private suspend fun reconnect(
        opening: OpeningSnapshot,
        completed: CompletedTurn,
        approval: ApprovalState,
        cancelled: CancelledTurn,
    ): RecoveryAcceptanceResult {
        val semantics = corpus.reconnect
        accept(semantics.fault == "interrupt-active-streams", "corpus reconnect fault is unsupported")
        val firstClientId = interactionModel.clientId.value
        accept(firstClientId.isNotEmpty(), "first event stream has no clientId")
        val previousFollowCount = wire.streamCount("session/follow")
        val previousEventCount = wire.streamCount("\$events")

        val followMark = wire.mark()
        wire.interrupt("session/follow", opening.generation)
        wire.awaitStreamClose(followMark, "session/follow", opening.generation)
        val nextFollow = wire.awaitStreamOpen(followMark, "session/follow", excluding = opening.generation)
        val replacement = wire.awaitFrame(nextFollow.sequence, "session/follow", nextFollow.generation) { value ->
            WireShape.string(value, "type") == "snapshot"
        }
        val snapshot = OpeningSnapshot.parse(replacement.value, config.sessionId, nextFollow.generation)
        if (semantics.expectedAuthoritativeSnapshot) {
            validateAuthoritativeSnapshot(snapshot, completed, cancelled)
        }
        awaitSessionState("SessionModel authoritative reconnect snapshot") { state ->
            state.cursor >= cancelled.seq
                && state.items.any {
                    it.seq == completed.assistantSeq
                        && it.kind == "assistant/message"
                        && it.text == corpus.prompt.expectedResponseText
                }
                && state.items.any { it.seq == completed.seq && it.kind == "turn/end" }
                && state.items.any { it.seq == cancelled.seq && it.kind == "turn/end" }
        }

        val eventMark = wire.mark()
        wire.interrupt("\$events", approval.eventGeneration)
        wire.awaitStreamClose(eventMark, "\$events", approval.eventGeneration)
        val nextEvents = wire.awaitStreamOpen(eventMark, "\$events", excluding = approval.eventGeneration)
        val ready = wire.awaitFrame(nextEvents.sequence, "\$events", nextEvents.generation) { value ->
            WireShape.string(value, "type") == "ready"
        }
        val nextClientId = WireShape.string(ready.value, "clientId")
            ?.takeIf { it.isNotEmpty() }
            ?: throw AcceptanceFailure("reconnected \$events ready omitted clientId")
        if (semantics.expectedClientIdRefresh) {
            accept(nextClientId != firstClientId, "reconnected \$events reused clientId")
        }
        awaitClientId(nextClientId)
        accept(
            wire.streamCount("session/follow") - previousFollowCount == semantics.expectedFollowReplacementCount,
            "production reconnect opened the wrong number of follow replacements",
        )
        accept(
            wire.streamCount("\$events") - previousEventCount == semantics.expectedEventReplacementCount,
            "production reconnect opened the wrong number of event replacements",
        )
        val recovery = recover(nextFollow, nextEvents, snapshot.cursor)
        steps.pass("reconnect")
        return recovery
    }

    private suspend fun recover(
        activeFollow: StreamOpenedObservation,
        activeEvents: StreamOpenedObservation,
        openingCursor: Long,
    ): RecoveryAcceptanceResult {
        val semantics = corpus.reconnect.recovery
        accept(semantics.faultAfter == "first-assistant-chunk", "corpus recovery fault point is unsupported")
        val previousFollowCount = wire.streamCount("session/follow")
        val previousEventCount = wire.streamCount("\$events")
        val preRecoveryClientId = interactionModel.clientId.value
        accept(preRecoveryClientId.isNotEmpty(), "pre-recovery event stream has no clientId")
        wire.armNextStreamAttempts(setOf("session/follow", "\$events"))
        try {
            val promptMark = wire.mark()
            sessionModel.send(semantics.prompt)
            validatePromptCall(
                wire.awaitCall(promptMark, "session/prompt"),
                targetSessionId = corpus.prompt.targetSessionId,
                text = semantics.prompt,
                expectedAccepted = true,
            )
            val firstChunk = wire.awaitFrame(promptMark, "session/follow", activeFollow.generation) { value ->
                eventOf(value)?.let { event -> WireShape.string(event, "type") == "assistant/chunk" } == true
            }
            wire.awaitFrameConsumed(firstChunk)
            val firstChunkEvent = eventOf(firstChunk.value)
                ?: throw AcceptanceFailure("recovery assistant/chunk omitted event")
            val recoveryTurn = eventTurn(firstChunkEvent)
                ?: throw AcceptanceFailure("recovery assistant/chunk omitted turn")
            val preFaultSeq = eventSeq(firstChunkEvent)
                ?: throw AcceptanceFailure("recovery assistant/chunk omitted seq")
            accept(preFaultSeq > openingCursor, "recovery fault did not advance beyond its opening snapshot")

            val recoveryMark = wire.mark()
            wire.interruptAndAwait(
                "session/follow" to activeFollow.generation,
                "\$events" to activeEvents.generation,
            )
            wire.awaitStreamClose(recoveryMark, "session/follow", activeFollow.generation)
            wire.awaitStreamClose(recoveryMark, "\$events", activeEvents.generation)
            val recoveryFollow = wire.awaitStreamOpen(
                recoveryMark,
                "session/follow",
                excluding = activeFollow.generation,
            )
            val recoveryEvents = wire.awaitStreamOpen(
                recoveryMark,
                "\$events",
                excluding = activeEvents.generation,
            )
            wire.awaitStreamAttemptBlocked(recoveryFollow.sequence, "session/follow", recoveryFollow.generation)
            wire.awaitStreamAttemptBlocked(recoveryEvents.sequence, "\$events", recoveryEvents.generation)

            val hostRecovery = control.awaitRecovery(preFaultSeq)
            accept(
                hostRecovery.offlineSeqCount >= semantics.minimumOfflineSeqAdvance,
                "Host did not advance the Session while client streams were offline",
            )
            accept(hostRecovery.hostFinalCursor > preFaultSeq, "Host recovery cursor did not advance beyond the fault")
            wire.releaseStreamAttempts()

            val recoverySnapshot = awaitOpeningSnapshot(recoveryFollow)
            accept(
                recoverySnapshot.cursor == hostRecovery.hostFinalCursor,
                "recovery snapshot cursor did not match the Host final cursor",
            )
            accept(
                recoverySnapshot.hasMore == semantics.expectedSnapshotHasMore,
                "recovery snapshot hasMore did not match the corpus",
            )
            validateRecoveryTerminal(recoverySnapshot, recoveryTurn, preFaultSeq, semantics.expectedTerminalKind)
            val recoveryClientId = awaitEventReady(recoveryEvents)
            accept(recoveryClientId != preRecoveryClientId, "recovery \$events replacement reused its lost clientId")
            val beforeRepeatedReconnect = awaitSessionState("SessionModel recovery snapshot") { state ->
                state.cursor == recoverySnapshot.cursor
                    && state.items.any { item -> item.seq > preFaultSeq && item.kind == "turn/end" }
            }.toJson().jsonObject

            wire.armNextStreamAttempts(setOf("session/follow", "\$events"))
            val repeatedMark = wire.mark()
            wire.interruptAndAwait(
                "session/follow" to recoveryFollow.generation,
                "\$events" to recoveryEvents.generation,
            )
            wire.awaitStreamClose(repeatedMark, "session/follow", recoveryFollow.generation)
            wire.awaitStreamClose(repeatedMark, "\$events", recoveryEvents.generation)
            val repeatedFollow = wire.awaitStreamOpen(
                repeatedMark,
                "session/follow",
                excluding = recoveryFollow.generation,
            )
            val repeatedEvents = wire.awaitStreamOpen(
                repeatedMark,
                "\$events",
                excluding = recoveryEvents.generation,
            )
            wire.awaitStreamAttemptBlocked(repeatedFollow.sequence, "session/follow", repeatedFollow.generation)
            wire.awaitStreamAttemptBlocked(repeatedEvents.sequence, "\$events", repeatedEvents.generation)
            wire.releaseStreamAttempts()

            val repeatedSnapshot = awaitOpeningSnapshot(repeatedFollow)
            accept(
                repeatedSnapshot.cursor == recoverySnapshot.cursor,
                "same-cut reconnect returned a different snapshot cursor",
            )
            accept(
                repeatedSnapshot.hasMore == semantics.expectedSnapshotHasMore,
                "same-cut reconnect snapshot hasMore did not match the corpus",
            )
            accept(
                repeatedSnapshot.records == recoverySnapshot.records,
                "same-cut reconnect returned different authoritative records",
            )
            validateRecoveryTerminal(repeatedSnapshot, recoveryTurn, preFaultSeq, semantics.expectedTerminalKind)
            val repeatedClientId = awaitEventReady(repeatedEvents)
            accept(repeatedClientId != recoveryClientId, "same-cut \$events replacement reused its lost clientId")
            val afterRepeatedReconnect = awaitSessionState("SessionModel repeated recovery snapshot") { state ->
                state.cursor == repeatedSnapshot.cursor
            }.toJson().jsonObject
            accept(
                afterRepeatedReconnect == beforeRepeatedReconnect,
                "same-cut reconnect changed the companion DomainState projection",
            )

            val followReplacementCount = wire.streamCount("session/follow") - previousFollowCount
            val eventReplacementCount = wire.streamCount("\$events") - previousEventCount
            accept(
                followReplacementCount == semantics.expectedFollowReplacementCount,
                "recovery opened the wrong number of follow replacements",
            )
            accept(
                eventReplacementCount == semantics.expectedEventReplacementCount,
                "recovery opened the wrong number of event replacements",
            )
            accept(
                followReplacementCount - 1 == semantics.expectedSameCutReconnectCount
                    && eventReplacementCount - 1 == semantics.expectedSameCutReconnectCount,
                "recovery executed the wrong number of same-cut reconnects",
            )
            accept(
                semantics.expectedFinalProjectionRelation == "authoritative-snapshot-fold",
                "recovery final projection relation is unsupported",
            )
            return RecoveryAcceptanceResult(
                preFaultSeq = preFaultSeq,
                recoverySnapshotCursor = recoverySnapshot.cursor,
                repeatedSnapshotCursor = repeatedSnapshot.cursor,
                offlineSeqCount = hostRecovery.offlineSeqCount,
                recoverySnapshotHasMore = recoverySnapshot.hasMore,
                followReplacementCount = followReplacementCount,
                eventReplacementCount = eventReplacementCount,
                beforeRepeatedReconnectProjection = beforeRepeatedReconnect,
                afterRepeatedReconnectProjection = afterRepeatedReconnect,
            )
        } finally {
            wire.releaseStreamAttempts(requireAllBlocked = false)
        }
    }

    private suspend fun awaitOpeningSnapshot(stream: StreamOpenedObservation): OpeningSnapshot {
        val frame = wire.awaitFrame(stream.sequence, "session/follow", stream.generation) { value ->
            WireShape.string(value, "type") == "snapshot"
        }
        wire.awaitFrameConsumed(frame)
        return OpeningSnapshot.parse(frame.value, config.sessionId, stream.generation)
    }

    private suspend fun awaitEventReady(stream: StreamOpenedObservation): String {
        accept(stream.payload.isEmpty(), "recovery \$events replacement opened with a payload")
        val ready = wire.awaitFrame(stream.sequence, "\$events", stream.generation) { value ->
            WireShape.string(value, "type") == "ready"
        }
        val clientId = WireShape.string(ready.value, "clientId")
            ?.takeIf { it.isNotEmpty() }
            ?: throw AcceptanceFailure("recovery \$events ready omitted clientId")
        awaitClientId(clientId)
        return clientId
    }

    private fun validateRecoveryTerminal(
        snapshot: OpeningSnapshot,
        turn: Long,
        preFaultSeq: Long,
        expectedKind: String,
    ) {
        validateSnapshot(snapshot)
        val projectionSeq = WireShape.number(snapshot.projections, "asOfSeq")
            ?: throw AcceptanceFailure("recovery snapshot projections omitted asOfSeq")
        accept(
            projectionSeq == snapshot.cursor.toDouble(),
            "recovery snapshot projections did not describe its complete cut",
        )
        accept(
            snapshot.records.any { record ->
                val event = eventOf(record) ?: return@any false
                eventSeq(event)?.let { it > preFaultSeq } == true
                    && eventTurn(event) == turn
                    && turnEndKind(event) == expectedKind
            },
            "recovery snapshot omitted the completed terminal event",
        )
    }

    private suspend fun revoke() {
        control.revoke()
        val failure = try {
            client.describe()
            null
        } catch (caught: LinkClientException.Carrier) {
            caught
        }
        accept(failure?.status == 401, "revoked credentials did not receive an unauthorized describe response")
        steps.pass("revoke")
    }

    private fun validateSnapshot(opening: OpeningSnapshot) {
        accept(opening.cursor >= 0, "follow snapshot cursor is negative")
        accept(opening.records.isNotEmpty(), "follow snapshot did not carry the seeded session")
        val projectionSeq = WireShape.number(opening.projections, "asOfSeq")
            ?: throw AcceptanceFailure("follow snapshot projections omitted asOfSeq")
        accept(
            projectionSeq.toLong().toDouble() == projectionSeq
                && projectionSeq >= -1.0
                && projectionSeq <= opening.cursor.toDouble(),
            "follow snapshot projection sequence is invalid",
        )
        accept(
            WireShape.objectValue(opening.projections, "values") != null,
            "follow snapshot projections omitted values",
        )
    }

    private fun validateFollowPayload(payload: Map<String, WireValue>, sessionId: String) {
        val request = payload["request"] as? WireValue.ObjectValue
            ?: throw AcceptanceFailure("SessionModel follow omitted request")
        val address = request.entries["address"]
            ?: throw AcceptanceFailure("SessionModel follow omitted address")
        accept(WireShape.string(address, "kind") == "session", "SessionModel follow used the wrong address kind")
        accept(WireShape.string(address, "sessionId") == sessionId, "SessionModel follow used the wrong session")
    }

    private fun validatePromptCall(
        call: CallObservation,
        targetSessionId: String,
        text: String,
        expectedAccepted: Boolean,
    ) {
        accept(
            WireShape.boolean(call.result, "accepted") == expectedAccepted,
            "session/prompt admission did not match the corpus",
        )
        val request = call.args["request"] as? WireValue.ObjectValue
            ?: throw AcceptanceFailure("SessionModel prompt omitted request")
        accept(
            WireShape.string(request, "sessionId") == targetSessionId,
            "SessionModel prompted the wrong session",
        )
        accept(WireShape.string(request, "mode") == "queue", "SessionModel prompt did not use queue mode")
        val content = WireShape.array(request, "content")
            ?: throw AcceptanceFailure("SessionModel prompt omitted content")
        accept(content.size == 1, "SessionModel prompt carried unexpected content")
        accept(WireShape.string(content.single(), "type") == "text", "SessionModel prompt content was not text")
        accept(
            WireShape.string(content.single(), "text") == text,
            "SessionModel prompt carried the wrong text",
        )
    }

    private fun validateAnswerCall(call: CallObservation, clientId: String, eventId: String) {
        accept(call.result == WireValue.NullValue, "\$events/result did not return void success")
        accept(WireShape.string(WireValue.ObjectValue(call.args), "clientId") == clientId, "answer used wrong clientId")
        accept(WireShape.string(WireValue.ObjectValue(call.args), "eventId") == eventId, "answer used wrong eventId")
        val outcome = call.args["outcome"]
            ?: throw AcceptanceFailure("InteractionModel answer omitted outcome")
        accept(WireShape.string(outcome, "kind") == "result", "InteractionModel answer used the wrong outcome kind")
        accept(WireShape.string(outcome, "value") == "allowed-once", "InteractionModel answer used the wrong value")
    }

    private fun validateApprovalWaterfall(frame: WireValue) {
        accept(WireShape.string(frame, "agentId") == config.sessionId, "approval waterfall targeted the wrong session")
        val request = WireShape.objectValue(frame, "request")
            ?: throw AcceptanceFailure("approval waterfall omitted request")
        accept(
            WireShape.string(request, "toolName") == "link-native-acceptance",
            "approval waterfall carried the wrong tool name",
        )
        accept(
            WireShape.string(request, "reason") == "cross-language acceptance",
            "approval waterfall carried the wrong reason",
        )
    }

    private fun validateAuthoritativeSnapshot(
        snapshot: OpeningSnapshot,
        completed: CompletedTurn,
        cancelled: CancelledTurn,
    ) {
        validateSnapshot(snapshot)
        accept(snapshot.cursor >= cancelled.seq, "reconnected snapshot ended before the cancelled turn")
        accept(
            snapshot.records.any { record ->
                val event = eventOf(record) ?: return@any false
                eventSeq(event) == completed.assistantSeq
                    && eventTurn(event) == completed.turn
                    && assistantText(event) == corpus.prompt.expectedResponseText
            },
            "reconnected snapshot omitted the completed assistant response",
        )
        accept(
            snapshot.records.any { record ->
                val event = eventOf(record) ?: return@any false
                eventSeq(event) == completed.seq
                    && eventTurn(event) == completed.turn
                    && turnEndKind(event) == "completed"
            },
            "reconnected snapshot omitted the completed terminal event",
        )
        accept(
            snapshot.records.any { record ->
                val event = eventOf(record) ?: return@any false
                eventSeq(event) == cancelled.seq
                    && eventTurn(event) == cancelled.turn
                    && isUserAbortedTurn(event)
            },
            "reconnected snapshot omitted the cancelled terminal event",
        )
    }

    private suspend fun awaitSessionState(description: String, predicate: (DomainState) -> Boolean): DomainState {
        try {
            val opened = withTimeout(STEP_TIMEOUT_MILLIS) {
                sessionModel.open.first { candidate -> candidate != null && predicate(candidate.state) }
            }
            return opened?.state ?: throw AcceptanceFailure("$description closed unexpectedly")
        } catch (_: TimeoutCancellationException) {
            throw AcceptanceFailure("timed out waiting for $description")
        }
    }

    private suspend fun awaitClientId(expected: String) {
        try {
            withTimeout(STEP_TIMEOUT_MILLIS) { interactionModel.clientId.first { it == expected } }
        } catch (_: TimeoutCancellationException) {
            throw AcceptanceFailure("timed out waiting for InteractionModel clientId")
        }
    }

    private suspend fun awaitPendingInteraction(eventId: String): PendingInteraction {
        try {
            val inbox = withTimeout(STEP_TIMEOUT_MILLIS) {
                interactionModel.inbox.first { entries -> entries.any { it.id == eventId } }
            }
            return inbox.single { it.id == eventId }
        } catch (_: TimeoutCancellationException) {
            throw AcceptanceFailure("timed out waiting for InteractionModel approval")
        }
    }

    private suspend fun expectRefused(expectedCode: String, operation: suspend () -> WireValue) {
        try {
            operation()
        } catch (error: LinkClientException.Refused) {
            accept(error.code == expectedCode, "Link refusal did not match the corpus error code")
            return
        }
        throw AcceptanceFailure("Link operation did not return the corpus refusal")
    }

    private suspend fun collectCleanupFailures(): List<Throwable> {
        val failures = mutableListOf<Throwable>()

        suspend fun attempt(block: suspend () -> Unit) {
            try {
                block()
            } catch (error: Throwable) {
                failures += error
            }
        }

        attempt { sessionModel.closeAndAwait() }
        attempt { interactionModel.stopWatchingAndAwait() }
        attempt { scopeJob.cancelAndJoin() }
        attempt { switchable.closeAndAwait() }
        attempt { client.closeAndAwait() }
        attempt { unpairedClient.closeAndAwait() }
        return failures
    }

    private companion object {
        const val MAX_MESSAGES = 50
        const val STEP_TIMEOUT_MILLIS = 30_000L
    }
}

/** Test-only observation and retry gating around one production wire; values are forwarded unchanged. */
private class ObservingWireDriving(private val delegate: WireDriving) : WireDriving {
    private val lock = Any()
    private val observations = mutableListOf<WireObservation>()
    private val activeStreams = mutableMapOf<Long, ActiveObservedStream>()
    private val revision = MutableStateFlow(0L)
    private var sequence = 0L
    private var generation = 0L
    private var streamAttemptGate: StreamAttemptGate? = null

    fun mark(): Long = synchronized(lock) { sequence }

    fun streamCount(endpoint: String): Int = synchronized(lock) {
        observations.count { observation ->
            observation is StreamOpenedObservation && observation.endpoint == endpoint
        }
    }

    fun armNextStreamAttempts(endpoints: Set<String>) = synchronized(lock) {
        accept(endpoints.isNotEmpty(), "stream-attempt gate requires at least one endpoint")
        accept(streamAttemptGate == null, "a stream-attempt gate is already armed")
        streamAttemptGate = StreamAttemptGate(endpoints, CompletableDeferred())
    }

    fun releaseStreamAttempts(requireAllBlocked: Boolean = true) {
        val gate = synchronized(lock) {
            val current = streamAttemptGate
            if (requireAllBlocked && current != null) {
                accept(current.blocked == current.endpoints, "stream-attempt gate released before every endpoint arrived")
            }
            streamAttemptGate = null
            current
        }
        gate?.release?.complete(Unit)
    }

    override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
        val result = delegate.call(method, args)
        record { next -> CallObservation(next, method, args, result) }
        return result
    }

    override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> {
        val observed = channelFlow<ForwardedStreamFrame> {
            val streamGeneration = synchronized(lock) {
                generation += 1
                generation
            }
            val pump = launch(start = CoroutineStart.LAZY) {
                try {
                    awaitStreamAttempt(endpoint, streamGeneration)
                    delegate.stream(endpoint, payload).collect { value ->
                        record { next -> StreamFrameObservation(next, endpoint, streamGeneration, value) }
                        send(ForwardedStreamFrame(streamGeneration, value))
                    }
                } catch (failure: CancellationException) {
                    throw failure
                } catch (failure: Exception) {
                    this@channelFlow.close(failure)
                } finally {
                    record { next -> StreamClosedObservation(next, endpoint, streamGeneration) }
                }
            }
            synchronized(lock) {
                activeStreams[streamGeneration] = ActiveObservedStream(endpoint, pump)
            }
            pump.invokeOnCompletion {
                synchronized(lock) {
                    if (activeStreams[streamGeneration]?.job === pump) activeStreams.remove(streamGeneration)
                }
            }
            record { next -> StreamOpenedObservation(next, endpoint, payload, streamGeneration) }
            pump.start()
            pump.join()
        }
        return observed.transform { frame ->
            emit(frame.value)
            record { next -> StreamFrameConsumedObservation(next, endpoint, frame.generation, frame.value) }
        }
    }

    /** End one base-stream pump without cancelling its model collector; the
     * production model must observe completion and open the replacement. */
    suspend fun interrupt(endpoint: String, generation: Long) {
        val stream = synchronized(lock) { activeStreams[generation] }
            ?: throw AcceptanceFailure("$endpoint generation $generation is not active")
        accept(stream.endpoint == endpoint, "stream interrupt targeted the wrong endpoint")
        accept(stream.job.isActive, "stream interrupt targeted a completed generation")
        stream.job.cancelAndJoin()
    }

    suspend fun interruptAndAwait(vararg targets: Pair<String, Long>) {
        accept(targets.isNotEmpty(), "stream interruption requires at least one target")
        accept(targets.map { it.first }.toSet().size == targets.size, "stream interruption endpoints must be distinct")
        val streams = synchronized(lock) {
            targets.map { (endpoint, generation) ->
                val stream = activeStreams[generation]
                    ?: throw AcceptanceFailure("$endpoint generation $generation is not active")
                accept(stream.endpoint == endpoint, "stream interrupt targeted the wrong endpoint")
                accept(stream.job.isActive, "stream interrupt targeted a completed generation")
                stream
            }
        }
        streams.forEach { it.job.cancel() }
        streams.forEach { it.job.join() }
    }

    suspend fun awaitCall(after: Long, method: String): CallObservation =
        await(after, "$method call") { observation ->
            (observation as? CallObservation)
                ?.takeIf { it.method == method }
        }

    suspend fun awaitStreamOpen(
        after: Long,
        endpoint: String,
        excluding: Long? = null,
    ): StreamOpenedObservation = await(after, "$endpoint stream open") { observation ->
        (observation as? StreamOpenedObservation)
            ?.takeIf { it.endpoint == endpoint && it.generation != excluding }
    }

    suspend fun awaitStreamClose(
        after: Long,
        endpoint: String,
        generation: Long,
    ): StreamClosedObservation = await(after, "$endpoint stream close") { observation ->
        (observation as? StreamClosedObservation)
            ?.takeIf { it.endpoint == endpoint && it.generation == generation }
    }

    suspend fun awaitStreamAttemptBlocked(
        after: Long,
        endpoint: String,
        generation: Long,
    ): StreamAttemptBlockedObservation = await(after, "$endpoint blocked stream attempt") { observation ->
        (observation as? StreamAttemptBlockedObservation)
            ?.takeIf { it.endpoint == endpoint && it.generation == generation }
    }

    suspend fun awaitFrame(
        after: Long,
        endpoint: String,
        generation: Long,
        predicate: (WireValue) -> Boolean,
    ): StreamFrameObservation = await(after, "$endpoint frame") { observation ->
        (observation as? StreamFrameObservation)
            ?.takeIf { it.endpoint == endpoint && it.generation == generation && predicate(it.value) }
    }

    suspend fun awaitFrameConsumed(frame: StreamFrameObservation): StreamFrameConsumedObservation =
        await(frame.sequence, "${frame.endpoint} consumed frame") { observation ->
            (observation as? StreamFrameConsumedObservation)?.takeIf {
                it.endpoint == frame.endpoint && it.generation == frame.generation && it.value == frame.value
            }
        }

    private fun <T : WireObservation> record(create: (Long) -> T): T = synchronized(lock) {
        sequence += 1
        val observation = create(sequence)
        observations += observation
        revision.value = sequence
        observation
    }

    private suspend fun awaitStreamAttempt(endpoint: String, generation: Long) {
        val gate = synchronized(lock) {
            streamAttemptGate?.takeIf { endpoint in it.endpoints }?.also {
                accept(it.blocked.add(endpoint), "more than one replacement reached the same stream-attempt gate")
            }
        } ?: return
        record { next -> StreamAttemptBlockedObservation(next, endpoint, generation) }
        gate.release.await()
    }

    private suspend fun <T : WireObservation> await(
        after: Long,
        description: String,
        select: (WireObservation) -> T?,
    ): T {
        try {
            return withTimeout(OBSERVATION_TIMEOUT_MILLIS) { find(after, select) }
        } catch (_: TimeoutCancellationException) {
            throw AcceptanceFailure("timed out waiting for $description")
        }
    }

    private suspend fun <T : WireObservation> find(
        after: Long,
        select: (WireObservation) -> T?,
    ): T {
        var seen = revision.value
        while (true) {
            val match = synchronized(lock) {
                observations.asSequence()
                    .filter { it.sequence > after }
                    .mapNotNull { observation -> select(observation) }
                    .firstOrNull()
            }
            if (match != null) return match
            seen = revision.first { it > seen }
        }
    }

    private companion object {
        const val OBSERVATION_TIMEOUT_MILLIS = 30_000L
    }
}

private data class StreamAttemptGate(
    val endpoints: Set<String>,
    val release: CompletableDeferred<Unit>,
    val blocked: MutableSet<String> = mutableSetOf(),
)

private data class ActiveObservedStream(val endpoint: String, val job: Job)

private data class ForwardedStreamFrame(val generation: Long, val value: WireValue)

private sealed interface WireObservation {
    val sequence: Long
}

private data class CallObservation(
    override val sequence: Long,
    val method: String,
    val args: Map<String, WireValue>,
    val result: WireValue,
) : WireObservation

private data class StreamOpenedObservation(
    override val sequence: Long,
    val endpoint: String,
    val payload: Map<String, WireValue>,
    val generation: Long,
) : WireObservation

private data class StreamFrameObservation(
    override val sequence: Long,
    val endpoint: String,
    val generation: Long,
    val value: WireValue,
) : WireObservation

private data class StreamFrameConsumedObservation(
    override val sequence: Long,
    val endpoint: String,
    val generation: Long,
    val value: WireValue,
) : WireObservation

private data class StreamClosedObservation(
    override val sequence: Long,
    val endpoint: String,
    val generation: Long,
) : WireObservation

private data class StreamAttemptBlockedObservation(
    override val sequence: Long,
    val endpoint: String,
    val generation: Long,
) : WireObservation

private data class OpeningSnapshot(
    val cursor: Long,
    val records: List<WireValue>,
    val hasMore: Boolean,
    val projections: WireValue,
    val generation: Long,
) {
    companion object {
        fun parse(frame: WireValue, sessionId: String, generation: Long): OpeningSnapshot {
            accept(WireShape.string(frame, "type") == "snapshot", "follow generation did not open with snapshot")
            val header = WireShape.objectValue(frame, "header")
                ?: throw AcceptanceFailure("follow snapshot omitted header")
            accept(WireShape.number(header, "version") == 0.0, "follow snapshot Session format is not 0")
            accept(WireShape.string(header, "id") == sessionId, "follow snapshot targeted the wrong session")
            val cursorValue = WireShape.number(frame, "cursor")
                ?: throw AcceptanceFailure("follow snapshot omitted cursor")
            val cursor = cursorValue.toLong()
            accept(cursor.toDouble() == cursorValue, "follow snapshot cursor is not integral")
            return OpeningSnapshot(
                cursor = cursor,
                records = WireShape.array(frame, "records")
                    ?: throw AcceptanceFailure("follow snapshot omitted records"),
                hasMore = WireShape.boolean(frame, "hasMore")
                    ?: throw AcceptanceFailure("follow snapshot omitted hasMore"),
                projections = WireShape.objectValue(frame, "projections")
                    ?: throw AcceptanceFailure("follow snapshot omitted projections"),
                generation = generation,
            )
        }
    }
}

private data class CompletedTurn(val turn: Long, val assistantSeq: Long, val seq: Long)

private data class CancelledTurn(val turn: Long, val seq: Long)

private data class ApprovalState(val turn: Long, val eventGeneration: Long)

private data class AcceptanceConfig(
    val dshHome: Path,
    val corpusPath: Path,
    val candidateResultPath: Path,
    val pairing: LinkPairingPayload,
    val sessionId: String,
    val controlEndpoint: URI,
    val controlToken: String,
    val hostCommit: String,
    val clientCommit: String,
    val expectedResponseText: String,
    val deviceName: String,
) {
    companion object {
        fun read(path: Path): AcceptanceConfig {
            val document = parseObject(Files.readAllBytes(path), "acceptance config")
            document.requireExactKeys(
                setOf(
                    "schemaVersion",
                    "language",
                    "corpusPath",
                    "candidateResultPath",
                    "pairing",
                    "sessionId",
                    "controlEndpoint",
                    "controlToken",
                    "hostCommit",
                    "clientCommit",
                    "expectedResponseText",
                    "deviceName",
                ),
                "acceptance config",
            )
            accept(document.requiredInt("schemaVersion") == 1, "acceptance config schemaVersion is not 1")
            accept(document.requiredString("language") == "kotlin", "acceptance config language is not kotlin")
            val pairingElement = document["pairing"] as? JsonObject
                ?: throw AcceptanceFailure("acceptance config pairing must be an object")
            val pairing = LinkPayloadParsing.pairingPayload(pairingElement.toString())
                ?: throw AcceptanceFailure("acceptance config pairing is invalid")
            validatePairing(pairing)
            val controlEndpoint = URI.create(document.requiredString("controlEndpoint"))
            accept(controlEndpoint.scheme in setOf("http", "https"), "controlEndpoint must use HTTP")
            accept(controlEndpoint.userInfo == null, "controlEndpoint must not contain user info")
            accept(controlEndpoint.host != null, "controlEndpoint must name a host")
            accept(
                controlEndpoint.query == null && controlEndpoint.fragment == null,
                "controlEndpoint must be a base URI",
            )
            val dshHome = System.getenv("DSH_HOME")
                ?.takeIf { it.isNotBlank() }
                ?.let { Path.of(it).toAbsolutePath().normalize() }
                ?: throw AcceptanceFailure("DSH_HOME must name the isolated acceptance home")
            val candidateResultPath = Path.of(document.requiredString("candidateResultPath"))
                .toAbsolutePath()
                .normalize()
            validateCandidateResultPath(dshHome, candidateResultPath)
            return AcceptanceConfig(
                dshHome = dshHome,
                corpusPath = Path.of(document.requiredString("corpusPath")).toAbsolutePath().normalize(),
                candidateResultPath = candidateResultPath,
                pairing = pairing,
                sessionId = document.requiredString("sessionId"),
                controlEndpoint = controlEndpoint,
                controlToken = document.requiredString("controlToken"),
                hostCommit = document.requiredString("hostCommit"),
                clientCommit = document.requiredString("clientCommit"),
                expectedResponseText = document.requiredString("expectedResponseText"),
                deviceName = document.requiredString("deviceName"),
            )
        }

        private fun validatePairing(pairing: LinkPairingPayload) {
            accept(pairing.v == 1.0, "pairing payload protocol version is not 1")
            accept(pairing.kind == "dsh-link-pairing", "pairing payload kind is invalid")
            accept(pairing.expiresAt > System.currentTimeMillis(), "pairing payload is expired")
            val endpoint = URI.create(pairing.endpoint)
            accept(endpoint.scheme == "https", "pairing endpoint is not HTTPS")
            accept(endpoint.userInfo == null, "pairing endpoint must not contain user info")
            accept(endpoint.host != null, "pairing endpoint must name a host")
            accept(endpoint.query == null && endpoint.fragment == null, "pairing endpoint must be a base URI")
            accept(Regex("[0-9a-f]{64}").matches(pairing.spkiFingerprint), "pairing fingerprint is invalid")
        }
    }
}

private data class ListAcceptanceSemantics(
    val targetSessionId: String,
    val decoySessionId: String,
    val expectedSessionIds: List<String>,
)

private data class HistoryAcceptanceSemantics(
    val targetSessionId: String,
    val decoySessionId: String,
    val expectedTargetRelation: String,
    val decoyErrorCode: String,
)

private data class PromptAcceptanceSemantics(
    val targetSessionId: String,
    val decoySessionId: String,
    val text: String,
    val expectedAccepted: Boolean,
    val expectedResponseText: String,
    val decoyErrorCode: String,
)

private data class ReconnectAcceptanceSemantics(
    val fault: String,
    val expectedFollowReplacementCount: Int,
    val expectedEventReplacementCount: Int,
    val expectedAuthoritativeSnapshot: Boolean,
    val expectedClientIdRefresh: Boolean,
    val recovery: RecoveryAcceptanceSemantics,
)

private data class RecoveryAcceptanceSemantics(
    val prompt: String,
    val faultAfter: String,
    val expectedTerminalKind: String,
    val minimumOfflineSeqAdvance: Int,
    val expectedFollowReplacementCount: Int,
    val expectedEventReplacementCount: Int,
    val expectedSameCutReconnectCount: Int,
    val expectedSnapshotHasMore: Boolean,
    val expectedFinalProjectionRelation: String,
)

private data class AcceptanceCorpus(
    val bytes: ByteArray,
    val contractVersion: Int,
    val stepIds: List<String>,
    val list: ListAcceptanceSemantics,
    val history: HistoryAcceptanceSemantics,
    val prompt: PromptAcceptanceSemantics,
    val stallPrompt: String,
    val approvalOutcome: String,
    val reconnect: ReconnectAcceptanceSemantics,
) {
    fun validateConfig(config: AcceptanceConfig) {
        accept(config.sessionId == list.targetSessionId, "config sessionId does not match the corpus target")
        accept(
            config.expectedResponseText == prompt.expectedResponseText,
            "config expectedResponseText does not match the corpus",
        )
    }

    companion object {
        private val EXPECTED_IDS = listOf(
            "pair",
            "connect",
            "describe",
            "list",
            "open",
            "history",
            "follow",
            "prompt",
            "stream",
            "approval",
            "cancel",
            "reconnect",
            "revoke",
        )

        fun parse(bytes: ByteArray): AcceptanceCorpus {
            val document = parseObject(bytes, "acceptance corpus")
            document.requireExactKeys(setOf("schemaVersion", "contractVersion", "steps"), "acceptance corpus")
            accept(document.requiredInt("schemaVersion") == 1, "corpus schemaVersion is not 1")
            val contractVersion = document.requiredInt("contractVersion")
            accept(contractVersion == 1, "corpus contractVersion is not 1")
            val stepObjects = (document["steps"] as? JsonArray)?.map { element ->
                element as? JsonObject ?: throw AcceptanceFailure("corpus step must be an object")
            } ?: throw AcceptanceFailure("corpus steps must be an array")
            val ids = stepObjects.map { it.requiredString("id") }
            accept(ids == EXPECTED_IDS, "corpus step ids or order differ from the required 13 steps")
            accept(ids.toSet().size == ids.size, "corpus contains duplicate step ids")
            stepObjects.forEach { step ->
                val id = step.requiredString("id")
                val expectedKeys = when (id) {
                    "list" -> setOf("id", "targetSessionId", "decoySessionId", "expectedSessionIds")
                    "history" -> setOf(
                        "id",
                        "targetSessionId",
                        "decoySessionId",
                        "expectedTargetRelation",
                        "decoyErrorCode",
                    )
                    "prompt" -> setOf(
                        "id",
                        "targetSessionId",
                        "decoySessionId",
                        "text",
                        "expectedAccepted",
                        "expectedResponseText",
                        "decoyErrorCode",
                    )
                    "approval" -> setOf("id", "stallPrompt", "outcome")
                    "reconnect" -> setOf(
                        "id",
                        "fault",
                        "expectedFollowReplacementCount",
                        "expectedEventReplacementCount",
                        "expectedAuthoritativeSnapshot",
                        "expectedClientIdRefresh",
                        "recovery",
                    )
                    else -> setOf("id")
                }
                step.requireExactKeys(expectedKeys, "corpus $id step")
            }
            val listStep = stepObjects.single { it.requiredString("id") == "list" }
            val list = ListAcceptanceSemantics(
                targetSessionId = listStep.requiredString("targetSessionId"),
                decoySessionId = listStep.requiredString("decoySessionId"),
                expectedSessionIds = listStep.requiredStringArray("expectedSessionIds"),
            )
            accept(list.targetSessionId != list.decoySessionId, "corpus target and decoy sessions must differ")
            accept(
                list.expectedSessionIds == listOf(list.targetSessionId),
                "corpus list output must expose only the target session",
            )
            val historyStep = stepObjects.single { it.requiredString("id") == "history" }
            val history = HistoryAcceptanceSemantics(
                targetSessionId = historyStep.requiredString("targetSessionId"),
                decoySessionId = historyStep.requiredString("decoySessionId"),
                expectedTargetRelation = historyStep.requiredString("expectedTargetRelation"),
                decoyErrorCode = historyStep.requiredString("decoyErrorCode"),
            )
            accept(
                history.expectedTargetRelation == "matches-follow-opening",
                "corpus history target relation is unsupported",
            )
            val promptStep = stepObjects.single { it.requiredString("id") == "prompt" }
            val prompt = PromptAcceptanceSemantics(
                targetSessionId = promptStep.requiredString("targetSessionId"),
                decoySessionId = promptStep.requiredString("decoySessionId"),
                text = promptStep.requiredString("text"),
                expectedAccepted = promptStep.boolean("expectedAccepted")
                    ?: throw AcceptanceFailure("prompt expectedAccepted must be Boolean"),
                expectedResponseText = promptStep.requiredString("expectedResponseText"),
                decoyErrorCode = promptStep.requiredString("decoyErrorCode"),
            )
            accept(prompt.expectedAccepted, "corpus target prompt must be accepted")
            accept(
                history.targetSessionId == list.targetSessionId
                    && history.decoySessionId == list.decoySessionId
                    && prompt.targetSessionId == list.targetSessionId
                    && prompt.decoySessionId == list.decoySessionId,
                "corpus list, history, and prompt sessions differ",
            )
            val approval = stepObjects.single { it.requiredString("id") == "approval" }
            val reconnectStep = stepObjects.single { it.requiredString("id") == "reconnect" }
            val recoveryObject = reconnectStep["recovery"] as? JsonObject
                ?: throw AcceptanceFailure("reconnect recovery must be an object")
            recoveryObject.requireExactKeys(
                setOf(
                    "prompt",
                    "faultAfter",
                    "expectedTerminalKind",
                    "minimumOfflineSeqAdvance",
                    "expectedFollowReplacementCount",
                    "expectedEventReplacementCount",
                    "expectedSameCutReconnectCount",
                    "expectedSnapshotHasMore",
                    "expectedFinalProjectionRelation",
                ),
                "corpus reconnect recovery",
            )
            val recovery = RecoveryAcceptanceSemantics(
                prompt = recoveryObject.requiredString("prompt"),
                faultAfter = recoveryObject.requiredString("faultAfter"),
                expectedTerminalKind = recoveryObject.requiredString("expectedTerminalKind"),
                minimumOfflineSeqAdvance = recoveryObject.requiredInt("minimumOfflineSeqAdvance"),
                expectedFollowReplacementCount = recoveryObject.requiredInt("expectedFollowReplacementCount"),
                expectedEventReplacementCount = recoveryObject.requiredInt("expectedEventReplacementCount"),
                expectedSameCutReconnectCount = recoveryObject.requiredInt("expectedSameCutReconnectCount"),
                expectedSnapshotHasMore = recoveryObject.boolean("expectedSnapshotHasMore")
                    ?: throw AcceptanceFailure("recovery expectedSnapshotHasMore must be Boolean"),
                expectedFinalProjectionRelation = recoveryObject.requiredString("expectedFinalProjectionRelation"),
            )
            accept(
                recovery == RecoveryAcceptanceSemantics(
                    prompt = "Complete the Link acceptance turn while both client streams are offline.",
                    faultAfter = "first-assistant-chunk",
                    expectedTerminalKind = "completed",
                    minimumOfflineSeqAdvance = 1,
                    expectedFollowReplacementCount = 2,
                    expectedEventReplacementCount = 2,
                    expectedSameCutReconnectCount = 1,
                    expectedSnapshotHasMore = false,
                    expectedFinalProjectionRelation = "authoritative-snapshot-fold",
                ),
                "corpus recovery semantics are unsupported",
            )
            val reconnect = ReconnectAcceptanceSemantics(
                fault = reconnectStep.requiredString("fault"),
                expectedFollowReplacementCount = reconnectStep.requiredInt("expectedFollowReplacementCount"),
                expectedEventReplacementCount = reconnectStep.requiredInt("expectedEventReplacementCount"),
                expectedAuthoritativeSnapshot = reconnectStep.boolean("expectedAuthoritativeSnapshot")
                    ?: throw AcceptanceFailure("reconnect expectedAuthoritativeSnapshot must be Boolean"),
                expectedClientIdRefresh = reconnectStep.boolean("expectedClientIdRefresh")
                    ?: throw AcceptanceFailure("reconnect expectedClientIdRefresh must be Boolean"),
                recovery = recovery,
            )
            accept(
                reconnect == ReconnectAcceptanceSemantics(
                    fault = "interrupt-active-streams",
                    expectedFollowReplacementCount = 1,
                    expectedEventReplacementCount = 1,
                    expectedAuthoritativeSnapshot = true,
                    expectedClientIdRefresh = true,
                    recovery = recovery,
                ),
                "corpus reconnect semantics are unsupported",
            )
            return AcceptanceCorpus(
                bytes = bytes,
                contractVersion = contractVersion,
                stepIds = ids,
                list = list,
                history = history,
                prompt = prompt,
                stallPrompt = approval.requiredString("stallPrompt"),
                approvalOutcome = approval.requiredString("outcome"),
                reconnect = reconnect,
            )
        }
    }
}

private data class AcceptanceResult(
    val corpusSha256: String,
    val hostCommit: String,
    val clientCommit: String,
    val linkProtocolVersion: Int,
    val contractVersion: Int,
    val sessionFormatVersion: Int,
    val steps: List<StepResult>,
    val recovery: RecoveryAcceptanceResult,
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("schemaVersion", 1)
        put("language", "kotlin")
        put("corpusSha256", corpusSha256)
        put("hostCommit", hostCommit)
        put("clientCommit", clientCommit)
        put("linkProtocolVersion", linkProtocolVersion)
        put("contractVersion", contractVersion)
        put("sessionFormatVersion", sessionFormatVersion)
        put(
            "steps",
            JsonArray(
                steps.map { step ->
                    buildJsonObject {
                        put("id", step.id)
                        put("status", step.status)
                    }
                },
            ),
        )
        put("recovery", recovery.toJson())
    }
}

private data class RecoveryAcceptanceResult(
    val preFaultSeq: Long,
    val recoverySnapshotCursor: Long,
    val repeatedSnapshotCursor: Long,
    val offlineSeqCount: Long,
    val recoverySnapshotHasMore: Boolean,
    val followReplacementCount: Int,
    val eventReplacementCount: Int,
    val beforeRepeatedReconnectProjection: JsonObject,
    val afterRepeatedReconnectProjection: JsonObject,
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("preFaultSeq", preFaultSeq)
        put("recoverySnapshotCursor", recoverySnapshotCursor)
        put("repeatedSnapshotCursor", repeatedSnapshotCursor)
        put("offlineSeqCount", offlineSeqCount)
        put("recoverySnapshotHasMore", recoverySnapshotHasMore)
        put("followReplacementCount", followReplacementCount)
        put("eventReplacementCount", eventReplacementCount)
        put("beforeRepeatedReconnectProjection", beforeRepeatedReconnectProjection)
        put("afterRepeatedReconnectProjection", afterRepeatedReconnectProjection)
    }
}

private data class StepResult(val id: String, val status: String = "PASS")

private class StepRecorder(private val expected: List<String>) {
    private val passed = mutableListOf<StepResult>()

    fun pass(id: String) {
        val next = expected.getOrNull(passed.size)
        accept(next == id, "step $id ran out of corpus order")
        passed += StepResult(id)
    }

    fun requireComplete() {
        accept(passed.map { it.id } == expected, "acceptance did not pass every corpus step")
        accept(passed.all { it.status == "PASS" }, "acceptance recorded a non-PASS step")
    }

    fun result(): List<StepResult> = passed.toList()
}

private class AcceptanceControl(endpoint: URI, private val token: String) {
    private val base = endpoint.toString().trimEnd('/')
    private val client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    fun startApproval() {
        val response = request("POST", "/approval/start")
        accept(response.statusCode() == 200, "approval/start did not return HTTP 200")
        val body = response.json()
        accept(body.keys == setOf("started"), "approval/start returned unexpected fields")
        accept(body.boolean("started") == true, "approval/start did not report started")
    }

    suspend fun awaitApproval(expectedOutcome: String) {
        withTimeout(CONTROL_TIMEOUT_MILLIS) {
            while (true) {
                val response = request("GET", "/approval/result")
                val body = response.json()
                when (response.statusCode()) {
                    202 -> {
                        accept(body.keys == setOf("pending"), "approval/result pending returned unexpected fields")
                        accept(body.boolean("pending") == true, "approval/result 202 was not pending")
                    }
                    200 -> {
                        accept(body.keys == setOf("outcome"), "approval/result returned unexpected fields")
                        accept(body.string("outcome") == expectedOutcome, "approval/result returned the wrong outcome")
                        return@withTimeout
                    }
                    else -> throw AcceptanceFailure("approval/result returned HTTP ${response.statusCode()}")
                }
                delay(100)
            }
        }
    }

    suspend fun awaitRecovery(preFaultSeq: Long): HostRecoveryStatus {
        accept(preFaultSeq in 0..MAX_SAFE_INTEGER, "recovery preFaultSeq is not a safe integer")
        return withTimeout(CONTROL_TIMEOUT_MILLIS) {
            while (true) {
                val response = request("GET", "/recovery/status?preFaultSeq=$preFaultSeq")
                val body = response.json()
                when (response.statusCode()) {
                    202 -> {
                        accept(body.keys == setOf("pending"), "recovery/status pending returned unexpected fields")
                        accept(body.boolean("pending") == true, "recovery/status 202 was not pending")
                    }
                    200 -> {
                        accept(
                            body.keys == setOf("hostFinalCursor", "offlineSeqCount"),
                            "recovery/status returned unexpected fields",
                        )
                        return@withTimeout HostRecoveryStatus(
                            hostFinalCursor = body.requiredLong("hostFinalCursor"),
                            offlineSeqCount = body.requiredLong("offlineSeqCount"),
                        )
                    }
                    else -> throw AcceptanceFailure("recovery/status returned HTTP ${response.statusCode()}")
                }
                delay(100)
            }
            @Suppress("UNREACHABLE_CODE")
            throw AcceptanceFailure("recovery/status polling ended unexpectedly")
        }
    }

    fun revoke() {
        val response = request("POST", "/revoke")
        accept(response.statusCode() == 200, "revoke did not return HTTP 200")
        val body = response.json()
        accept(body.keys == setOf("revoked"), "revoke returned unexpected fields")
        accept(body.boolean("revoked") == true, "revoke did not report revoked")
    }

    private fun request(method: String, path: String): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI.create(base + path))
            .timeout(Duration.ofSeconds(10))
            .header("authorization", "Bearer $token")
            .header("accept", "application/json")
        val request = when (method) {
            "GET" -> builder.GET().build()
            "POST" -> builder.POST(HttpRequest.BodyPublishers.noBody()).build()
            else -> throw AcceptanceFailure("unsupported control method")
        }
        return client.send(request, HttpResponse.BodyHandlers.ofString(Charsets.UTF_8))
    }

    private fun HttpResponse<String>.json(): JsonObject =
        runCatching { Json.parseToJsonElement(body()).jsonObject }
            .getOrElse { throw AcceptanceFailure("control response was not a JSON object") }

    private companion object {
        const val CONTROL_TIMEOUT_MILLIS = 30_000L
        const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    }
}

private data class HostRecoveryStatus(val hostFinalCursor: Long, val offlineSeqCount: Long)

private class AcceptanceFailure(message: String) : RuntimeException(message)

private fun sessionAddress(sessionId: String): WireValue.ObjectValue = WireValue.ObjectValue(
    mapOf(
        "kind" to WireValue.StringValue("session"),
        "sessionId" to WireValue.StringValue(sessionId),
    ),
)

private fun sessionIds(value: WireValue): List<String> =
    (WireShape.array(value, "items") ?: throw AcceptanceFailure("session/list omitted items"))
        .map { item -> WireShape.string(item, "sessionId") ?: throw AcceptanceFailure("session/list item omitted id") }

private fun eventOf(frame: WireValue): WireValue? =
    if (WireShape.string(frame, "type") == "event") WireShape.objectValue(frame, "event") else null

private fun eventSeq(event: WireValue): Long? {
    val value = WireShape.number(event, "seq") ?: return null
    val result = value.toLong()
    return result.takeIf { it.toDouble() == value }
}

private fun eventTurn(event: WireValue): Long? {
    val data = WireShape.objectValue(event, "data") ?: return null
    val value = WireShape.number(data, "turn") ?: return null
    val result = value.toLong()
    return result.takeIf { it.toDouble() == value }
}

private fun assistantText(event: WireValue): String? {
    if (WireShape.string(event, "type") != "assistant/message") return null
    val data = WireShape.objectValue(event, "data") ?: return null
    val message = WireShape.objectValue(data, "message") ?: return null
    val content = WireShape.array(message, "content") ?: return null
    return content.mapNotNull { block ->
        if (WireShape.string(block, "type") == "text") WireShape.string(block, "text") else null
    }.joinToString("")
}

private fun turnEndKind(event: WireValue): String? {
    if (WireShape.string(event, "type") != "turn/end") return null
    val data = WireShape.objectValue(event, "data") ?: return null
    val reason = WireShape.objectValue(data, "reason") ?: return null
    return WireShape.string(reason, "kind")
}

private fun isUserAbortedTurn(event: WireValue): Boolean {
    if (turnEndKind(event) != "aborted") return false
    val data = WireShape.objectValue(event, "data") ?: return false
    val reason = WireShape.objectValue(data, "reason") ?: return false
    val nested = WireShape.objectValue(reason, "reason") ?: return false
    return WireShape.string(nested, "kind") == "user"
}

private fun JsonObject.requiredString(field: String): String =
    (this[field] as? JsonPrimitive)
        ?.takeIf { it.isString }
        ?.content
        ?.takeIf { it.isNotEmpty() }
        ?: throw AcceptanceFailure("$field must be a non-empty string")

private fun JsonObject.requiredInt(field: String): Int =
    (this[field] as? JsonPrimitive)
        ?.takeUnless { it.isString }
        ?.intOrNull
        ?: throw AcceptanceFailure("$field must be an integer")

private fun JsonObject.requiredLong(field: String): Long =
    (this[field] as? JsonPrimitive)
        ?.takeUnless { it.isString }
        ?.longOrNull
        ?: throw AcceptanceFailure("$field must be an integer")

private fun JsonObject.requiredStringArray(field: String): List<String> =
    (this[field] as? JsonArray)
        ?.mapIndexed { index, element ->
            (element as? JsonPrimitive)
                ?.takeIf { it.isString }
                ?.content
                ?.takeIf { it.isNotEmpty() }
                ?: throw AcceptanceFailure("$field[$index] must be a non-empty string")
        }
        ?: throw AcceptanceFailure("$field must be an array")

private fun JsonObject.requireExactKeys(expected: Set<String>, subject: String) {
    accept(keys == expected, "$subject fields do not match the acceptance schema")
}

private fun JsonObject.string(field: String): String? =
    (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.boolean(field: String): Boolean? =
    (this[field] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull

private fun parseObject(bytes: ByteArray, subject: String): JsonObject =
    runCatching { Json.parseToJsonElement(bytes.decodeToString()).jsonObject }
        .getOrElse { throw AcceptanceFailure("$subject is not a JSON object") }

private fun accept(condition: Boolean, message: String) {
    if (!condition) throw AcceptanceFailure(message)
}

private fun validateCandidateResultPath(dshHome: Path, path: Path) {
    val home = dshHome.toAbsolutePath().normalize()
    val absolute = path.toAbsolutePath().normalize()
    accept(
        absolute != home && absolute.startsWith(home),
        "candidateResultPath must stay inside DSH_HOME",
    )
    accept(
        Files.isDirectory(home, LinkOption.NOFOLLOW_LINKS),
        "DSH_HOME must be an existing unlinked directory",
    )
    val parent = absolute.parent ?: throw AcceptanceFailure("candidateResultPath has no parent")
    var current = home
    for (component in home.relativize(parent)) {
        current = current.resolve(component)
        if (!Files.exists(current, LinkOption.NOFOLLOW_LINKS)) break
        accept(
            Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS),
            "candidateResultPath parent contains a link or non-directory",
        )
    }
    accept(
        !Files.exists(absolute, LinkOption.NOFOLLOW_LINKS),
        "candidateResultPath already exists",
    )
}

private fun writeAtomically(dshHome: Path, path: Path, document: JsonElement) {
    val absolute = path.toAbsolutePath().normalize()
    val parent = absolute.parent ?: throw AcceptanceFailure("candidateResultPath has no parent")
    Files.createDirectories(parent)
    validateCandidateResultPath(dshHome, absolute)
    val temporary = Files.createTempFile(parent, ".${absolute.fileName}.", ".tmp")
    try {
        val bytes = (Json { prettyPrint = true }.encodeToString(JsonElement.serializer(), document) + "\n")
            .toByteArray(Charsets.UTF_8)
        FileChannel.open(temporary, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING).use { channel ->
            val remaining = ByteBuffer.wrap(bytes)
            while (remaining.hasRemaining()) channel.write(remaining)
            channel.force(true)
        }
        Files.move(temporary, absolute, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
        Files.deleteIfExists(temporary)
    }
}
