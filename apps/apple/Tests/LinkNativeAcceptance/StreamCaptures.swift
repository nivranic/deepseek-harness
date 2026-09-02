import CompanionUI
import Foundation

struct ObservedSessionEvent: Sendable {
    let type: String
    let seq: Int
    let turn: Int?
    let text: String
    let terminalKind: String?
    let terminalCause: String?
}

struct FollowSnapshot: Sendable {
    let sessionId: String
    let formatVersion: Int
    let cursor: Int
    let records: [ObservedSessionEvent]
    let recordDocuments: [Data]
    let hasMore: Bool
    let projectionAsOfSeq: Int
    let projectionsHaveValues: Bool
}

struct PageObservation: Sendable {
    let recordDocuments: [Data]
    let hasMore: Bool
}

enum FollowFrame: Sendable {
    case snapshot(FollowSnapshot)
    case event(ObservedSessionEvent)
}

actor FollowCapture {
    private var snapshots: [FollowSnapshot] = []
    private var events: [ObservedSessionEvent] = []
    private var failure: String?
    private var ended = false

    func append(_ frame: FollowFrame) {
        guard failure == nil else { return }
        if snapshots.isEmpty && events.isEmpty {
            guard case .snapshot(let snapshot) = frame else {
                failure = "follow stream did not begin with a snapshot"
                return
            }
            snapshots.append(snapshot)
            return
        }
        switch frame {
        case .snapshot:
            failure = "follow stream returned a second opening snapshot"
        case .event(let event): events.append(event)
        }
    }

    func fail(_ message: String) {
        failure = message
    }

    func finish() {
        ended = true
    }

    func state() -> (snapshots: [FollowSnapshot], events: [ObservedSessionEvent], failure: String?, ended: Bool) {
        (snapshots, events, failure, ended)
    }
}

enum ForwardedEventFrame: Sendable {
    case ready(clientId: String)
    case waterfall(
        event: String,
        eventId: String,
        agentId: String,
        toolName: String,
        reason: String
    )
    case other
}

actor ForwardedEventCapture {
    private var frames: [ForwardedEventFrame] = []
    private var failure: String?
    private var ended = false

    func append(_ frame: ForwardedEventFrame) {
        guard failure == nil else { return }
        if frames.isEmpty {
            guard case .ready = frame else {
                failure = "$events stream did not begin with ready"
                return
            }
        } else if case .ready = frame {
            failure = "$events stream returned a second ready frame"
            return
        }
        frames.append(frame)
    }

    func fail(_ message: String) {
        failure = message
    }

    func finish() {
        ended = true
    }

    func state() -> (frames: [ForwardedEventFrame], failure: String?, ended: Bool) {
        (frames, failure, ended)
    }
}

struct ObservedCall: Sendable {
    let id: Int
    let method: String
    let arguments: Data
    let result: Data?
    let failure: String?

    func decodedArguments() throws -> [String: WireValue] {
        try JSONDecoder().decode([String: WireValue].self, from: arguments)
    }

    func decodedResult() throws -> WireValue {
        guard let result else {
            throw AcceptanceFailure("observed call \(method) has no result")
        }
        return try JSONDecoder().decode(WireValue.self, from: result)
    }
}

struct ObservedStreamGeneration: Sendable {
    let id: Int
    let endpoint: String
    let payload: Data
    let follow: FollowCapture?
    let forwardedEvents: ForwardedEventCapture?

    func decodedPayload() throws -> [String: WireValue] {
        try JSONDecoder().decode([String: WireValue].self, from: payload)
    }
}

