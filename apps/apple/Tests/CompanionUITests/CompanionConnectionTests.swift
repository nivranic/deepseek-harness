import Foundation
import SharedAppleRemoteCore
import XCTest
@testable import CompanionUI

@MainActor
final class CompanionConnectionTests: XCTestCase {
    func testRetiredAndStoppingOwnersCannotRepublishConnectionState() {
        let observer = CompanionConnectionDiagnostics()
        let first = observer.begin(reconnecting: false)
        observer.attempt(first)
        observer.opened(first)
        let next = observer.begin(reconnecting: false)
        observer.attempt(next)
        observer.interrupted(first, error: LinkClientError.refused(code: "private-code", message: "private-message"))
        observer.opened(first)
        observer.finished(first)
        XCTAssertEqual(observer.snapshot.state, .opening)
        XCTAssertEqual(observer.snapshot.interruptions, 0)
        XCTAssertEqual(observer.snapshot.attempts, 2)
        observer.stop()
        observer.opened(next)
        observer.retrying(next)
        observer.attempt(next)
        XCTAssertEqual(observer.snapshot.state, .stopping)
        XCTAssertEqual(observer.snapshot.attempts, 2)
        observer.finished(next)
        XCTAssertEqual(observer.snapshot.state, .stopped)
        XCTAssertNil(observer.snapshot.lastFailure)
    }

    func testSessionOpeningRecoveryAndCloseFollowTheActualSubscription() async {
        let wire = ConnectionWire(blocked: [0, 1])
        let model = RemoteSessionViewModel(wire: wire)
        XCTAssertEqual(model.connectionSnapshot.state, .idle)
        await model.open(sessionId: "private-session")
        await observe { await wire.calls == 1 }
        XCTAssertEqual(model.connectionSnapshot.state, .opening)
        await wire.release(0)
        await observe { model.connectionSnapshot.state == .open }
        await wire.fail(0, LinkClientError.refused(code: "private-code", message: "private-message"))
        await observe { await wire.calls == 2 }
        XCTAssertEqual(model.connectionSnapshot.state, .reconnecting)
        XCTAssertEqual(model.connectionSnapshot.lastFailure, .refused)
        XCTAssertEqual(model.connectionSnapshot.interruptions, 1)
        XCTAssertEqual(model.connectionSnapshot.attempts, 2)
        await wire.release(1)
        await observe { model.connectionSnapshot.state == .open }
        XCTAssertNil(model.connectionSnapshot.lastFailure)
        model.close()
        await observe { model.connectionSnapshot.state == .stopped }
        let calls = await wire.calls
        XCTAssertEqual(calls, 2)
    }

    func testInteractionStopDuringRecoveryRetainsStoppingUntilOpeningReturns() async {
        let wire = ConnectionWire(blocked: [1])
        let model = InteractionViewModel(wire: wire)
        await model.startWatching()
        await observe { model.connectionSnapshot.state == .open }
        await wire.fail(0, LinkClientError.badWire("private-wire-payload"))
        await observe { await wire.calls == 2 }
        XCTAssertEqual(model.connectionSnapshot.state, .reconnecting)
        XCTAssertEqual(model.connectionSnapshot.lastFailure, .invalidResponse)
        model.stopWatching()
        XCTAssertEqual(model.connectionSnapshot.state, .stopping)
        await wire.release(1)
        await observe { model.connectionSnapshot.state == .stopped }
        XCTAssertNil(model.connectionSnapshot.lastFailure)
    }

