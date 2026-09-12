import Foundation
import SharedAppleRemoteCore
import SupportExportCore
import XCTest
@testable import CompanionUI

final class CompanionSupportTests: XCTestCase {
    private func exporter(_ scanner: RecordingScanner, maximumBytes: Int = 16384,
                          sourceInfo: [String: Any] = ["DSHApplicationSourceSHA": String(repeating: "a", count: 40),
                                                       "DSHApplicationSourceTree": String(repeating: "b", count: 40)]) throws -> CompanionSupportExporter {
        let identity: [String: Any] = ["schemaVersion": 1, "sourceSha": String(repeating: "a", count: 40),
            "treeSha": String(repeating: "b", count: 40), "archiveSha256": String(repeating: "c", count: 64),
            "scannerVersion": "8.30.1", "rulesDigest": String(repeating: "d", count: 64)]
        return CompanionSupportExporter(product: try SupportProductIdentity(info: ["DSHProductVersion": "1.2.3",
            "DSHBuildNumber": "1", "DSHDistributionChannel": "dev", "privateMetadata": "ignored"]),
            applicationSource: try SupportApplicationSource(info: sourceInfo),
            identity: try SupportLibraryIdentity(data: JSONSerialization.data(withJSONObject: identity),
                linkedVersion: "8.30.1", linkedRulesDigest: String(repeating: "d", count: 64)),
            scanner: scanner, policy: try DocumentScanPolicy(maximumBytes: maximumBytes, scanMilliseconds: 10000))
    }

    func testUnpairedDocumentMatchesOwnedOutputAndScansAllBytesOffMainThread() async throws {
        let scanner = RecordingScanner()
        let approved = try await exporter(scanner).prepare(link: nil, connections: .unavailable)
        let expected = try Data(contentsOf: Bundle.module.url(forResource: "support-unpaired", withExtension: "json", subdirectory: "Fixtures")!)
        XCTAssertEqual(approved.data, expected)
        XCTAssertEqual(scanner.input, expected)
        XCTAssertEqual(approved.digest, supportDocumentDigest(expected))
        XCTAssertFalse(scanner.openedOnMain)
    }

    func testApplicationSourceIsCapturedIndependentlyOfScannerProvenance() async throws {
        let source = String(repeating: "e", count: 40), tree = String(repeating: "f", count: 40)
        let approved = try await exporter(RecordingScanner(), sourceInfo: [
            "DSHApplicationSourceSHA": source, "DSHApplicationSourceTree": tree,
        ]).prepare(link: nil, connections: .unavailable)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: approved.data) as? [String: Any])
        let application = try XCTUnwrap(value["applicationSource"] as? [String: String])
        XCTAssertEqual(application["sourceSha"], source)
        XCTAssertEqual(application["treeSha"], tree)
        XCTAssertFalse(try XCTUnwrap(value["uncollected"] as? [String]).contains("application-source"))
        let scanner = try XCTUnwrap(value["scanner"] as? [String: Any])
        XCTAssertEqual(scanner["sourceSha"] as? String, String(repeating: "a", count: 40))
    }

    func testUnstampedApplicationDoesNotBorrowTheScannerSource() async throws {
        let approved = try await exporter(RecordingScanner(), sourceInfo: [:]).prepare(link: nil, connections: .unavailable)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: approved.data) as? [String: Any])
        XCTAssertNil(value["applicationSource"])
        XCTAssertTrue(try XCTUnwrap(value["uncollected"] as? [String]).contains("application-source"))
        XCTAssertEqual(value["complete"] as? Bool, false)
    }

    func testLastKnownLinkProjectionDoesNotReadCredentialsOrExportPrivateIdentity() async throws {
        let store = SupportCredentials()
        let client = try XCTUnwrap(LinkClient.restore(store: store))
        XCTAssertEqual(store.loads, 1)
        let approved = try await exporter(RecordingScanner()).prepare(link: client.supportSnapshot(), connections: .unavailable)
        XCTAssertEqual(store.loads, 1)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: approved.data) as? [String: Any])
        let link = try XCTUnwrap(value["link"] as? [String: Any])
        let snapshot = try XCTUnwrap(link["snapshot"] as? [String: Any])
        XCTAssertEqual(link["state"] as? String, "observed")
        XCTAssertEqual(link["roleFreshness"] as? String, "last-known")
        XCTAssertEqual(snapshot["lastKnownRole"] as? String, "controller")
        XCTAssertEqual(snapshot["descriptionState"] as? String, "unavailable")
        XCTAssertEqual(snapshot["startedRequests"] as? Int, 0)
        XCTAssertEqual(value["complete"] as? Bool, false)
        let text = String(decoding: approved.data, as: UTF8.self)
        for forbidden in ["private-device", "private-host", "private-name", "example.invalid", "private-signing-key"] {
            XCTAssertFalse(text.contains(forbidden))
        }
    }

    func testWholeDocumentLimitRefusesBeforeNativeOpening() async throws {
        let scanner = RecordingScanner()
        do {
            _ = try await exporter(scanner, maximumBytes: 64).prepare(link: nil, connections: .unavailable)
            XCTFail("oversized complete document was admitted")
        } catch { XCTAssertEqual(error as? SupportExportError, .oversized) }
        XCTAssertNil(scanner.input)
    }

    @MainActor
    func testAllConnectionOwnersAreCapturedBeforeScanningWithoutFurtherRequests() async throws {
        let wire = FakeWire()
        let sessions = RemoteSessionViewModel(wire: wire)
        let interactions = InteractionViewModel(wire: wire)
        let files = FilesViewModel(wire: wire)
        let pushes = PushViewModel(wire: wire)
        await sessions.open(sessionId: "private-session-id")
        await interactions.startWatching()
        await files.start()
        await pushes.startWatching()
        await waitUntil {
            [sessions.connectionSnapshot, interactions.connectionSnapshot, files.connectionSnapshot, pushes.connectionSnapshot]
                .allSatisfy { $0.state == .open }
        }
        let captured = CompanionConnectionSnapshots(session: sessions.connectionSnapshot,
            interactions: interactions.connectionSnapshot, workspaces: files.connectionSnapshot, pushes: pushes.connectionSnapshot)
        sessions.close()
        interactions.stopWatching()
        files.stop()
        pushes.stopWatching()
        await waitUntil {
            [sessions.connectionSnapshot, interactions.connectionSnapshot, files.connectionSnapshot, pushes.connectionSnapshot]
                .allSatisfy { $0.state == .stopped }
        }
        let scanner = RecordingScanner()
        let approved = try await exporter(scanner).prepare(link: nil, connections: captured)
        let expected = try Data(contentsOf: Bundle.module.url(forResource: "support-connections", withExtension: "json", subdirectory: "Fixtures")!)
        XCTAssertEqual(approved.data, expected)
        XCTAssertEqual(scanner.input, expected)
        let requests = await wire.streamCalls
        XCTAssertEqual(requests.count, 4)
        XCTAssertFalse(String(decoding: approved.data, as: UTF8.self).contains("private-session-id"))
    }

    @MainActor
    func testSaveCancellationAllowsAnotherExportAndScannerRefusalNeverOpensSave() async throws {
        let scanner = RecordingScanner()
        let producer = try exporter(scanner)
        let model = CompanionSupportModel { producer }
        model.prepare(link: nil, connections: .unavailable)
        await waitUntil { !model.isPreparing }
        XCTAssertTrue(model.exporting)
        XCTAssertEqual(model.document?.approved.data, scanner.input)
        model.dismissExport()
        XCTAssertFalse(model.failed)
        XCTAssertFalse(model.exporting)
        XCTAssertNil(model.document)
        model.prepare(link: nil, connections: .unavailable)
        await waitUntil { !model.isPreparing }
        XCTAssertTrue(model.exporting)
        XCTAssertEqual(model.document?.approved.data, scanner.input)
        model.finishedSaving(.failure(CocoaError(.fileWriteNoPermission)))
        XCTAssertTrue(model.failed)
        XCTAssertFalse(model.exporting)
        XCTAssertNil(model.document)

        let refused = try exporter(RecordingScanner(status: "secrets-detected"))
        let failure = CompanionSupportModel { refused }
        failure.prepare(link: nil, connections: .unavailable)
        await waitUntil { !failure.isPreparing }
        XCTAssertTrue(failure.failed)
        XCTAssertFalse(failure.exporting)
        XCTAssertNil(failure.document)
        await model.shutdown()
        await failure.shutdown()
    }

    @MainActor
    func testCancellationJoinsActivePreparationWithoutPublishingOrShowingFailure() async throws {
        let scanner = RecordingScanner(blocked: true)
        let producer = try exporter(scanner)
        let model = CompanionSupportModel { producer }
        model.prepare(link: nil, connections: .unavailable)
        await waitUntil { scanner.running }
        model.cancel()
        await model.shutdown()
        XCTAssertFalse(model.isPreparing)
        XCTAssertFalse(model.exporting)
        XCTAssertFalse(model.failed)
        XCTAssertNil(model.document)
    }

    @MainActor
    private func waitUntil(_ condition: () -> Bool) async {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while !condition(), ContinuousClock.now < deadline { await Task.yield() }
        XCTAssertTrue(condition())
    }
}

