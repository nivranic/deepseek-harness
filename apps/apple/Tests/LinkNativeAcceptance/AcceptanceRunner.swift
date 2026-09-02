import CompanionUI
import CryptoKit
import Foundation
import Observation
import SharedAppleRemoteCore

private actor ActiveMutationCapture {
    private var changed = false

    func markChanged() {
        changed = true
    }

    func hasChanged() -> Bool {
        changed
    }
}

struct AcceptanceRunner {
    private static let operationTimeout: TimeInterval = 30

    private let config: AcceptanceConfig
    private let corpus: AcceptanceCorpus
    private let corpusSha256: String
    private let control: AcceptanceControlClient
    private var passed: [String] = []

    init() throws {
        guard let configPath = ProcessInfo.processInfo.environment["DSH_LINK_ACCEPTANCE_CONFIG"],
              !configPath.isEmpty else {
            throw AcceptanceFailure("DSH_LINK_ACCEPTANCE_CONFIG is not set")
        }
        let configData = try Self.read(path: configPath, context: "acceptance config")
        try Self.validateConfigKeys(configData)
        let decodedConfig: AcceptanceConfig
        do {
            decodedConfig = try JSONDecoder().decode(AcceptanceConfig.self, from: configData)
        } catch {
            throw AcceptanceFailure("acceptance config is not valid schema-version-1 JSON")
        }
        try Self.validate(decodedConfig)
        guard Self.pathDoesNotExist(Self.candidateResultURL(decodedConfig.candidateResultPath).path) else {
            throw AcceptanceFailure("acceptance candidateResultPath already exists")
        }

        let corpusData = try Self.read(path: decodedConfig.corpusPath, context: "acceptance corpus")
        try Self.validateCorpusKeys(corpusData)
        let decodedCorpus: AcceptanceCorpus
        do {
            decodedCorpus = try JSONDecoder().decode(AcceptanceCorpus.self, from: corpusData)
        } catch {
            throw AcceptanceFailure("acceptance corpus is not valid JSON")
        }
        let ids = decodedCorpus.steps.map(\.id)
        let listStep = decodedCorpus.steps.first { $0.id == "list" }
        let historyStep = decodedCorpus.steps.first { $0.id == "history" }
        let promptStep = decodedCorpus.steps.first { $0.id == "prompt" }
        let approvalStep = decodedCorpus.steps.first { $0.id == "approval" }
        let reconnectStep = decodedCorpus.steps.first { $0.id == "reconnect" }
        let recovery = reconnectStep?.recovery
        let decoySessionId = listStep?.decoySessionId
        guard decodedCorpus.schemaVersion == 1,
              decodedCorpus.contractVersion == 1,
              ids == requiredStepIDs,
              Set(ids).count == requiredStepIDs.count,
              listStep?.targetSessionId == decodedConfig.sessionId,
              decoySessionId?.isEmpty == false,
              decoySessionId != decodedConfig.sessionId,
              listStep?.expectedSessionIds == [decodedConfig.sessionId],
              historyStep?.targetSessionId == decodedConfig.sessionId,
              historyStep?.decoySessionId == decoySessionId,
              historyStep?.expectedTargetRelation == "matches-follow-opening",
              historyStep?.decoyErrorCode == "forbidden",
              promptStep?.targetSessionId == decodedConfig.sessionId,
              promptStep?.decoySessionId == decoySessionId,
              promptStep?.text?.isEmpty == false,
              promptStep?.expectedAccepted == true,
              promptStep?.expectedResponseText?.isEmpty == false,
              promptStep?.expectedResponseText == decodedConfig.expectedResponseText,
              promptStep?.decoyErrorCode == "forbidden",
              approvalStep?.stallPrompt?.isEmpty == false,
              approvalStep?.outcome == "allowed-once",
              reconnectStep?.fault == "interrupt-active-streams",
              reconnectStep?.expectedFollowReplacementCount == 1,
              reconnectStep?.expectedEventReplacementCount == 1,
              reconnectStep?.expectedAuthoritativeSnapshot == true,
              reconnectStep?.expectedClientIdRefresh == true,
              recovery?.prompt.isEmpty == false,
              recovery?.faultAfter == "first-assistant-chunk",
              recovery?.expectedTerminalKind == "completed",
              recovery?.minimumOfflineSeqAdvance == 1,
              recovery?.expectedFollowReplacementCount == 2,
              recovery?.expectedEventReplacementCount == 2,
              recovery?.expectedSameCutReconnectCount == 1,
              recovery?.expectedSnapshotHasMore == false,
              recovery?.expectedFinalProjectionRelation == "authoritative-snapshot-fold" else {
            throw AcceptanceFailure("acceptance corpus does not contain the exact ordered 13-step semantics")
        }

        config = decodedConfig
        corpus = decodedCorpus
        corpusSha256 = SHA256.hash(data: corpusData)
            .map { String(format: "%02x", $0) }
            .joined()
        control = try AcceptanceControlClient(
            endpoint: decodedConfig.controlEndpoint,
            token: decodedConfig.controlToken
        )
    }