/// Acceptance-only observation around the production wire. Product view
/// models own every call and stream; this decorator records the same values
/// before forwarding them without opening a second connection.
actor ObservedCompanionWire: CompanionWireDriving {
    private let base: any CompanionWireDriving
    private var nextCallId = 0
    private var nextStreamId = 0
    private var observedCalls: [ObservedCall] = []
    private var observedStreams: [ObservedStreamGeneration] = []
    private var closedStreams = Set<Int>()
    private var streamTasks: [Int: Task<Void, Never>] = [:]

    init(base: any CompanionWireDriving) {
        self.base = base
    }

    func call(_ method: String, args: [String: WireValue]) async throws -> WireValue {
        let id = nextCallId
        nextCallId += 1
        let arguments = try Self.document(args)
        do {
            let value = try await base.call(method, args: args)
            observedCalls.append(ObservedCall(
                id: id,
                method: method,
                arguments: arguments,
                result: try Self.document(value),
                failure: nil
            ))
            return value
        } catch {
            observedCalls.append(ObservedCall(
                id: id,
                method: method,
                arguments: arguments,
                result: nil,
                failure: safeErrorDescription(error)
            ))
            throw error
        }
    }

    func stream(
        _ endpoint: String,
        payload: [String: WireValue]
    ) async throws -> AsyncThrowingStream<WireValue, Error> {
        let id = nextStreamId
        nextStreamId += 1
        let follow = endpoint == "session/follow" ? FollowCapture() : nil
        let forwardedEvents = endpoint == "$events" ? ForwardedEventCapture() : nil
        let generation = ObservedStreamGeneration(
            id: id,
            endpoint: endpoint,
            payload: try Self.document(payload),
            follow: follow,
            forwardedEvents: forwardedEvents
        )
        observedStreams.append(generation)

        let source: AsyncThrowingStream<WireValue, Error>
        do {
            source = try await base.stream(endpoint, payload: payload)
        } catch {
            await Self.fail(generation, error: error)
            closedStreams.insert(id)
            throw error
        }

        let pair = AsyncThrowingStream<WireValue, Error>.makeStream()
        let task = Task {
            do {
                for try await value in source {
                    try Task.checkCancellation()
                    try await Self.observe(value, generation: generation)
                    pair.continuation.yield(value)
                }
                await Self.finish(generation)
                await self.close(id)
                pair.continuation.finish()
            } catch let error as CancellationError {
                await self.close(id)
                if Task.isCancelled {
                    await Self.finish(generation)
                    pair.continuation.finish()
                } else {
                    await Self.fail(generation, error: error)
                    pair.continuation.finish(throwing: error)
                }
            } catch {
                await Self.fail(generation, error: error)
                await self.close(id)
                pair.continuation.finish(throwing: error)
            }
        }
        pair.continuation.onTermination = { _ in task.cancel() }
        streamTasks[id] = task
        return pair.stream
    }

    func calls(method: String) -> [ObservedCall] {
        observedCalls.filter { $0.method == method }
    }

    func streams(endpoint: String) -> [ObservedStreamGeneration] {
        observedStreams.filter { $0.endpoint == endpoint }
    }

    /// End the current generation for one endpoint and await its observation pump.
    func interruptCurrent(streamId: Int, endpoint: String) async throws {
        guard observedStreams.last(where: { $0.endpoint == endpoint })?.id == streamId,
              !closedStreams.contains(streamId),
              let task = streamTasks[streamId] else {
            throw AcceptanceFailure("production stream is not the current observer for loss injection")
        }
        task.cancel()
        await task.value
        guard closedStreams.contains(streamId) else {
            throw AcceptanceFailure("production stream loss did not close its observation pump")
        }
    }

    /// Await the observation pump that owns one generation's base iterator.
    func awaitClosed(streamId: Int) async throws {
        if let task = streamTasks[streamId] { await task.value }
        guard closedStreams.contains(streamId) else {
            throw AcceptanceFailure("production stream did not close")
        }
    }

    private func close(_ id: Int) {
        closedStreams.insert(id)
    }

    private static func observe(
        _ value: WireValue,
        generation: ObservedStreamGeneration
    ) async throws {
        if let capture = generation.follow {
            await capture.append(try WireObservation.followFrame(value))
        }
        if let capture = generation.forwardedEvents {
            await capture.append(try WireObservation.forwardedEventFrame(value))
        }
    }

    private static func finish(_ generation: ObservedStreamGeneration) async {
        if let follow = generation.follow { await follow.finish() }
        if let forwardedEvents = generation.forwardedEvents { await forwardedEvents.finish() }
    }

    private static func fail(_ generation: ObservedStreamGeneration, error: Error) async {
        let message = safeErrorDescription(error)
        if let follow = generation.follow { await follow.fail(message) }
        if let forwardedEvents = generation.forwardedEvents { await forwardedEvents.fail(message) }
    }

    private static func document<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }
}

