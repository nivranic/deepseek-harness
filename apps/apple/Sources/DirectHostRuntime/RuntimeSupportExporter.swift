#if os(macOS)
import CryptoKit
import Darwin
import Foundation
import SupportExportCore

/// Immutable bytes admitted by the bundled scanner; callers cannot construct an unscanned export.
public struct RuntimeSupportExport {
    public let data: Data
    fileprivate init(data: Data) { self.data = data }
}

/// Prepares a local export using only a value snapshot and the application's sealed scanner resources.
@MainActor
public final class RuntimeSupportExporter {
    private let scannerDirectory: URL
    private let supervisor: URL
    private let policy: SupportExportPolicy

    public init(scannerDirectory: URL, supervisor: URL, policy: SupportExportPolicy) {
        self.scannerDirectory = scannerDirectory
        self.supervisor = supervisor
        self.policy = policy
    }

    /// Scan one snapshot before admitting its bytes. Cancellation and timeout await scanner exit and scratch removal.
    /// - Parameters:
    ///   - info: the application's expanded bundle metadata; only product identity fields are selected.
    ///   - snapshot: lifecycle observations captured by the runtime owner before this operation.
    /// - Returns: the exact scanned JSON bytes, after private scratch files have been removed.
    public func prepare(info: [String: Any], snapshot: RuntimeSupportSnapshot) async throws -> RuntimeSupportExport {
        try Task.checkCancellation()
        guard supervisor.isFileURL, FileManager.default.isExecutableFile(atPath: supervisor.path) else {
            throw SupportExportError.unavailable
        }
        let scanner = try verifiedScanner()
        let data = try encodeRuntimeSupport(info: info, snapshot: snapshot, scanner: scanner, maximumBytes: policy.maximumBytes)
        let scratch = try privateDirectory()
        let result: Result<Data, Error>
        do {
            let config = scratch.appendingPathComponent("default-rules.toml")
            try Data("[extend]\nuseDefault = true\n".utf8).write(to: config, options: .withoutOverwriting)
            let ignore = scratch.appendingPathComponent("no-ignore")
            try Data().write(to: ignore, options: .withoutOverwriting)
            let token = "ghp_" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
                + String(UUID().uuidString.prefix(4))
            let canary = Data("GITHUB_TOKEN=\(token) # gitleaks:allow\n".utf8)
            let proof = try await scan(canary, in: scratch, label: "canary")
            guard proof.code == 1, proof.rows.contains(where: { $0["RuleID"] as? String == "github-pat" }),
                  proof.data.range(of: Data(token.utf8)) == nil else { throw SupportExportError.invalidScanner }
            let scanned = try await scan(data, in: scratch, label: "export")
            guard scanned.code == 0, scanned.rows.isEmpty else { throw SupportExportError.secretsDetected }
            try Task.checkCancellation()
            result = .success(data)
        } catch {
            result = .failure(error as? SupportExportError ?? (error is CancellationError ? .cancelled : .scanFailed))
        }
        do { try FileManager.default.removeItem(at: scratch) }
        catch { throw SupportExportError.cleanupFailed }
        return RuntimeSupportExport(data: try result.get())
    }

    private func verifiedScanner() throws -> SupportScannerIdentity {
        guard scannerDirectory.isFileURL else { throw SupportExportError.unavailable }
        do {
            let manifest = try regularFile(scannerDirectory.appendingPathComponent("scanner.json"), maximumBytes: 4096)
            let identity = try JSONDecoder().decode(SupportScannerIdentity.self, from: manifest)
            let digests = [identity.archiveSha256, identity.originalBinarySha256, identity.binarySha256, identity.licenseSha256]
            guard identity.schemaVersion == 1,
                  !identity.version.isEmpty, identity.version.utf8.count <= 32,
                  identity.version.split(separator: ".", omittingEmptySubsequences: false).count == 3,
                  identity.version.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({
                      !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) }
                  }),
                  digests.allSatisfy({ $0.utf8.count == 64 && $0.utf8.allSatisfy {
                      (48...57).contains($0) || (97...102).contains($0)
                  } }) else { throw SupportExportError.invalidScanner }
            let executable = scannerDirectory.appendingPathComponent("gitleaks")
            guard FileManager.default.isExecutableFile(atPath: executable.path),
                  supportDigest(try regularFile(executable)) == identity.binarySha256,
                  supportDigest(try regularFile(scannerDirectory.appendingPathComponent("LICENSE"))) == identity.licenseSha256 else {
                throw SupportExportError.invalidScanner
            }
            return identity
        } catch { throw SupportExportError.invalidScanner }
    }

    private func scan(_ data: Data, in scratch: URL, label: String) async throws
        -> (code: Int32, rows: [[String: Any]], data: Data) {
        try Task.checkCancellation()
        let input = scratch.appendingPathComponent(label, isDirectory: true)
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let payload = input.appendingPathComponent("input.json")
        try data.write(to: payload, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: payload.path)
        let report = scratch.appendingPathComponent(label + "-report.json")
        let process = SupportScannerProcess()
        let code = try await process.run(supervisor, scanner: scannerDirectory.appendingPathComponent("gitleaks"),
                                         directory: scratch, label: label, milliseconds: policy.scanMilliseconds,
                                         shutdownMilliseconds: policy.shutdownMilliseconds)
        let bytes = try regularFile(report, maximumBytes: policy.maximumReportBytes)
        guard let rows = try JSONSerialization.jsonObject(with: bytes) as? [[String: Any]],
              (code == 0 && rows.isEmpty) || (code == 1 && !rows.isEmpty) else { throw SupportExportError.scanFailed }
        return (code, rows, bytes)
    }
}