    @MainActor
    mutating func run() async throws {
        let credentials = MemoryLinkCredentialsStore()
        guard let endpoint = URL(string: config.pairing.endpoint) else {
            throw AcceptanceFailure("pairing endpoint is not a URL")
        }
        let client = LinkClient(
            baseURL: endpoint,
            pinnedFingerprint: config.pairing.spkiFingerprint,
            store: credentials
        )
        do {
            let paired = try await client.pair(payload: config.pairing, deviceName: config.deviceName)
            guard paired.hostId == config.pairing.hostId,
                  paired.hostName == config.pairing.hostName,
                  paired.endpoint == config.pairing.endpoint,
                  paired.pinnedFingerprint == config.pairing.spkiFingerprint,
                  paired.role == "controller",
                  !paired.deviceId.isEmpty,
                  credentials.load() == paired else {
                throw AcceptanceFailure("pairing returned credentials for a different host")
            }
        } catch {
            throw AcceptanceFailure("pair failed: \(safeErrorDescription(error))")
        }
        try pass("pair")

        let description: LinkHostDescription
        do {
            description = try await client.describe()
        } catch {
            throw AcceptanceFailure("authenticated connect failed: \(safeErrorDescription(error))")
        }
        try pass("connect")
        guard description.linkProtocolVersion == 1,
              description.contractVersion == Double(corpus.contractVersion),
              description.sessionFormatVersion == 0,
              description.hostId == config.pairing.hostId,
              description.runtimeClass == "full",
              description.allowRemoteApproval,
              description.capabilities.session.list,
              description.capabilities.session.history,
              description.capabilities.session.follow,
              description.capabilities.session.prompt,
              description.capabilities.session.cancel,
              description.capabilities.interaction.approval else {
            throw AcceptanceFailure("host description does not expose the required protocol versions and capabilities")
        }
        try pass("describe")

        let productionWire = LinkClientWireDriver(client: client)
        let wire = ObservedCompanionWire(base: productionWire)
        let sessions = RemoteSessionViewModel(wire: wire)
        let interactions = InteractionViewModel(wire: wire)
        let sessionId = try corpusValue(step: "list", field: \.targetSessionId)
        let listDecoySessionId = try corpusValue(step: "list", field: \.decoySessionId)
        let expectedSessionIds = try corpusValues(step: "list", field: \.expectedSessionIds)

        let listCallIndex = await wire.calls(method: "session/list").count
        await sessions.loadSessions()
        let listCall = try await Self.waitForCall(wire, method: "session/list", index: listCallIndex)
        try Self.requireSuccess(listCall)
        let listArguments = try listCall.decodedArguments()
        guard listArguments == ["_request": .object([:])],
              sessions.listState == .ready,
              sessions.sessions.map(\.id) == expectedSessionIds,
              !sessions.sessions.contains(where: { $0.id == listDecoySessionId }) else {
            throw AcceptanceFailure("production session list did not expose the configured session")
        }
        try WireObservation.listedSessions(
            try listCall.decodedResult(),
            expectedSessionIds: expectedSessionIds
        )
        try pass("list")

        let followIndex = await wire.streams(endpoint: "session/follow").count
        await sessions.open(sessionId: sessionId)
        let firstFollow = try await Self.waitForStream(
            wire,
            endpoint: "session/follow",
            index: followIndex
        )
        try Self.validateFollowPayload(firstFollow, sessionId: sessionId)
        guard let firstFollowCapture = firstFollow.follow else {
            throw AcceptanceFailure("observed production follow omitted its capture")
        }
        let opening = try await Self.waitForSnapshot(firstFollowCapture)
        try await Self.wait("production session model opening snapshot") {
            guard let active = sessions.active,
                  active.sessionId == sessionId,
                  active.cursor == Double(opening.cursor) else { return nil }
            return true
        }
        try pass("open")

        let historyTargetSessionId = try corpusValue(step: "history", field: \.targetSessionId)
        let historyDecoySessionId = try corpusValue(step: "history", field: \.decoySessionId)
        let historyRelation = try corpusValue(step: "history", field: \.expectedTargetRelation)
        let historyDecoyError = try corpusValue(step: "history", field: \.decoyErrorCode)
        let address: WireValue = .object([
            "kind": .string("session"),
            "sessionId": .string(historyTargetSessionId),
        ])
        let page = try await wire.call("session/page", args: [
            "request": .object([
                "address": address,
                "throughSeq": .number(Double(opening.cursor)),
                "maxMessages": .number(50),
            ]),
        ])
        let history = try WireObservation.page(page, throughSeq: opening.cursor)
        guard historyRelation == "matches-follow-opening",
              history.recordDocuments == opening.recordDocuments,
              history.hasMore == opening.hasMore else {
            throw AcceptanceFailure("session/page disagreed with the follow opening snapshot")
        }
        try await Self.expectRefused(code: historyDecoyError, context: "decoy session/page") {
            _ = try await wire.call("session/page", args: [
                "request": .object([
                    "address": .object([
                        "kind": .string("session"),
                        "sessionId": .string(historyDecoySessionId),
                    ]),
                    "throughSeq": .number(Double(opening.cursor)),
                    "maxMessages": .number(50),
                ]),
            ])
        }
        try pass("history")
        try Self.validate(snapshot: opening, sessionId: sessionId)
        guard sessions.active?.cursor == Double(opening.cursor) else {
            throw AcceptanceFailure("production session model did not retain the follow cursor")
        }
        try pass("follow")

        let promptTargetSessionId = try corpusValue(step: "prompt", field: \.targetSessionId)
        let promptDecoySessionId = try corpusValue(step: "prompt", field: \.decoySessionId)
        let successPrompt = try corpusValue(step: "prompt", field: \.text)
        let expectedResponseText = try corpusValue(step: "prompt", field: \.expectedResponseText)
        let promptDecoyError = try corpusValue(step: "prompt", field: \.decoyErrorCode)
        guard try corpusBool(step: "prompt", field: \.expectedAccepted),
              promptTargetSessionId == sessionId else {
            throw AcceptanceFailure("prompt semantics do not target the open session")
        }
        try await Self.expectRefused(code: promptDecoyError, context: "decoy session/prompt") {
            _ = try await wire.call("session/prompt", args: [
                "request": .object([
                    "requestId": .string("companion-decoy-\(UUID().uuidString)"),
                    "sessionId": .string(promptDecoySessionId),
                    "mode": .string("queue"),
                    "content": .array([.object([
                        "type": .string("text"),
                        "text": .string(successPrompt),
                    ])]),
                ]),
            ])
        }
        let firstPromptIndex = await wire.calls(method: "session/prompt").count
        await sessions.send(text: successPrompt)
        let firstPrompt = try await Self.waitForCall(
            wire,
            method: "session/prompt",
            index: firstPromptIndex
        )
        try Self.validatePromptCall(firstPrompt, sessionId: promptTargetSessionId, text: successPrompt)
        try pass("prompt")
        let completedResponse = try await Self.waitForCompletedResponse(
            firstFollowCapture,
            after: opening.cursor,
            expected: expectedResponseText
        )
        let completed = completedResponse.terminal
        try await Self.wait("production session model completed response") {
            guard let active = sessions.active,
                  active.cursor >= Double(completed.seq),
                  active.items.contains(where: {
                      $0.seq == Double(completedResponse.assistant.seq)
                          && $0.kind == "assistant/message"
                          && $0.text == expectedResponseText
                  }),
                  active.items.contains(where: {
                      $0.seq == Double(completed.seq) && $0.kind == "turn/end"
                  }) else { return nil }
            return true
        }
        try pass("stream")

        let eventsIndex = await wire.streams(endpoint: "$events").count
        await interactions.startWatching()
        let firstEvents = try await Self.waitForStream(wire, endpoint: "$events", index: eventsIndex)
        let firstEventsPayload = try firstEvents.decodedPayload()
        guard firstEventsPayload.isEmpty,
              let firstEventsCapture = firstEvents.forwardedEvents else {
            throw AcceptanceFailure("production interaction watch opened the wrong $events payload")
        }
        let firstClientId = try await Self.waitForReady(firstEventsCapture)
        try await Self.wait("production interaction ready identity") {
            interactions.clientId == firstClientId ? true : nil
        }

        let stallPrompt = try corpusValue(step: "approval", field: \.stallPrompt)
        let approvalOutcome = try corpusValue(step: "approval", field: \.outcome)
        let secondPromptIndex = await wire.calls(method: "session/prompt").count
        await sessions.send(text: stallPrompt)
        let secondPrompt = try await Self.waitForCall(
            wire,
            method: "session/prompt",
            index: secondPromptIndex
        )
        try Self.validatePromptCall(secondPrompt, sessionId: sessionId, text: stallPrompt)
        let secondStep = try await Self.waitForStepStart(firstFollowCapture, after: completed)
        let eventState = await firstEventsCapture.state()
        try await control.startApproval()
        let approvalEventId = try await Self.waitForApproval(
            firstEventsCapture,
            afterFrameIndex: eventState.frames.count,
            sessionId: sessionId
        )
        let pending = try await Self.wait("production interaction approval inbox") {
            interactions.inbox.first(where: { $0.id == approvalEventId })
        }
        guard pending.kind == .approval,
              pending.sessionId == sessionId,
              pending.title == "link-native-acceptance",
              pending.detail == "cross-language acceptance" else {
            throw AcceptanceFailure("production interaction model projected the approval incorrectly")
        }
        let answerIndex = await wire.calls(method: "$events/result").count
        await interactions.answer(pending, with: .allowedOnce)
        let answer = try await Self.waitForCall(
            wire,
            method: "$events/result",
            index: answerIndex
        )
        try Self.requireSuccess(answer)
        let answerArguments = try answer.decodedArguments()
        guard answerArguments == [
            "clientId": .string(firstClientId),
            "eventId": .string(approvalEventId),
            "outcome": .object([
                "kind": .string("result"),
                "value": .string(approvalOutcome),
            ]),
        ],
        interactions.lastRefusal == nil,
        !interactions.inbox.contains(where: { $0.id == approvalEventId }) else {
            throw AcceptanceFailure("production interaction model did not settle the approval")
        }
        try await control.waitForApprovalResult(timeout: Self.operationTimeout)
        try pass("approval")

        let cancelIndex = await wire.calls(method: "session/cancel").count
        await sessions.cancelActive()
        let cancel = try await Self.waitForCall(
            wire,
            method: "session/cancel",
            index: cancelIndex
        )
        try Self.requireSuccess(cancel)
        let cancelArguments = try cancel.decodedArguments()
        guard cancelArguments == [
            "request": .object(["sessionId": .string(sessionId)]),
        ] else {
            throw AcceptanceFailure("production session cancel carried the wrong request")
        }
        try WireObservation.accepted(try cancel.decodedResult(), context: "session/cancel response")
        let terminal = try await Self.waitForCancelledTerminal(firstFollowCapture, after: secondStep)
        try await Self.wait("production session model cancelled terminal") {
            guard let active = sessions.active,
                  active.cursor >= Double(terminal.seq),
                  active.items.contains(where: {
                      $0.seq == Double(terminal.seq) && $0.kind == "turn/end"
                  }) else { return nil }
            return true
        }
        try pass("cancel")

        let reconnectFault = try corpusValue(step: "reconnect", field: \.fault)
        let expectedFollowReplacementCount = try corpusInteger(
            step: "reconnect",
            field: \.expectedFollowReplacementCount
        )
        let expectedEventReplacementCount = try corpusInteger(
            step: "reconnect",
            field: \.expectedEventReplacementCount
        )
        let expectedAuthoritativeSnapshot = try corpusBool(
            step: "reconnect",
            field: \.expectedAuthoritativeSnapshot
        )
        let expectedClientIdRefresh = try corpusBool(
            step: "reconnect",
            field: \.expectedClientIdRefresh
        )
        let secondFollowIndex = await wire.streams(endpoint: "session/follow").count
        try await Self.injectReconnectFault(reconnectFault, wire: wire, generation: firstFollow)
        let closedFollowState = await firstFollowCapture.state()
        guard closedFollowState.ended, closedFollowState.failure == nil else {
            throw AcceptanceFailure("lost follow generation did not reach a clean observed end")
        }
        let secondFollow = try await Self.waitForStream(
            wire,
            endpoint: "session/follow",
            index: secondFollowIndex
        )
        try Self.validateFollowPayload(secondFollow, sessionId: sessionId)
        guard let secondFollowCapture = secondFollow.follow else {
            throw AcceptanceFailure("reconnected production follow omitted its capture")
        }
        let reopenedSnapshot = try await Self.waitForSnapshot(secondFollowCapture)
        try Self.validate(snapshot: reopenedSnapshot, sessionId: sessionId)
        if expectedAuthoritativeSnapshot {
            try Self.validateAuthoritativeSnapshot(
                reopenedSnapshot,
                completed: completed,
                cancelled: terminal,
                expectedResponseText: expectedResponseText
            )
        }
        try await Self.wait("production session model reconnected snapshot") {
            guard let active = sessions.active,
                  active.cursor == Double(reopenedSnapshot.cursor),
                  active.items.contains(where: {
                      $0.seq == Double(completedResponse.assistant.seq)
                          && $0.kind == "assistant/message"
                          && $0.text == expectedResponseText
                  }),
                  active.items.contains(where: {
                      $0.seq == Double(completed.seq) && $0.kind == "turn/end"
                  }),
                  active.items.contains(where: {
                      $0.seq == Double(terminal.seq) && $0.kind == "turn/end"
                  }) else { return nil }
            return true
        }

        let secondEventsIndex = await wire.streams(endpoint: "$events").count
        try await Self.injectReconnectFault(reconnectFault, wire: wire, generation: firstEvents)
        let closedEventsState = await firstEventsCapture.state()
        guard closedEventsState.ended, closedEventsState.failure == nil else {
            throw AcceptanceFailure("lost $events generation did not reach a clean observed end")
        }
        let secondEvents = try await Self.waitForStream(
            wire,
            endpoint: "$events",
            index: secondEventsIndex
        )
        let secondEventsPayload = try secondEvents.decodedPayload()
        guard secondEventsPayload.isEmpty,
              let secondEventsCapture = secondEvents.forwardedEvents else {
            throw AcceptanceFailure("reconnected production interaction watch opened the wrong payload")
        }
        let secondClientId = try await Self.waitForReady(secondEventsCapture)
        try await Self.wait("production interaction reconnected identity") {
            interactions.clientId == secondClientId ? true : nil
        }
        guard (secondClientId != firstClientId) == expectedClientIdRefresh else {
            throw AcceptanceFailure("reopened $events stream did not match the expected clientId refresh")
        }
        let followGenerationCount = await wire.streams(endpoint: "session/follow").count
        let eventGenerationCount = await wire.streams(endpoint: "$events").count
        let followReplacementCount = followGenerationCount - secondFollowIndex
        let eventReplacementCount = eventGenerationCount - secondEventsIndex
        guard followReplacementCount == expectedFollowReplacementCount,
              eventReplacementCount == expectedEventReplacementCount else {
            throw AcceptanceFailure("production reconnect did not open the expected replacement generations")
        }

        let recovery = try corpusRecovery()
        let recoveryFollowStartCount = followGenerationCount
        let recoveryEventStartCount = eventGenerationCount
        let gatedEndpoints: Set<String> = ["session/follow", "$events"]
        try await wire.armNextStreams(gatedEndpoints)
        let firstRecoveryChunk: ObservedSessionEvent
        let preFaultSeq: Int
        let recoveryStatus: AcceptanceRecoveryStatus
        let recoveryActiveMutation: ActiveMutationCapture
        do {
            let recoveryPromptIndex = await wire.calls(method: "session/prompt").count
            await sessions.send(text: recovery.prompt)
            let recoveryPrompt = try await Self.waitForCall(
                wire,
                method: "session/prompt",
                index: recoveryPromptIndex
            )
            try Self.validatePromptCall(recoveryPrompt, sessionId: sessionId, text: recovery.prompt)
            firstRecoveryChunk = try await Self.waitForFirstAssistantChunk(
                secondFollowCapture,
                after: reopenedSnapshot.cursor
            )
            guard recovery.faultAfter == "first-assistant-chunk" else {
                throw AcceptanceFailure("recovery fault is not anchored to the first assistant chunk")
            }
            preFaultSeq = firstRecoveryChunk.seq
            try await Self.wait("production recovery first-chunk consumption") {
                guard let active = sessions.active,
                      active.sessionId == sessionId,
                      active.cursor >= Double(firstRecoveryChunk.seq) else {
                    return nil
                }
                return true
            }
            try await wire.interruptAndAwaitCurrent([secondFollow, secondEvents])
            let interruptedRecoveryFollow = await secondFollowCapture.state()
            let interruptedRecoveryEvents = await secondEventsCapture.state()
            guard interruptedRecoveryFollow.ended,
                  interruptedRecoveryFollow.failure == nil,
                  interruptedRecoveryEvents.ended,
                  interruptedRecoveryEvents.failure == nil else {
                throw AcceptanceFailure("recovery did not cancel both production stream iterators cleanly")
            }
            try await Self.waitForStreamGate(wire, endpoints: gatedEndpoints)
            recoveryStatus = try await control.waitForRecoveryStatus(
                preFaultSeq: preFaultSeq,
                timeout: Self.operationTimeout
            )
            guard recoveryStatus.hostFinalCursor > preFaultSeq,
                  recoveryStatus.offlineSeqCount >= recovery.minimumOfflineSeqAdvance else {
                throw AcceptanceFailure("Host recovery did not advance enough while both streams were offline")
            }

            recoveryActiveMutation = Self.observeNextActiveMutation(sessions)
            try await wire.releaseStreamGate()
        } catch {
            await wire.cancelStreamGate()
            throw error
        }
        let recoveryFollow = try await Self.waitForStream(
            wire,
            endpoint: "session/follow",
            index: recoveryFollowStartCount
        )
        try Self.validateFollowPayload(recoveryFollow, sessionId: sessionId)
        guard let recoveryFollowCapture = recoveryFollow.follow else {
            throw AcceptanceFailure("recovery follow replacement omitted its capture")
        }
        let recoverySnapshot = try await Self.waitForSnapshot(recoveryFollowCapture)
        try Self.validate(snapshot: recoverySnapshot, sessionId: sessionId)
        try Self.validateRecoverySnapshot(
            recoverySnapshot,
            firstChunk: firstRecoveryChunk,
            hostFinalCursor: recoveryStatus.hostFinalCursor,
            expectedTerminalKind: recovery.expectedTerminalKind,
            expectedHasMore: recovery.expectedSnapshotHasMore
        )

        let recoveryEvents = try await Self.waitForStream(
            wire,
            endpoint: "$events",
            index: recoveryEventStartCount
        )
        let recoveryEventsPayload = try recoveryEvents.decodedPayload()
        guard recoveryEventsPayload.isEmpty,
              let recoveryEventsCapture = recoveryEvents.forwardedEvents else {
            throw AcceptanceFailure("recovery $events replacement opened the wrong payload")
        }
        let recoveryClientId = try await Self.waitForReady(recoveryEventsCapture)
        try await Self.wait("production interaction recovery identity") {
            interactions.clientId == recoveryClientId ? true : nil
        }
        guard recoveryClientId != secondClientId else {
            throw AcceptanceFailure("recovery $events replacement reused its lost clientId")
        }
        try await Self.waitForActiveMutation(
            recoveryActiveMutation,
            context: "production recovery snapshot consumption"
        )
        let beforeRepeatedReconnectProjection = try Self.productProjection(
            sessions,
            sessionId: sessionId,
            cursor: recoverySnapshot.cursor
        )

        try await wire.armNextStreams(gatedEndpoints)
        let repeatedActiveMutation: ActiveMutationCapture
        do {
            try await wire.interruptAndAwaitCurrent([recoveryFollow, recoveryEvents])
            let interruptedRepeatedFollow = await recoveryFollowCapture.state()
            let interruptedRepeatedEvents = await recoveryEventsCapture.state()
            guard interruptedRepeatedFollow.ended,
                  interruptedRepeatedFollow.failure == nil,
                  interruptedRepeatedEvents.ended,
                  interruptedRepeatedEvents.failure == nil else {
                throw AcceptanceFailure("same-cut reconnect did not cancel both production stream iterators cleanly")
            }
            try await Self.waitForStreamGate(wire, endpoints: gatedEndpoints)
            repeatedActiveMutation = Self.observeNextActiveMutation(sessions)
            try await wire.releaseStreamGate()
        } catch {
            await wire.cancelStreamGate()
            throw error
        }

        let repeatedFollow = try await Self.waitForStream(
            wire,
            endpoint: "session/follow",
            index: recoveryFollowStartCount + recovery.expectedSameCutReconnectCount
        )
        try Self.validateFollowPayload(repeatedFollow, sessionId: sessionId)
        guard let repeatedFollowCapture = repeatedFollow.follow else {
            throw AcceptanceFailure("same-cut follow replacement omitted its capture")
        }
        let repeatedSnapshot = try await Self.waitForSnapshot(repeatedFollowCapture)
        try Self.validate(snapshot: repeatedSnapshot, sessionId: sessionId)
        guard repeatedSnapshot.cursor == recoverySnapshot.cursor,
              repeatedSnapshot.hasMore == recovery.expectedSnapshotHasMore else {
            throw AcceptanceFailure("same-cut reconnect changed the authoritative Host cut")
        }

        let repeatedEvents = try await Self.waitForStream(
            wire,
            endpoint: "$events",
            index: recoveryEventStartCount + recovery.expectedSameCutReconnectCount
        )
        let repeatedEventsPayload = try repeatedEvents.decodedPayload()
        guard repeatedEventsPayload.isEmpty,
              let repeatedEventsCapture = repeatedEvents.forwardedEvents else {
            throw AcceptanceFailure("same-cut $events replacement opened the wrong payload")
        }
        let repeatedClientId = try await Self.waitForReady(repeatedEventsCapture)
        try await Self.wait("production interaction same-cut identity") {
            interactions.clientId == repeatedClientId ? true : nil
        }
        guard repeatedClientId != recoveryClientId else {
            throw AcceptanceFailure("same-cut $events replacement reused its lost clientId")
        }
        try await Self.waitForActiveMutation(
            repeatedActiveMutation,
            context: "production same-cut snapshot consumption"
        )
        let afterRepeatedReconnectProjection = try Self.productProjection(
            sessions,
            sessionId: sessionId,
            cursor: repeatedSnapshot.cursor
        )
        guard recovery.expectedFinalProjectionRelation == "authoritative-snapshot-fold",
              afterRepeatedReconnectProjection == beforeRepeatedReconnectProjection else {
            throw AcceptanceFailure("same-cut reconnect did not reproduce the complete product projection")
        }

        let recoveryFollowReplacementCount = await wire.streams(endpoint: "session/follow").count
            - recoveryFollowStartCount
        let recoveryEventReplacementCount = await wire.streams(endpoint: "$events").count
            - recoveryEventStartCount
        guard recoveryFollowReplacementCount == recovery.expectedFollowReplacementCount,
              recoveryEventReplacementCount == recovery.expectedEventReplacementCount else {
            throw AcceptanceFailure("streaming recovery opened the wrong number of replacement generations")
        }
        let recoveryResult = AcceptanceResult.Recovery(
            preFaultSeq: preFaultSeq,
            recoverySnapshotCursor: recoverySnapshot.cursor,
            repeatedSnapshotCursor: repeatedSnapshot.cursor,
            offlineSeqCount: recoveryStatus.offlineSeqCount,
            recoverySnapshotHasMore: recoverySnapshot.hasMore,
            followReplacementCount: recoveryFollowReplacementCount,
            eventReplacementCount: recoveryEventReplacementCount,
            beforeRepeatedReconnectProjection: beforeRepeatedReconnectProjection,
            afterRepeatedReconnectProjection: afterRepeatedReconnectProjection
        )
        try pass("reconnect")

        sessions.close()
        interactions.stopWatching()
        try await wire.awaitClosed(streamId: repeatedFollow.id)
        try await wire.awaitClosed(streamId: repeatedEvents.id)

        try await control.revoke()
        do {
            _ = try await client.describe()
            throw AcceptanceFailure("revoked credentials still authenticated describe")
        } catch let error as LinkClientError {
            guard case .carrier(let status, _) = error, status == 401 else {
                throw AcceptanceFailure("describe failed after revoke for a reason other than authorization")
            }
        }
        try pass("revoke")
        try writeResult(description: description, recovery: recoveryResult)
    }

