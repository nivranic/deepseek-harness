import Foundation
import XCTest
@testable import SupportExportCore

@MainActor
final class DocumentScannerTests: XCTestCase {
    private let data = Data("{\"state\":\"ready\",\"label\":\"诊断\"}\n".utf8)

    private func exporter(_ scanner: ScanFixture, maximumBytes: Int = 4096) throws -> SupportDocumentExporter {
        SupportDocumentExporter(scanner: scanner, policy: try DocumentScanPolicy(maximumBytes: maximumBytes, scanMilliseconds: 1000))
    }

    func testRejectsInvalidCarrierLimits() {
        for (bytes, milliseconds) in [(0, 1000 as Int64), (16 * 1024 * 1024 + 1, 1000), (1, 0), (1, 60001)] {
            XCTAssertThrowsError(try DocumentScanPolicy(maximumBytes: bytes, scanMilliseconds: milliseconds)) {
                XCTAssertEqual($0 as? SupportExportError, .invalidPolicy)
            }
        }
    }

    func testAdmitsExactBytesAfterBackgroundRunAndJoinedCancellation() async throws {
        let scanner = ScanFixture()
        let document = try await exporter(scanner, maximumBytes: data.count).prepare(data)
        XCTAssertEqual(document.data, data)
        XCTAssertEqual(document.digest, supportDocumentDigest(data))
        var copy = document.data
        copy[0] = 0
        XCTAssertEqual(document.data, data)
        let observed = scanner.snapshot()
        XCTAssertTrue(observed.runFinished)
        XCTAssertTrue(observed.cancelFinished)
        XCTAssertEqual(observed.cancellations, 1)
        XCTAssertFalse(observed.usedMainThread)
        XCTAssertFalse(observed.timedOut)
    }

    func testEnforcesFullUTF8SizeBeforeOpening() async throws {
        let scanner = ScanFixture()
        do {
            _ = try await exporter(scanner, maximumBytes: data.count - 1).prepare(data)
            XCTFail("oversized document was admitted")
        } catch { XCTAssertEqual(error as? SupportExportError, .oversized) }
        XCTAssertEqual(scanner.snapshot().opens, 0)
    }

    func testMapsNativeRefusalsWithoutExposingPayload() async throws {
        let refusals: [(String, SupportExportError)] = [
            ("secrets-detected", .secretsDetected), ("timed-out", .timedOut),
            ("invalid-scanner", .invalidScanner), ("cancelled", .cancelled),
            ("scan-failed", .scanFailed), ("unrecognized private scanner message", .scanFailed),
        ]
        for (status, refusal) in refusals {
            let scanner = ScanFixture(status: status)
            do {
                _ = try await exporter(scanner).prepare(data)
                XCTFail("scanner refusal was admitted")
            } catch { XCTAssertEqual(error as? SupportExportError, refusal) }
            XCTAssertTrue(scanner.snapshot().cancelFinished)
        }
    }

    func testRejectsChangedMissingOrWronglyHashedApprovedBytes() async throws {
        for corruption in [ScanFixture.Corruption.changed, .missing, .digest] {
            let scanner = ScanFixture(corruption: corruption)
            do {
                _ = try await exporter(scanner).prepare(data)
                XCTFail("invalid admission was accepted")
            } catch { XCTAssertEqual(error as? SupportExportError, .invalidScanner) }
            XCTAssertTrue(scanner.snapshot().cancelFinished)
        }
    }

    func testOpeningAndRunFailuresHaveFixedErrorsAndLeaveNoNativeWork() async throws {
        for failsOpening in [false, true] {
            let scanner = ScanFixture(failsOpening: failsOpening, failsRunning: !failsOpening)
            do {
                _ = try await exporter(scanner).prepare(data)
                XCTFail("failed scan was admitted")
            } catch { XCTAssertEqual(error as? SupportExportError, .scanFailed) }
            XCTAssertEqual(scanner.snapshot().cancellations, failsOpening ? 0 : 1)
            XCTAssertEqual(scanner.snapshot().cancelFinished, !failsOpening)
        }
    }