    func testWorkspaceReplacementRejectsTheOldRecoveryAndKeepsTheNewObservation() async {
        let wire = ConnectionWire(blocked: [1, 2])
        let model = FilesViewModel(wire: wire)
        await model.start()
        await observe { model.connectionSnapshot.state == .open }
        await wire.fail(0, URLError(.networkConnectionLost))
        await observe { await wire.calls == 2 }
        XCTAssertEqual(model.connectionSnapshot.state, .reconnecting)
        await model.start()
        await observe { await wire.calls == 3 }
        await wire.release(2)
        await observe { model.connectionSnapshot.state == .open }
        await wire.release(1)
        // Waiting past the registry retry delay catches a retired task scheduling another subscription.
        try? await Task.sleep(for: .milliseconds(1200))
        let calls = await wire.calls
        XCTAssertEqual(calls, 3)
        XCTAssertEqual(model.connectionSnapshot.state, .open)
        XCTAssertEqual(model.connectionSnapshot.attempts, 3)
        XCTAssertEqual(model.connectionSnapshot.interruptions, 1)
        model.stop()
        await observe { model.connectionSnapshot.state == .stopped }
    }

    func testPushLossIsEndedWithoutInventingAReconnectAndStopJoinsObservation() async {
        let wire = ConnectionWire(blocked: [0])
        let model = PushViewModel(wire: wire)
        await model.startWatching()
        await observe { await wire.calls == 1 }
        XCTAssertEqual(model.connectionSnapshot.state, .opening)
        model.stopWatching()
        XCTAssertEqual(model.connectionSnapshot.state, .stopping)
        await wire.release(0)
        await observe { model.connectionSnapshot.state == .stopped }
        await model.startWatching()
        await observe { model.connectionSnapshot.state == .open }
        await wire.fail(1, LinkClientError.unpaired)
        await observe { model.connectionSnapshot.state == .ended }
        XCTAssertEqual(model.connectionSnapshot.lastFailure, .unpaired)
        XCTAssertEqual(model.connectionSnapshot.interruptions, 1)
        let calls = await wire.calls
        XCTAssertEqual(calls, 2)
        model.stopWatching()
        XCTAssertEqual(model.connectionSnapshot.state, .stopped)
    }

    func testFailureProjectionDiscardsMessagesAddressesAndCancellationErrors() throws {
        let observer = CompanionConnectionDiagnostics()
        let examples: [(Error, LinkDiagnosticFailure)] = [
            (CancellationError(), .cancelled), (URLError(.cancelled), .cancelled),
            (LinkClientError.unpaired, .unpaired),
            (LinkClientError.refused(code: "private-code", message: "private-message"), .refused),
            (LinkClientError.carrier(status: 503, message: "https://private.invalid"), .transport),
            (LinkClientError.badWire("private-wire"), .invalidResponse),
            (NSError(domain: "private-domain", code: 1), .transport),
        ]
        for (error, expected) in examples {
            let token = observer.begin(reconnecting: false)
            observer.interrupted(token, error: error)
            XCTAssertEqual(observer.snapshot.lastFailure, expected)
            let text = String(decoding: try JSONEncoder().encode(observer.snapshot), as: UTF8.self)
            XCTAssertFalse(text.contains("private"))
            XCTAssertFalse(text.contains("503"))
        }
    }

    private func observe(_ condition: () async -> Bool) async {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while !(await condition()), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(10))
        }
        let matched = await condition()
        XCTAssertTrue(matched)
    }
}

/// Opening can outlive cancellation, so tests can release a retired request after its replacement.
private actor ConnectionWire: CompanionWireDriving {
    private let blocked: Set<Int>
    private var gates: [Int: CheckedContinuation<Void, Never>] = [:]
    private var streams: [Int: AsyncThrowingStream<WireValue, Error>.Continuation] = [:]
    private(set) var calls = 0

    init(blocked: Set<Int>) { self.blocked = blocked }

    func call(_ method: String, args: [String: WireValue]) async throws -> WireValue { .null }

    func stream(_ endpoint: String, payload: [String: WireValue]) async throws -> AsyncThrowingStream<WireValue, Error> {
        let index = calls
        calls += 1
        let stream = AsyncThrowingStream<WireValue, Error> { continuation in streams[index] = continuation }
        if blocked.contains(index) {
            await withCheckedContinuation { gates[index] = $0 }
        }
        return stream
    }

    func release(_ index: Int) { gates.removeValue(forKey: index)?.resume() }
    func fail(_ index: Int, _ error: Error) { streams[index]?.finish(throwing: error) }
}
