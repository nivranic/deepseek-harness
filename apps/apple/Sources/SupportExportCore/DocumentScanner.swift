import CryptoKit
import Foundation

/// Limits supplied by the carrier for the complete serialized document and one scan.
public struct DocumentScanPolicy: Sendable {
    public let maximumBytes: Int
    public let scanMilliseconds: Int64

    public init(maximumBytes: Int, scanMilliseconds: Int64) throws {
        guard (1...16 * 1024 * 1024).contains(maximumBytes), (1...60000).contains(scanMilliseconds) else {
            throw SupportExportError.invalidPolicy
        }
        self.maximumBytes = maximumBytes
        self.scanMilliseconds = scanMilliseconds
    }
}

/// A native result carries a copy of the admitted bytes and their SHA-256 digest.
public struct DocumentScanResult: Sendable {
    public let status: String
    public let data: Data?
    public let digest: String

    public init(status: String, data: Data?, digest: String) {
        self.status = status
        self.data = data
        self.digest = digest
    }
}

/// One owned operation supports concurrent run and cancellation; cancellation joins all native work.
public protocol DocumentScanOperation: AnyObject, Sendable {
    func run() throws -> DocumentScanResult
    func cancelAndJoin()
}

/// The scanner takes ownership of an input copy before returning its operation.
public protocol DocumentScanner: Sendable {
    func open(_ data: Data, policy: DocumentScanPolicy) throws -> any DocumentScanOperation
}

/// Only the complete, unchanged bytes admitted by the scanner can reach a save operation.
public struct ApprovedSupportDocument: Sendable {
    public let data: Data
    public let digest: String

    fileprivate init(input: Data, result: DocumentScanResult) throws {
        guard result.status == "approved" else {
            switch result.status {
            case "cancelled": throw SupportExportError.cancelled
            case "timed-out": throw SupportExportError.timedOut
            case "invalid-scanner": throw SupportExportError.invalidScanner
            case "secrets-detected": throw SupportExportError.secretsDetected
            default: throw SupportExportError.scanFailed
            }
        }
        guard let data = result.data, data == input, supportDocumentDigest(data) == result.digest else {
            throw SupportExportError.invalidScanner
        }
        self.data = data
        self.digest = result.digest
    }
}

/// Performs opening, scanning and joined cancellation away from the caller's executor.
public struct SupportDocumentExporter: Sendable {
    private let scanner: any DocumentScanner
    private let policy: DocumentScanPolicy

    public init(scanner: any DocumentScanner, policy: DocumentScanPolicy) {
        self.scanner = scanner
        self.policy = policy
    }

    /// Returns only after both run and cancellation have returned, including cancellation before native opening.
    public func prepare(_ data: Data) async throws -> ApprovedSupportDocument {
        do {
            try Task.checkCancellation()
            guard data.count <= policy.maximumBytes else { throw SupportExportError.oversized }
            let joined = JoinedDocumentScan(scanner: scanner, policy: policy, input: data)
            let result = try await withTaskCancellationHandler {
                try await joined.start()
            } onCancel: {
                joined.cancel()
            }
            try Task.checkCancellation()
            return try ApprovedSupportDocument(input: data, result: result)
        } catch is CancellationError {
            throw SupportExportError.cancelled
        } catch let error as SupportExportError {
            throw error
        } catch {
            throw SupportExportError.scanFailed
        }
    }
}

/// Immutable Foundation Data is hashed without exporting scanner diagnostics.
public func supportDocumentDigest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// The lock owns cancellation admission and result publication; the group owns both dispatched operations.
private final class JoinedDocumentScan: @unchecked Sendable {
    private let lock = NSLock()
    private let group = DispatchGroup()
    private let runQueue = DispatchQueue(label: "dsh.support.scan", qos: .utility)
    private let cancelQueue = DispatchQueue(label: "dsh.support.cancel", qos: .utility)
    private let scanner: any DocumentScanner
    private let policy: DocumentScanPolicy
    private let input: Data
    private var operation: (any DocumentScanOperation)?
    private var cancellationRequested = false
    private var cancellationScheduled = false
    private var result: Result<DocumentScanResult, Error>?

    init(scanner: any DocumentScanner, policy: DocumentScanPolicy, input: Data) {
        self.scanner = scanner
        self.policy = policy
        self.input = input
    }

    func start() async throws -> DocumentScanResult {
        try await withCheckedThrowingContinuation { continuation in
            group.enter()
            runQueue.async { [self] in
                let outcome: Result<DocumentScanResult, Error>
                do {
                    let created = try scanner.open(input, policy: policy)
                    lock.lock()
                    operation = created
                    scheduleCancellationIfNeeded()
                    lock.unlock()
                    outcome = .success(try created.run())
                } catch {
                    outcome = .failure(error)
                }
                lock.lock()
                result = outcome
                cancellationRequested = true
                scheduleCancellationIfNeeded()
                lock.unlock()
                group.leave()
            }
            group.notify(queue: runQueue) { [self] in
                lock.lock()
                let outcome = result!
                lock.unlock()
                continuation.resume(with: outcome)
            }
        }
    }

    func cancel() {
        lock.lock()
        cancellationRequested = true
        scheduleCancellationIfNeeded()
        lock.unlock()
    }

    /// Called under the lock while the run still owns the group's initial entry.
    private func scheduleCancellationIfNeeded() {
        guard cancellationRequested, !cancellationScheduled, let operation else { return }
        cancellationScheduled = true
        group.enter()
        cancelQueue.async { [self] in
            operation.cancelAndJoin()
            group.leave()
        }
    }
}