private final class SupportCredentials: LinkCredentialsStoring {
    var loads = 0
    func load() -> LinkCredentials? {
        loads += 1
        return LinkCredentials(deviceId: "private-device", hostId: "private-host", hostName: "private-name", role: "controller",
            endpoint: "https://example.invalid", pinnedFingerprint: String(repeating: "0", count: 64), signingKeyBase64: "private-signing-key")
    }
    func save(_ credentials: LinkCredentials) {}
    func clear() {}
}

/// The fake scanner tests document preparation and UI ownership; native rule acceptance is exercised in the application lane.
private final class RecordingScanner: DocumentScanner, @unchecked Sendable {
    private let lock = NSLock()
    private var bytes: Data?
    private var onMain = false
    private var executing = false
    private let status: String
    private let blocked: Bool
    var input: Data? { lock.withLock { bytes } }
    var openedOnMain: Bool { lock.withLock { onMain } }
    var running: Bool { lock.withLock { executing } }

    init(status: String = "approved", blocked: Bool = false) { self.status = status; self.blocked = blocked }

    func open(_ data: Data, policy: DocumentScanPolicy) throws -> any DocumentScanOperation {
        lock.withLock { bytes = data; onMain = Thread.isMainThread }
        return Operation(data: data, status: status, blocked: blocked) { [self] in lock.withLock { executing = true } }
    }

    private final class Operation: DocumentScanOperation, @unchecked Sendable {
        let data: Data
        let status: String
        let blocked: Bool
        let started: @Sendable () -> Void
        let release = DispatchSemaphore(value: 0)
        let done = DispatchSemaphore(value: 0)
        init(data: Data, status: String, blocked: Bool, started: @escaping @Sendable () -> Void) {
            self.data = data; self.status = status; self.blocked = blocked; self.started = started
        }
        func run() -> DocumentScanResult {
            started()
            if blocked { release.wait() }
            defer { done.signal() }
            return DocumentScanResult(status: status, data: status == "approved" ? data : nil,
                                      digest: status == "approved" ? supportDocumentDigest(data) : "")
        }
        func cancelAndJoin() { release.signal(); done.wait() }
    }
}
