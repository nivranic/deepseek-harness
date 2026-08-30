import XCTest
@testable import CompanionUI
import SharedAppleRemoteCore

/// A scriptable wire double: recorded unary answers per method and a
/// stream whose frames the test feeds.
actor FakeWire: CompanionWireDriving {
    private(set) var calls: [(method: String, args: [String: WireValue])] = []
    private var answers: [String: Result<WireValue, Error>] = [:]
    private var streams: [String: Result<[WireValue], Error>] = [:]

    func stub(_ method: String, answer: Result<WireValue, Error>) {
        answers[method] = answer
    }

    func stubStream(_ endpoint: String, frames: Result<[WireValue], Error>) {
        streams[endpoint] = frames
    }

    func call(_ method: String, args: [String: WireValue]) async throws -> WireValue {
        calls.append((method, args))
        switch answers[method] ?? .success(.null) {
        case .success(let value): return value
        case .failure(let error): throw error
        }
    }

    func stream(_ endpoint: String, payload: [String: WireValue]) async throws -> AsyncThrowingStream<WireValue, Error> {
        switch streams[endpoint] ?? .success([]) {
        case .success(let frames):
            return AsyncThrowingStream { continuation in
                for frame in frames { continuation.yield(frame) }
                continuation.finish()
            }
        case .failure(let error):
            return AsyncThrowingStream { continuation in
                continuation.finish(throwing: error)
            }
        }
    }
}

func jsonObject(_ entries: [String: WireValue]) -> WireValue {
    .object(entries)
}

@MainActor
final class RemoteSessionViewModelTests: XCTestCase {
    func testLoadsAndProjectsSessionRows() async {
        let wire = FakeWire()
        await wire.stub("session/list", answer: .success(jsonObject([
            "items": .array([
                jsonObject(["sessionId": .string("s1"), "title": .string("Refactor"), "updatedAt": .number(100)]),
                jsonObject(["sessionId": .string("s2"), "title": .string("Notes")]),
            ]),
        ])))
        let model = RemoteSessionViewModel(wire: wire)
        await model.loadSessions()
        XCTAssertEqual(model.listState, .ready)
        XCTAssertEqual(model.sessions, [
            SessionRow(id: "s1", title: "Refactor", updatedAt: 100),
            SessionRow(id: "s2", title: "Notes", updatedAt: nil),
        ])
    }

    func testFailureSurfacesTheCarrierMessage() async {
        let wire = FakeWire()
        await wire.stub("session/list", answer: .failure(LinkClientError.carrier(status: 401, message: "unknown device")))
        let model = RemoteSessionViewModel(wire: wire)
        await model.loadSessions()
        XCTAssertEqual(model.listState, .failed("carrier 401: unknown device"))
    }

    func testOpenFoldsSnapshotThenLiveEventsAndTracksCursor() async {
        let wire = FakeWire()
        await wire.stubStream("session/follow", frames: .success([
            jsonObject([
                "type": .string("snapshot"),
                "cursor": .number(4),
                "records": .array([
                    jsonObject(["seq": .number(1), "type": .string("record"), "text": .string("hello")]),
                    jsonObject(["seq": .number(2), "type": .string("record"), "payload": jsonObject(["text": .string("nested")])]),
                ]),
            ]),
            jsonObject(["seq": .number(5), "type": .string("event"), "event": .string("message/assistant"), "text": .string("live")]),
        ]))
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s1")
        // The stream finished cleanly, which is a loss for a follow: the view
        // model schedules a resubscribe; the assertions below hold before and
        // after because folding is idempotent per open.
        try? await Task.sleep(for: .milliseconds(50))
        let active = model.active
        XCTAssertNotNil(active)
        XCTAssertEqual(active?.sessionId, "s1")
        XCTAssertEqual(active?.cursor, 5)
        XCTAssertEqual(active?.items.map(\.text), ["hello", "nested", "live"])
        XCTAssertEqual(active?.items.map(\.kind), ["record", "record", "event/message/assistant"])
    }

    func testSendSubmitsQueuedPromptAndCancelTargetsActiveSession() async {
        let wire = FakeWire()
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s1")
        model.close()
        // Reopen through the public path with a follow stream that stays quiet.
        await wire.stubStream("session/follow", frames: .success([]))
        await model.open(sessionId: "s9")
        await model.send(text: "hi")
        await model.cancelActive()
        let methods = await wire.calls.map(\.method)
        XCTAssertTrue(methods.contains("session/prompt"))
        XCTAssertTrue(methods.contains("session/cancel"))
        let prompt = await wire.calls.first { $0.method == "session/prompt" }
        guard case .string(let sessionId)? = prompt?.args["sessionId"] else {
            return XCTFail("prompt must carry the sessionId string")
        }
        XCTAssertEqual(sessionId, "s9")
        guard case .string(let mode)? = prompt?.args["mode"] else {
            return XCTFail("prompt must carry queue mode")
        }
        XCTAssertEqual(mode, "queue")
    }
}