    func testCancellationBeforeStartingDoesNotOpenNativeScanner() async throws {
        let scanner = ScanFixture()
        let exporter = try exporter(scanner)
        let input = data
        let task = Task { try await exporter.prepare(input) }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("cancelled task was admitted")
        } catch { XCTAssertEqual(error as? SupportExportError, .cancelled) }
        XCTAssertEqual(scanner.snapshot().opens, 0)
    }

    func testCancellationDuringOpeningOrRunJoinsCancellationBeforeReturning() async throws {
        for duringOpening in [false, true] {
            let started = expectation(description: "native work entered")
            let cancelling = expectation(description: "native cancellation entered")
            let returned = expectation(description: "export returned before cancellation joined")
            returned.isInverted = true
            let scanner = ScanFixture(blockOpening: duringOpening, blockRunning: !duringOpening,
                                      blockCancellation: true, entered: started, cancelling: cancelling)
            defer { scanner.releaseAll() }
            let exporter = try exporter(scanner)
            let input = data
            let task = Task {
                defer { returned.fulfill() }
                return try await exporter.prepare(input)
            }
            await fulfillment(of: [started], timeout: 10)
            task.cancel()
            scanner.releaseOpening()
            await fulfillment(of: [cancelling], timeout: 10)
            await fulfillment(of: [returned], timeout: 0.05)
            returned.isInverted = false
            scanner.releaseCancellation()
            do {
                _ = try await task.value
                XCTFail("cancelled export was admitted")
            } catch { XCTAssertEqual(error as? SupportExportError, .cancelled) }
            XCTAssertTrue(scanner.snapshot().runFinished)
            XCTAssertTrue(scanner.snapshot().cancelFinished)
            XCTAssertEqual(scanner.snapshot().cancellations, 1)
            XCTAssertFalse(scanner.snapshot().usedMainThread)
            XCTAssertFalse(scanner.snapshot().timedOut)
        }
    }
}

/// Semaphores hold real background work; the lock protects every observation read by the test actor.
private final class ScanFixture: DocumentScanner, DocumentScanOperation, @unchecked Sendable {
    enum Corruption { case none, changed, missing, digest }
    private struct FixtureError: Error {}
    struct Snapshot {
        var opens = 0
        var cancellations = 0
        var runFinished = false
        var cancelFinished = false
        var usedMainThread = false
        var timedOut = false
    }
    private let lock = NSLock()
    private var observed = Snapshot()
    private var input = Data()
    private let status: String
    private let corruption: Corruption
    private let failsOpening: Bool
    private let failsRunning: Bool
    private let blockOpening: Bool
    private let blockRunning: Bool
    private let blockCancellation: Bool
    private let entered: XCTestExpectation?
    private let cancelling: XCTestExpectation?
    private let opening = DispatchSemaphore(value: 0)
    private let running = DispatchSemaphore(value: 0)
    private let cancellation = DispatchSemaphore(value: 0)
    private let runReturned = DispatchSemaphore(value: 0)

    init(status: String = "approved", corruption: Corruption = .none, failsOpening: Bool = false,
         failsRunning: Bool = false, blockOpening: Bool = false, blockRunning: Bool = false,
         blockCancellation: Bool = false, entered: XCTestExpectation? = nil, cancelling: XCTestExpectation? = nil) {
        self.status = status; self.corruption = corruption
        self.failsOpening = failsOpening; self.failsRunning = failsRunning
        self.blockOpening = blockOpening; self.blockRunning = blockRunning; self.blockCancellation = blockCancellation
        self.entered = entered; self.cancelling = cancelling
    }

    func open(_ data: Data, policy: DocumentScanPolicy) throws -> any DocumentScanOperation {
        lock.lock()
        observed.opens += 1
        observed.usedMainThread = observed.usedMainThread || Thread.isMainThread
        input = data
        lock.unlock()
        if blockOpening { entered?.fulfill(); wait(opening) }
        if failsOpening { throw FixtureError() }
        return self
    }

    func run() throws -> DocumentScanResult {
        lock.lock()
        observed.usedMainThread = observed.usedMainThread || Thread.isMainThread
        let data = input
        lock.unlock()
        defer {
            lock.lock(); observed.runFinished = true; lock.unlock()
            runReturned.signal()
        }
        if blockRunning { entered?.fulfill(); wait(running) }
        if failsRunning { throw FixtureError() }
        return DocumentScanResult(status: status,
                                  data: corruption == .missing ? nil : corruption == .changed ? Data([0]) : data,
                                  digest: corruption == .digest ? String(repeating: "0", count: 64) : supportDocumentDigest(data))
    }

    func cancelAndJoin() {
        lock.lock()
        observed.cancellations += 1
        observed.usedMainThread = observed.usedMainThread || Thread.isMainThread
        lock.unlock()
        cancelling?.fulfill()
        running.signal()
        wait(runReturned)
        if blockCancellation { wait(cancellation) }
        lock.lock(); observed.cancelFinished = true; lock.unlock()
    }

    func snapshot() -> Snapshot { lock.lock(); defer { lock.unlock() }; return observed }
    func releaseOpening() { opening.signal() }
    func releaseCancellation() { cancellation.signal() }
    func releaseAll() { opening.signal(); running.signal(); cancellation.signal() }

    private func wait(_ semaphore: DispatchSemaphore) {
        if semaphore.wait(timeout: .now() + 15) == .timedOut {
            lock.lock(); observed.timedOut = true; lock.unlock()
        }
    }
}
