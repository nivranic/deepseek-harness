import Foundation
import XCTest
@testable import SharedAppleRemoteCore

final class LinkDiagnosticsTests: XCTestCase {
    private func description() throws -> LinkHostDescription {
        let path = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/host-description.json")
        return try JSONDecoder().decode(LinkHostDescription.self, from: Data(contentsOf: path))
    }

    func testSnapshotDoesNotLoadCredentialsAndUnpairClearsLastKnownRole() throws {
        let store = CountingCredentials()
        store.value = LinkCredentials(deviceId: "private-device", hostId: "private-host", hostName: "private-name",
            role: "controller", endpoint: "https://example.invalid", pinnedFingerprint: String(repeating: "0", count: 64),
            signingKeyBase64: "private-signing-key")
        let client = try XCTUnwrap(LinkClient.restore(store: store))
        XCTAssertEqual(store.loads, 1)
        XCTAssertEqual(client.supportSnapshot().lastKnownRole, "controller")
        let bytes = try JSONEncoder().encode(client.supportSnapshot())
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("private-"))
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("example.invalid"))
        XCTAssertEqual(store.loads, 1)
        client.unpair()
        XCTAssertNil(client.supportSnapshot().lastKnownRole)
        XCTAssertEqual(client.supportSnapshot().descriptionState, .unavailable)
        XCTAssertEqual(store.loads, 1)
    }

    func testUnpairedRequestAndDescriptionFailuresComeFromTheClientOwner() async throws {
        let store = CountingCredentials()
        let client = LinkClient(baseURL: URL(string: "https://example.invalid")!,
                                pinnedFingerprint: String(repeating: "0", count: 64), store: store)
        do {
            _ = try await client.describe()
            XCTFail("unpaired request was sent")
        } catch { XCTAssertEqual(error as? LinkClientError, .unpaired) }
        let snapshot = client.supportSnapshot()
        XCTAssertEqual(snapshot.startedRequests, 1)
        XCTAssertEqual(snapshot.finishedRequests, 1)
        XCTAssertEqual(snapshot.activeRequests, 0)
        XCTAssertEqual(snapshot.descriptionState, .failed)
        XCTAssertEqual(snapshot.descriptionFailure, .unpaired)
        XCTAssertNil(snapshot.description)
        XCTAssertEqual(snapshot.failures.map(\.category), [.unpaired])
        XCTAssertEqual(snapshot.failures.map(\.count), [1])
        XCTAssertEqual(store.loads, 1)
    }

    @MainActor
    func testAlreadyCancelledDescriptionDoesNotReadCredentialsOrPublishHostMetadata() async {
        let store = CountingCredentials()
        let client = LinkClient(baseURL: URL(string: "https://example.invalid")!,
                                pinnedFingerprint: String(repeating: "0", count: 64), store: store)
        let task = Task { try await client.describe() }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("cancelled description was returned")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(store.loads, 0)
        XCTAssertEqual(client.supportSnapshot().descriptionFailure, .cancelled)
        XCTAssertNil(client.supportSnapshot().description)
    }

    func testDescriptionProjectionExcludesHostIdentityAndVersion() throws {
        let observed = LinkDiagnostics()
        observed.pairedRole("controller")
        observed.described(observed.describing(), result: .success(try LinkSupportDescription(description())))
        let snapshot = observed.snapshot()
        XCTAssertEqual(snapshot.description?.sessionFormatVersion, 0)
        XCTAssertEqual(snapshot.description?.sessionPrompt, true)
        XCTAssertEqual(snapshot.description?.approval, false)
        let text = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)
        for excluded in ["hostId", "hostName", "hostVersion", "Studio Desk", "0.1.2-alpha.1"] {
            XCTAssertFalse(text.contains(excluded), excluded)
        }
    }

    func testLateDescriptionsCannotReplaceLatestObservationOrSurviveUnpair() throws {
        let observed = LinkDiagnostics()
        observed.pairedRole("controller")
        let old = observed.describing()
        let latest = observed.describing()
        let value = try LinkSupportDescription(description())
        observed.described(latest, result: .success(value))
        observed.described(old, result: .failure(.transport))
        XCTAssertEqual(observed.snapshot().descriptionState, .observed)
        XCTAssertNil(observed.snapshot().descriptionFailure)
        observed.pairedRole(nil)
        observed.described(latest, result: .success(value))
        XCTAssertNil(observed.snapshot().description)
        XCTAssertNil(observed.snapshot().lastKnownRole)
        XCTAssertEqual(observed.snapshot().descriptionState, .unavailable)
    }

    func testFailedRefreshClearsHostDescription() throws {
        let observed = LinkDiagnostics()
        observed.described(observed.describing(), result: .success(try LinkSupportDescription(description())))
        observed.described(observed.describing(), result: .failure(.refused))
        XCTAssertEqual(observed.snapshot().descriptionState, .failed)
        XCTAssertEqual(observed.snapshot().descriptionFailure, .refused)
        XCTAssertNil(observed.snapshot().description)
    }

    func testConcurrentOwnerCountsStayBalanced() {
        let observed = LinkDiagnostics()
        DispatchQueue.concurrentPerform(iterations: 128) { _ in
            observed.requestStarted()
            observed.streamStarted()
            observed.requestFinished(.transport)
            observed.streamFinished(nil)
        }
        let snapshot = observed.snapshot()
        XCTAssertEqual(snapshot.startedRequests, 128)
        XCTAssertEqual(snapshot.finishedRequests, 128)
        XCTAssertEqual(snapshot.activeRequests, 0)
        XCTAssertEqual(snapshot.startedStreams, 128)
        XCTAssertEqual(snapshot.finishedStreams, 128)
        XCTAssertEqual(snapshot.activeStreams, 0)
        XCTAssertEqual(snapshot.failures.first?.count, 128)
        XCTAssertFalse(snapshot.countsSaturated)
    }

    func testUnknownRoleAndInvalidProtocolNumbersNeverReachProjection() throws {
        let observed = LinkDiagnostics()
        observed.pairedRole("private-role")
        XCTAssertNil(observed.snapshot().lastKnownRole)
        let source = try JSONEncoder().encode(description())
        for (field, replacement) in [("linkProtocolVersion", -1 as Any), ("contractVersion", 1.5 as Any),
                                     ("sessionFormatVersion", Double(Int32.max) + 1 as Any), ("runtimeClass", "private-class" as Any)] {
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: source) as? [String: Any])
            object[field] = replacement
            let parsed = try JSONDecoder().decode(LinkHostDescription.self, from: JSONSerialization.data(withJSONObject: object))
            XCTAssertThrowsError(try LinkSupportDescription(parsed))
        }
    }
}

/// Only the test's owner calls this store; reads count any accidental export-time access.
private final class CountingCredentials: LinkCredentialsStoring {
    var value: LinkCredentials?
    var loads = 0
    func load() -> LinkCredentials? { loads += 1; return value }
    func save(_ credentials: LinkCredentials) { value = credentials }
    func clear() { value = nil }
}