func supportDigest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func regularFile(_ url: URL, maximumBytes: Int? = nil) throws -> Data {
    let descriptor = Darwin.open(url.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else { throw SupportExportError.scanFailed }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    defer { try? handle.close() }
    var stat = Darwin.stat()
    guard fstat(descriptor, &stat) == 0, stat.st_mode & S_IFMT == S_IFREG,
          stat.st_size >= 0, maximumBytes.map({ stat.st_size <= Int64($0) }) ?? true else { throw SupportExportError.scanFailed }
    let data = try handle.readToEnd() ?? Data()
    guard Int64(data.count) == stat.st_size, maximumBytes.map({ data.count <= $0 }) ?? true else { throw SupportExportError.scanFailed }
    return data
}

private func privateDirectory() throws -> URL {
    var template = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-support-XXXXXX").path.utf8CString
    let directory = template.withUnsafeMutableBufferPointer { pointer -> String? in
        guard let base = pointer.baseAddress, mkdtemp(base) != nil else { return nil }
        return String(cString: base)
    }
    guard let directory else { throw SupportExportError.unavailable }
    return URL(fileURLWithPath: directory, isDirectory: true)
}

/// The parent pipe keeps scanner lifetime with the app; the helper reaps its scanner group before this operation returns.
@MainActor
private final class SupportScannerProcess {
    private let process = Process()
    private let control = Pipe()
    private var continuation: CheckedContinuation<Int32, Error>?
    private var refusal: SupportExportError?
    private var timeout: Task<Void, Never>?

    func run(_ helper: URL, scanner: URL, directory: URL, label: String,
             milliseconds: UInt64, shutdownMilliseconds: UInt64) async throws -> Int32 {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                process.executableURL = helper
                process.arguments = ["--support-scan", scanner.path, directory.path, label,
                                     String((milliseconds + 999) / 1000), String(shutdownMilliseconds)]
                process.currentDirectoryURL = directory
                process.environment = ["HOME": directory.path, "LANG": "C", "LC_ALL": "C"]
                process.standardInput = control
                process.standardOutput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice
                process.terminationHandler = { [weak self] _ in
                    Task { @MainActor in self?.exited() }
                }
                do { try process.run() }
                catch { finish(.failure(SupportExportError.unavailable)); return }
                control.fileHandleForReading.closeFile()
                timeout = Task {
                    do { try await Task.sleep(nanoseconds: milliseconds * 1_000_000) }
                    catch { return }
                    abort(.timedOut)
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.abort(.cancelled) }
        }
    }

    private func abort(_ reason: SupportExportError) {
        guard continuation != nil else { return }
        if refusal == nil { refusal = reason }
        try? control.fileHandleForWriting.close()
    }

    private func exited() {
        if let refusal { finish(.failure(refusal)) }
        else if process.terminationReason != .exit { finish(.failure(SupportExportError.scanFailed)) }
        else { finish(.success(process.terminationStatus)) }
    }

    private func finish(_ result: Result<Int32, Error>) {
        let pending = continuation
        continuation = nil
        timeout?.cancel()
        timeout = nil
        process.terminationHandler = nil
        try? control.fileHandleForWriting.close()
        try? control.fileHandleForReading.close()
        pending?.resume(with: result)
    }
}
#endif