enum WireObservation {
    static func followFrame(_ value: WireValue) throws -> FollowFrame {
        let root = try object(value, context: "follow frame")
        switch try string(root, "type", context: "follow frame") {
        case "snapshot":
            let header = try objectField(root, "header", context: "follow snapshot")
            let sessionId = try string(header, "id", context: "follow snapshot header")
            let formatVersion = try integer(header, "version", context: "follow snapshot header")
            let cursor = try integer(root, "cursor", context: "follow snapshot")
            let recordValues = try array(root, "records", context: "follow snapshot")
            let records = try recordValues.map(historyRecord)
            let projections = try objectField(root, "projections", context: "follow snapshot")
            return .snapshot(FollowSnapshot(
                sessionId: sessionId,
                formatVersion: formatVersion,
                cursor: cursor,
                records: records,
                recordDocuments: try recordValues.map(canonicalDocument),
                hasMore: try bool(root, "hasMore", context: "follow snapshot"),
                projectionAsOfSeq: try integer(projections, "asOfSeq", context: "follow projections"),
                projectionsHaveValues: projections["values"].flatMap(optionalObject) != nil
            ))
        case "event":
            return .event(try sessionEvent(try objectField(root, "event", context: "follow event")))
        default:
            throw AcceptanceFailure("follow stream returned an unknown frame type")
        }
    }

    static func forwardedEventFrame(_ value: WireValue) throws -> ForwardedEventFrame {
        let root = try object(value, context: "$events frame")
        switch try string(root, "type", context: "$events frame") {
        case "ready":
            let clientId = try string(root, "clientId", context: "$events ready frame")
            let host = try objectField(root, "host", context: "$events ready frame")
            _ = try string(host, "home", context: "$events ready host")
            guard !clientId.isEmpty else {
                throw AcceptanceFailure("$events ready frame carried an empty clientId")
            }
            return .ready(clientId: clientId)
        case "waterfall":
            let event = try string(root, "event", context: "$events waterfall frame")
            guard event == "approval/request" else { return .other }
            let eventId = try string(root, "eventId", context: "$events waterfall frame")
            let agentId = try string(root, "agentId", context: "$events waterfall frame")
            guard !eventId.isEmpty else {
                throw AcceptanceFailure("$events waterfall frame carried an empty eventId")
            }
            let request = try objectField(root, "request", context: "$events waterfall frame")
            let toolName = try string(request, "toolName", context: "approval/request payload")
            let reason = try string(request, "reason", context: "approval/request payload")
            return .waterfall(
                event: event,
                eventId: eventId,
                agentId: agentId,
                toolName: toolName,
                reason: reason
            )
        case "emit", "cancel":
            return .other
        default:
            throw AcceptanceFailure("$events stream returned an unknown frame type")
        }
    }

    static func page(_ value: WireValue, throughSeq: Int) throws -> PageObservation {
        let root = try object(value, context: "session/page response")
        let recordValues = try array(root, "records", context: "session/page response")
        let records = try recordValues.map(historyRecord)
        guard records.allSatisfy({ $0.seq <= throughSeq }) else {
            throw AcceptanceFailure("session/page returned a record beyond throughSeq")
        }
        return PageObservation(
            recordDocuments: try recordValues.map(canonicalDocument),
            hasMore: try bool(root, "hasMore", context: "session/page response")
        )
    }

    static func accepted(_ value: WireValue, context: String) throws {
        let root = try object(value, context: context)
        guard try bool(root, "accepted", context: context) else {
            throw AcceptanceFailure("\(context) was not accepted")
        }
    }

    static func listedSessions(_ value: WireValue, expectedSessionIds: [String]) throws {
        let root = try object(value, context: "session/list response")
        let items = try array(root, "items", context: "session/list response")
        let sessionIds = try items.map { item in
            try string(
                object(item, context: "session/list item"),
                "sessionId",
                context: "session/list item"
            )
        }
        guard sessionIds == expectedSessionIds else {
            throw AcceptanceFailure("session/list did not return the exact authorized sessions")
        }
    }