    private mutating func pass(_ id: String) throws {
        guard passed.count < requiredStepIDs.count,
              requiredStepIDs[passed.count] == id else {
            throw AcceptanceFailure("acceptance step \(id) was recorded out of order or more than once")
        }
        passed.append(id)
    }

    private func writeResult(
        description: LinkHostDescription,
        recovery: AcceptanceResult.Recovery
    ) throws {
        guard passed == requiredStepIDs,
              let linkProtocolVersion = Int(exactly: description.linkProtocolVersion),
              let contractVersion = Int(exactly: description.contractVersion),
              let sessionFormatVersion = Int(exactly: description.sessionFormatVersion) else {
            throw AcceptanceFailure("not every acceptance step passed with integral protocol versions")
        }
        let result = AcceptanceResult(
            schemaVersion: 1,
            language: "swift",
            corpusSha256: corpusSha256,
            hostCommit: config.hostCommit,
            clientCommit: config.clientCommit,
            linkProtocolVersion: linkProtocolVersion,
            contractVersion: contractVersion,
            sessionFormatVersion: sessionFormatVersion,
            steps: corpus.steps.map { .init(id: $0.id, status: "PASS") },
            recovery: recovery
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var data = try encoder.encode(result)
        data.append(0x0a)
        let resultURL = Self.candidateResultURL(config.candidateResultPath)
        do {
            try FileManager.default.createDirectory(
                at: resultURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            guard let dshHome = ProcessInfo.processInfo.environment["DSH_HOME"],
                  Self.isCandidateResultPath(resultURL.path, inside: dshHome),
                  Self.pathDoesNotExist(resultURL.path) else {
                throw AcceptanceFailure("acceptance candidate path changed before publication")
            }
            try data.write(to: resultURL, options: .atomic)
        } catch let failure as AcceptanceFailure {
            throw failure
        } catch {
            throw AcceptanceFailure("could not atomically write the acceptance result")
        }
    }

    private static func requireSuccess(_ call: ObservedCall) throws {
        guard call.failure == nil, call.result != nil else {
            throw AcceptanceFailure("production \(call.method) call failed")
        }
    }

    private static func injectReconnectFault(
        _ fault: String,
        wire: ObservedCompanionWire,
        generation: ObservedStreamGeneration
    ) async throws {
        switch fault {
        case "interrupt-active-streams":
            try await wire.interruptCurrent(
                streamId: generation.id,
                endpoint: generation.endpoint
            )
        default:
            throw AcceptanceFailure("acceptance corpus requested an unsupported reconnect fault")
        }
    }

    private static func validatePromptCall(
        _ call: ObservedCall,
        sessionId: String,
        text: String
    ) throws {
        try requireSuccess(call)
        let arguments = try call.decodedArguments()
        guard arguments.count == 1,
              case .object(let request)? = arguments["request"],
              Set(request.keys) == Set(["requestId", "sessionId", "mode", "content"]),
              case .string(let requestId)? = request["requestId"],
              requestId.hasPrefix("companion-"),
              case .string(let observedSessionId)? = request["sessionId"],
              observedSessionId == sessionId,
              case .string(let mode)? = request["mode"],
              mode == "queue",
              case .array(let content)? = request["content"],
              content == [.object(["type": .string("text"), "text": .string(text)])] else {
            throw AcceptanceFailure("production session prompt carried the wrong request")
        }
        try WireObservation.accepted(try call.decodedResult(), context: "session/prompt response")
    }

    private static func validateFollowPayload(
        _ generation: ObservedStreamGeneration,
        sessionId: String
    ) throws {
        let expected: [String: WireValue] = [
            "request": .object([
                "address": .object([
                    "kind": .string("session"),
                    "sessionId": .string(sessionId),
                ]),
            ]),
        ]
        let payload = try generation.decodedPayload()
        guard payload == expected else {
            throw AcceptanceFailure("production session model opened follow with the wrong payload")
        }
    }

    private static func validateAuthoritativeSnapshot(
        _ snapshot: FollowSnapshot,
        completed: ObservedSessionEvent,
        cancelled: ObservedSessionEvent,
        expectedResponseText: String
    ) throws {
        guard let completedTurn = completed.turn,
              let cancelledTurn = cancelled.turn,
              completed.terminalKind == "completed",
              cancelled.terminalKind == "aborted",
              cancelled.terminalCause == "user",
              snapshot.cursor >= cancelled.seq,
              snapshot.records.contains(where: {
                  $0.turn == completedTurn
                      && $0.type == "assistant/message"
                      && $0.text == expectedResponseText
              }),
              snapshot.records.contains(where: {
                  $0.seq == completed.seq
                      && $0.turn == completedTurn
                      && $0.type == "turn/end"
                      && $0.terminalKind == "completed"
              }),
              snapshot.records.contains(where: {
                  $0.seq == cancelled.seq
                      && $0.turn == cancelledTurn
                      && $0.type == "turn/end"
                      && $0.terminalKind == "aborted"
                      && $0.terminalCause == "user"
              }) else {
            throw AcceptanceFailure("reopened follow omitted the current completed or cancelled turn")
        }
    }

    private static func validateRecoverySnapshot(
        _ snapshot: FollowSnapshot,
        firstChunk: ObservedSessionEvent,
        hostFinalCursor: Int,
        expectedTerminalKind: String,
        expectedHasMore: Bool
    ) throws {
        guard firstChunk.type == "assistant/chunk",
              let recoveryTurn = firstChunk.turn,
              expectedTerminalKind == "completed",
              snapshot.cursor == hostFinalCursor,
              snapshot.hasMore == expectedHasMore,
              snapshot.records.contains(where: {
                  $0.seq > firstChunk.seq
                      && $0.turn == recoveryTurn
                      && $0.type == "turn/end"
                      && $0.terminalKind == expectedTerminalKind
              }) else {
            throw AcceptanceFailure("recovery snapshot omitted the offline completed turn or Host cut")
        }
    }

    @MainActor
    private static func productProjection(
        _ sessions: RemoteSessionViewModel,
        sessionId: String,
        cursor: Int
    ) throws -> CompanionDomainState {
        guard let active = sessions.active,
              active.sessionId == sessionId,
              active.cursor == Double(cursor) else {
            throw AcceptanceFailure("production session model did not publish the authoritative recovery cut")
        }
        let pane = sessions.planTodoGoal
        return CompanionDomainState(
            cursor: active.cursor,
            items: active.items.map {
                CompanionDomainState.Item(seq: $0.seq, kind: $0.kind, text: $0.text)
            },
            planActive: pane.planActive,
            todos: pane.todos.map {
                CompanionDomainState.Todo(text: $0.text, status: $0.status)
            },
            goals: pane.goals.map {
                CompanionDomainState.Goal(id: $0.id, title: $0.title, state: $0.state)
            },
            toolCalls: sessions.toolCalls,
            images: sessions.images,
            artifacts: sessions.artifacts
        )
    }

    @MainActor
    private static func observeNextActiveMutation(
        _ sessions: RemoteSessionViewModel
    ) -> ActiveMutationCapture {
        let capture = ActiveMutationCapture()
        withObservationTracking {
            _ = sessions.active
        } onChange: {
            Task { await capture.markChanged() }
        }
        return capture
    }

    @MainActor
    private static func waitForActiveMutation(
        _ capture: ActiveMutationCapture,
        context: String
    ) async throws {
        _ = try await wait(context) {
            await capture.hasChanged() ? true : nil
        }
    }

    private static func validate(_ config: AcceptanceConfig) throws {
        guard config.schemaVersion == 1,
              config.language == "swift",
              !config.corpusPath.isEmpty,
              !config.candidateResultPath.isEmpty,
              !config.sessionId.isEmpty,
              !config.hostCommit.isEmpty,
              !config.clientCommit.isEmpty,
              !config.expectedResponseText.isEmpty,
              !config.deviceName.isEmpty,
              !config.controlToken.isEmpty,
              let dshHome = ProcessInfo.processInfo.environment["DSH_HOME"],
              isCandidateResultPath(config.candidateResultPath, inside: dshHome),
              config.pairing.v == 1,
              config.pairing.kind == "dsh-link-pairing",
              config.pairing.expiresAt > Date().timeIntervalSince1970 * 1_000,
              let endpoint = URL(string: config.pairing.endpoint),
              endpoint.scheme?.lowercased() == "https",
              endpoint.host != nil,
              endpoint.user == nil,
              endpoint.password == nil,
              endpoint.query == nil,
              endpoint.fragment == nil,
              config.pairing.spkiFingerprint.count == 64,
              config.pairing.spkiFingerprint.allSatisfy({
                  "0123456789abcdef".contains($0)
              }) else {
            throw AcceptanceFailure("acceptance config failed schema or pairing validation")
        }
    }

    private static func isCandidateResultPath(_ path: String, inside dshHome: String) -> Bool {
        guard (path as NSString).isAbsolutePath,
              (dshHome as NSString).isAbsolutePath else {
            return false
        }
        let homeComponents = URL(
            fileURLWithPath: dshHome,
            isDirectory: true
        ).standardizedFileURL.pathComponents
        let candidateComponents = candidateResultURL(path).pathComponents
        guard candidateComponents.count > homeComponents.count,
              Array(candidateComponents.prefix(homeComponents.count)) == homeComponents else {
            return false
        }

        let homeURL = URL(fileURLWithPath: dshHome, isDirectory: true).standardizedFileURL
        guard existingDirectoryIsUnlinked(homeURL) else { return false }
        var current = homeURL
        for component in candidateComponents
            .dropFirst(homeComponents.count)
            .dropLast() {
            current.appendPathComponent(component, isDirectory: true)
            var isDirectory: ObjCBool = false
            if !FileManager.default.fileExists(atPath: current.path, isDirectory: &isDirectory) {
                if (try? FileManager.default.destinationOfSymbolicLink(atPath: current.path)) != nil {
                    return false
                }
                break
            }
            guard isDirectory.boolValue, existingDirectoryIsUnlinked(current) else { return false }
        }
        return true
    }

    private static func candidateResultURL(_ path: String) -> URL {
        URL(fileURLWithPath: path, isDirectory: false).standardizedFileURL
    }

    private static func existingDirectoryIsUnlinked(_ url: URL) -> Bool {
        if (try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)) != nil {
            return false
        }
        guard let values = try? url.resourceValues(forKeys: [
            .isAliasFileKey,
            .isDirectoryKey,
            .isSymbolicLinkKey,
        ]) else { return false }
        return values.isDirectory == true
            && values.isSymbolicLink != true
            && values.isAliasFile != true
    }

    private static func pathDoesNotExist(_ path: String) -> Bool {
        !FileManager.default.fileExists(atPath: path)
            && (try? FileManager.default.destinationOfSymbolicLink(atPath: path)) == nil
    }

    private static func validateConfigKeys(_ data: Data) throws {
        let json: Any
        do {
            json = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw AcceptanceFailure("acceptance config is not a JSON object")
        }
        guard let root = json as? [String: Any],
              Set(root.keys) == Set([
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
              ]),
              let pairing = root["pairing"] as? [String: Any],
              Set(pairing.keys) == Set([
                  "v",
                  "kind",
                  "hostId",
                  "hostName",
                  "endpoint",
                  "spkiFingerprint",
                  "code",
                  "expiresAt",
              ]) else {
            throw AcceptanceFailure("acceptance config does not match the locked schema")
        }
    }

    private static func validateCorpusKeys(_ data: Data) throws {
        let json: Any
        do {
            json = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw AcceptanceFailure("acceptance corpus is not a JSON object")
        }
        guard let root = json as? [String: Any],
              Set(root.keys) == Set(["schemaVersion", "contractVersion", "steps"]),
              let steps = root["steps"] as? [[String: Any]],
              steps.count == requiredStepIDs.count else {
            throw AcceptanceFailure("acceptance corpus does not match the locked root schema")
        }
        for (index, step) in steps.enumerated() {
            let expectedId = requiredStepIDs[index]
            guard step["id"] as? String == expectedId else {
                throw AcceptanceFailure("acceptance corpus steps are not in canonical order")
            }
            let expectedKeys: Set<String>
            switch expectedId {
            case "list":
                expectedKeys = Set(["id", "targetSessionId", "decoySessionId", "expectedSessionIds"])
            case "history":
                expectedKeys = Set([
                    "id", "targetSessionId", "decoySessionId",
                    "expectedTargetRelation", "decoyErrorCode",
                ])
            case "prompt":
                expectedKeys = Set([
                    "id", "targetSessionId", "decoySessionId", "text",
                    "expectedAccepted", "expectedResponseText", "decoyErrorCode",
                ])
            case "approval":
                expectedKeys = Set(["id", "stallPrompt", "outcome"])
            case "reconnect":
                expectedKeys = Set([
                    "id", "fault", "expectedFollowReplacementCount",
                    "expectedEventReplacementCount", "expectedAuthoritativeSnapshot",
                    "expectedClientIdRefresh", "recovery",
                ])
                guard let recovery = step["recovery"] as? [String: Any],
                      Set(recovery.keys) == Set([
                          "prompt", "faultAfter", "expectedTerminalKind",
                          "minimumOfflineSeqAdvance", "expectedFollowReplacementCount",
                          "expectedEventReplacementCount", "expectedSameCutReconnectCount",
                          "expectedSnapshotHasMore", "expectedFinalProjectionRelation",
                      ]) else {
                    throw AcceptanceFailure("acceptance reconnect recovery does not match its locked schema")
                }
            default:
                expectedKeys = Set(["id"])
            }
            guard Set(step.keys) == expectedKeys else {
                throw AcceptanceFailure("acceptance corpus step \(expectedId) does not match its locked schema")
            }
        }
    }

    private static func validate(snapshot: FollowSnapshot, sessionId: String) throws {
        guard snapshot.sessionId == sessionId,
              snapshot.formatVersion == 0,
              snapshot.cursor >= 0,
              !snapshot.records.isEmpty,
              snapshot.projectionAsOfSeq == snapshot.cursor,
              snapshot.projectionsHaveValues,
              snapshot.records.allSatisfy({ $0.seq <= snapshot.cursor }) else {
            throw AcceptanceFailure("follow opening snapshot was not authoritative for the configured session")
        }
    }

    private static func read(path: String, context: String) throws -> Data {
        do {
            return try Data(contentsOf: URL(fileURLWithPath: path))
        } catch {
            throw AcceptanceFailure("could not read \(context)")
        }
    }

    private func corpusValue(
        step id: String,
        field: KeyPath<AcceptanceCorpus.Step, String?>
    ) throws -> String {
        guard let step = corpus.steps.first(where: { $0.id == id }),
              let value = step[keyPath: field],
              !value.isEmpty else {
            throw AcceptanceFailure("acceptance corpus omitted a required \(id) value")
        }
        return value
    }

    private func corpusValues(
        step id: String,
        field: KeyPath<AcceptanceCorpus.Step, [String]?>
    ) throws -> [String] {
        guard let step = corpus.steps.first(where: { $0.id == id }),
              let values = step[keyPath: field],
              !values.isEmpty,
              values.allSatisfy({ !$0.isEmpty }) else {
            throw AcceptanceFailure("acceptance corpus omitted required \(id) values")
        }
        return values
    }

    private func corpusBool(
        step id: String,
        field: KeyPath<AcceptanceCorpus.Step, Bool?>
    ) throws -> Bool {
        guard let step = corpus.steps.first(where: { $0.id == id }),
              let value = step[keyPath: field] else {
            throw AcceptanceFailure("acceptance corpus omitted a required \(id) flag")
        }
        return value
    }

    private func corpusInteger(
        step id: String,
        field: KeyPath<AcceptanceCorpus.Step, Int?>
    ) throws -> Int {
        guard let step = corpus.steps.first(where: { $0.id == id }),
              let value = step[keyPath: field] else {
            throw AcceptanceFailure("acceptance corpus omitted a required \(id) integer")
        }
        return value
    }

    private func corpusRecovery() throws -> AcceptanceCorpus.Recovery {
        guard let recovery = corpus.steps.first(where: { $0.id == "reconnect" })?.recovery else {
            throw AcceptanceFailure("acceptance corpus omitted reconnect recovery semantics")
        }
        return recovery
    }

    @MainActor
    private static func expectRefused(
        code: String,
        context: String,
        operation: () async throws -> Void
    ) async throws {
        do {
            try await operation()
        } catch let error as LinkClientError {
            guard case .refused(let actual, _) = error, actual == code else {
                throw AcceptanceFailure("\(context) failed for a reason other than \(code)")
            }
            return
        } catch {
            throw AcceptanceFailure("\(context) failed for a reason other than \(code)")
        }
        throw AcceptanceFailure("\(context) unexpectedly succeeded")
    }

    @MainActor
    private static func waitForCall(
        _ wire: ObservedCompanionWire,
        method: String,
        index: Int
    ) async throws -> ObservedCall {
        try await wait("production \(method) call") {
            let calls = await wire.calls(method: method)
            return calls.indices.contains(index) ? calls[index] : nil
        }
    }

    @MainActor
    private static func waitForStream(
        _ wire: ObservedCompanionWire,
        endpoint: String,
        index: Int
    ) async throws -> ObservedStreamGeneration {
        try await wait("production \(endpoint) stream") {
            let streams = await wire.streams(endpoint: endpoint)
            return streams.indices.contains(index) ? streams[index] : nil
        }
    }

    @MainActor
    private static func waitForSnapshot(_ capture: FollowCapture) async throws -> FollowSnapshot {
        try await wait("follow snapshot") {
            let state = await capture.state()
            if let failure = state.failure { throw AcceptanceFailure("follow stream failed: \(failure)") }
            if let snapshot = state.snapshots.first { return snapshot }
            if state.ended { throw AcceptanceFailure("follow stream ended before its snapshot") }
            return nil
        }
    }

    @MainActor
    private static func waitForFirstAssistantChunk(
        _ capture: FollowCapture,
        after seq: Int
    ) async throws -> ObservedSessionEvent {
        let deadline = Date().addingTimeInterval(operationTimeout)
        while Date() < deadline {
            let state = await capture.state()
            if let failure = state.failure { throw AcceptanceFailure("follow stream failed: \(failure)") }
            if let chunk = state.events.first(where: {
                $0.seq > seq && $0.type == "assistant/chunk"
            }) {
                return chunk
            }
            if state.events.contains(where: {
                $0.seq > seq && $0.type == "turn/end" && $0.terminalKind != nil
            }) {
                throw AcceptanceFailure("recovery turn ended before its first assistant chunk was faulted")
            }
            if state.ended { throw AcceptanceFailure("follow stream ended before the first recovery chunk") }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        throw AcceptanceFailure("timed out waiting for first recovery assistant chunk")
    }

    @MainActor
    private static func waitForStreamGate(
        _ wire: ObservedCompanionWire,
        endpoints: Set<String>
    ) async throws {
        _ = try await wait("both replacement streams at the pre-wire gate") {
            await wire.blockedStreamGateEndpoints() == endpoints ? true : nil
        }
    }

    @MainActor
    private static func waitForCompletedResponse(
        _ capture: FollowCapture,
        after seq: Int,
        expected: String
    ) async throws -> (assistant: ObservedSessionEvent, terminal: ObservedSessionEvent) {
        try await wait("live assistant output") {
            let state = await capture.state()
            if let failure = state.failure { throw AcceptanceFailure("follow stream failed: \(failure)") }
            let live = state.events.filter { $0.seq > seq }
            let messages = live.filter {
                $0.type == "assistant/message" && $0.text == expected
            }
            for message in messages {
                guard let messageTurn = message.turn else {
                    throw AcceptanceFailure("success assistant message omitted its turn")
                }
                if let terminal = live.first(where: {
                    $0.seq > message.seq
                        && $0.turn == messageTurn
                        && $0.type == "turn/end"
                        && $0.terminalKind != nil
                }) {
                    guard terminal.terminalKind == "completed" else {
                        throw AcceptanceFailure("success prompt did not reach a completed terminal state")
                    }
                    return (assistant: message, terminal: terminal)
                }
            }
            if live.contains(where: { $0.type == "turn/end" && $0.terminalKind != nil }) {
                throw AcceptanceFailure("success prompt completed without the expected assistant message")
            }
            if state.ended { throw AcceptanceFailure("follow stream ended before live assistant output") }
            return nil
        }
    }

    @MainActor
    private static func waitForReady(_ capture: ForwardedEventCapture) async throws -> String {
        try await wait("$events ready frame") {
            let state = await capture.state()
            if let failure = state.failure { throw AcceptanceFailure("$events stream failed: \(failure)") }
            for frame in state.frames {
                if case .ready(let clientId) = frame { return clientId }
            }
            if state.ended { throw AcceptanceFailure("$events stream ended before ready") }
            return nil
        }
    }

    @MainActor
    private static func waitForApproval(
        _ capture: ForwardedEventCapture,
        afterFrameIndex: Int,
        sessionId: String
    ) async throws -> String {
        try await wait("approval/request waterfall") {
            let state = await capture.state()
            if let failure = state.failure { throw AcceptanceFailure("$events stream failed: \(failure)") }
            for frame in state.frames.dropFirst(afterFrameIndex) {
                if case .waterfall(
                    let event,
                    let eventId,
                    let agentId,
                    let toolName,
                    let reason
                ) = frame {
                    guard event == "approval/request",
                          agentId == sessionId,
                          toolName == "link-native-acceptance",
                          reason == "cross-language acceptance" else {
                        throw AcceptanceFailure("approval/request did not carry the acceptance request fields")
                    }
                    return eventId
                }
            }
            if state.ended { throw AcceptanceFailure("$events stream ended before approval/request") }
            return nil
        }
    }

    @MainActor
    private static func waitForStepStart(
        _ capture: FollowCapture,
        after completed: ObservedSessionEvent
    ) async throws -> ObservedSessionEvent {
        guard let completedTurn = completed.turn else {
            throw AcceptanceFailure("completed turn terminal omitted its turn")
        }
        return try await wait("second prompt journal event") {
            let state = await capture.state()
            if let failure = state.failure { throw AcceptanceFailure("follow stream failed: \(failure)") }
            if let event = state.events.first(where: {
                $0.seq > completed.seq && $0.type == "step/start"
            }) {
                guard let turn = event.turn else {
                    throw AcceptanceFailure("stalled step omitted its turn")
                }
                guard turn > completedTurn else {
                    throw AcceptanceFailure("stalled step did not advance the turn")
                }
                return event
            }
            if state.ended { throw AcceptanceFailure("follow stream ended before the stalled step started") }
            return nil
        }
    }

    @MainActor
    private static func waitForCancelledTerminal(
        _ capture: FollowCapture,
        after step: ObservedSessionEvent
    ) async throws -> ObservedSessionEvent {
        guard let turn = step.turn else {
            throw AcceptanceFailure("stalled step omitted its turn")
        }
        return try await wait("cancelled turn terminal event") {
            let state = await capture.state()
            if let failure = state.failure { throw AcceptanceFailure("follow stream failed: \(failure)") }
            if let terminal = state.events.first(where: {
                $0.seq > step.seq
                    && $0.type == "turn/end"
                    && $0.terminalKind != nil
            }) {
                guard let terminalTurn = terminal.turn else {
                    throw AcceptanceFailure("cancelled turn terminal omitted its turn")
                }
                guard terminalTurn == turn else {
                    throw AcceptanceFailure("session/cancel ended a different turn")
                }
                guard terminal.terminalKind == "aborted", terminal.terminalCause == "user" else {
                    throw AcceptanceFailure(
                        "session/cancel did not end as aborted by the user "
                            + "(kind \(terminal.terminalKind ?? "unknown"))"
                    )
                }
                return terminal
            }
            if state.ended { throw AcceptanceFailure("follow stream ended before cancellation became terminal") }
            return nil
        }
    }

    @MainActor
    private static func wait<T>(
        _ context: String,
        poll: () async throws -> T?
    ) async throws -> T {
        let deadline = Date().addingTimeInterval(operationTimeout)
        while Date() < deadline {
            if let value = try await poll() { return value }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw AcceptanceFailure("timed out waiting for \(context)")
    }
}