@MainActor
final class InteractionViewModelTests: XCTestCase {
    func testCollectsApprovalAndQuestionForwardsAndDeduplicates() {
        let model = InteractionViewModel(wire: FakeWire())
        model.collect(jsonObject([
            "event": .string("approval/requested"), "eventId": .string("e1"),
            "sessionId": .string("s1"), "title": .string("Run command"),
        ]))
        model.collect(jsonObject([
            "event": .string("question/requested"), "eventId": .string("e2"),
            "sessionId": .string("s1"), "text": .string("Pick one"),
        ]))
        model.collect(jsonObject(["event": .string("approval/requested"), "eventId": .string("e1")]))
        XCTAssertEqual(model.inbox.count, 2)
        XCTAssertEqual(model.inbox[0].kind, .approval)
        XCTAssertEqual(model.inbox[0].title, "Run command")
        XCTAssertEqual(model.inbox[1].kind, .question)
        XCTAssertEqual(model.inbox[1].detail, "Pick one")
    }

    func testAnswerSubmitsResultOutcomeAndClearsOnSuccess() async {
        let wire = FakeWire()
        await wire.stub("$events/result", answer: .success(.null))
        let model = InteractionViewModel(wire: wire)
        await model.startWatching()
        model.collect(jsonObject(["event": .string("approval/requested"), "eventId": .string("e1"), "title": .string("T")]))
        let pending = model.inbox[0]
        await model.answer(pending, with: .allowedOnce)
        XCTAssertTrue(model.inbox.isEmpty)
        let answer = await wire.calls.first { $0.method == "$events/result" }
        XCTAssertNotNil(answer)
        let outcome = answer?.args["outcome"]
        XCTAssertEqual(WireShape.string(outcome ?? .null, field: "kind"), "result")
        XCTAssertEqual(WireShape.string(outcome ?? .null, field: "value"), "allowed-once")
    }

    func testRefusedAnswerSurfacesAndKeepsTheCard() async {
        let wire = FakeWire()
        await wire.stub("$events/result", answer: .failure(LinkClientError.refused(code: "forbidden", message: "approval disabled on host")))
        let model = InteractionViewModel(wire: wire)
        model.collect(jsonObject(["event": .string("approval/requested"), "eventId": .string("e1"), "title": .string("T")]))
        await model.answer(model.inbox[0], with: .rejected)
        XCTAssertEqual(model.inbox.count, 1)
        XCTAssertEqual(model.lastRefusal, "forbidden: approval disabled on host")
    }
}

final class CompanionThemeTests: XCTestCase {
    func testLiquidGlassDegradesWithoutGlassCapableOS() {
        let theme = CompanionTheme.resolve(requested: .liquidGlass, glassCapableOS: false, reduceTransparency: false, increaseContrast: false)
        XCTAssertEqual(theme.style, .neumorphic)
    }

    func testLiquidGlassDegradesOnReducedTransparency() {
        let theme = CompanionTheme.resolve(requested: .liquidGlass, glassCapableOS: true, reduceTransparency: true, increaseContrast: false)
        XCTAssertEqual(theme.style, .neumorphic)
    }

    func testLiquidGlassDegradesOnIncreasedContrast() {
        let theme = CompanionTheme.resolve(requested: .liquidGlass, glassCapableOS: true, reduceTransparency: false, increaseContrast: true)
        XCTAssertEqual(theme.style, .neumorphic)
    }

    func testLiquidGlassSurvivesOnCapableEnvironment() {
        let theme = CompanionTheme.resolve(requested: .liquidGlass, glassCapableOS: true, reduceTransparency: false, increaseContrast: false)
        XCTAssertEqual(theme.style, .liquidGlass)
        XCTAssertTrue(theme.translucent)
    }

    func testNeumorphicNeverUpgrades() {
        let theme = CompanionTheme.resolve(requested: .neumorphic, glassCapableOS: true, reduceTransparency: false, increaseContrast: false)
        XCTAssertEqual(theme.style, .neumorphic)
        XCTAssertFalse(theme.translucent)
    }
}