    private static func historyRecord(_ value: WireValue) throws -> ObservedSessionEvent {
        let record = try object(value, context: "session history record")
        let kind = try string(record, "type", context: "session history record")
        guard kind == "event" || kind == "chunks" else {
            throw AcceptanceFailure("session history returned an unknown record type")
        }
        return try sessionEvent(try objectField(record, "event", context: "session history record"))
    }

    private static func sessionEvent(_ event: [String: WireValue]) throws -> ObservedSessionEvent {
        let type = try string(event, "type", context: "session event")
        let seq = try integer(event, "seq", context: "session event")
        let data = try objectField(event, "data", context: "session event")
        let turn: Int?
        if data["turn"] == nil {
            turn = nil
        } else {
            turn = try integer(data, "turn", context: "session event")
        }
        var text = ""
        var terminalKind: String?
        var terminalCause: String?

        switch type {
        case "assistant/chunk":
            if let chunk = data["chunk"].flatMap(optionalObject),
               case .string(let delta)? = chunk["text"] {
                text = delta
            }
        case "assistant/message":
            if let message = data["message"].flatMap(optionalObject),
               case .array(let content)? = message["content"] {
                text = content.compactMap { part in
                    guard let fields = optionalObject(part), case .string(let value)? = fields["text"] else {
                        return nil
                    }
                    return value
                }.joined()
            }
        case "chunkrow/text-chunks":
            if case .array(let texts)? = data["texts"] {
                text = texts.compactMap { item in
                    if case .string(let value) = item { return value }
                    return nil
                }.joined()
            }
        case "turn/end":
            if let reason = data["reason"].flatMap(optionalObject),
               case .string(let kind)? = reason["kind"] {
                terminalKind = kind
                if let cause = reason["reason"].flatMap(optionalObject),
                   case .string(let causeKind)? = cause["kind"] {
                    terminalCause = causeKind
                }
            } else {
                throw AcceptanceFailure("turn/end omitted its terminal reason")
            }
        default:
            break
        }

        return ObservedSessionEvent(
            type: type,
            seq: seq,
            turn: turn,
            text: text,
            terminalKind: terminalKind,
            terminalCause: terminalCause
        )
    }

    private static func object(_ value: WireValue, context: String) throws -> [String: WireValue] {
        guard let fields = optionalObject(value) else {
            throw AcceptanceFailure("\(context) was not a JSON object")
        }
        return fields
    }

    private static func optionalObject(_ value: WireValue) -> [String: WireValue]? {
        if case .object(let fields) = value { return fields }
        return nil
    }

    private static func objectField(
        _ fields: [String: WireValue],
        _ key: String,
        context: String
    ) throws -> [String: WireValue] {
        guard let value = fields[key], let object = optionalObject(value) else {
            throw AcceptanceFailure("\(context) omitted object field \(key)")
        }
        return object
    }

    private static func string(
        _ fields: [String: WireValue],
        _ key: String,
        context: String
    ) throws -> String {
        guard case .string(let value)? = fields[key] else {
            throw AcceptanceFailure("\(context) omitted string field \(key)")
        }
        return value
    }

    private static func integer(
        _ fields: [String: WireValue],
        _ key: String,
        context: String
    ) throws -> Int {
        guard case .number(let value)? = fields[key],
              value.isFinite,
              value.rounded(.towardZero) == value,
              value >= Double(Int.min),
              value <= Double(Int.max) else {
            throw AcceptanceFailure("\(context) omitted integer field \(key)")
        }
        return Int(value)
    }

    private static func bool(
        _ fields: [String: WireValue],
        _ key: String,
        context: String
    ) throws -> Bool {
        guard case .bool(let value)? = fields[key] else {
            throw AcceptanceFailure("\(context) omitted Boolean field \(key)")
        }
        return value
    }

    private static func array(
        _ fields: [String: WireValue],
        _ key: String,
        context: String
    ) throws -> [WireValue] {
        guard case .array(let value)? = fields[key] else {
            throw AcceptanceFailure("\(context) omitted array field \(key)")
        }
        return value
    }

    private static func canonicalDocument(_ value: WireValue) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            return try encoder.encode(value)
        } catch {
            throw AcceptanceFailure("wire value could not be encoded for exact comparison")
        }
    }
}
