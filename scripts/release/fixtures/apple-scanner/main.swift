// Native binding acceptance uses the generated Objective-C API through Swift.
// It emits only fixed test results, never scanner inputs, errors or findings.
import Foundation
import CryptoKit
import Dispatch
import SupportScanner

enum ProbeFailure: Error { case assertion(Int) }
var assertions = 0
func require(_ value: @autoclosure () -> Bool) throws {
    assertions += 1
    if !value() { throw ProbeFailure.assertion(assertions) }
}

final class CompletedScan: @unchecked Sendable {
    private let lock = NSLock()
    private var result: DSHSupportscannerResult?
    func store(_ value: DSHSupportscannerResult?) { lock.lock(); defer { lock.unlock() }; result = value }
    func load() -> DSHSupportscannerResult? { lock.lock(); defer { lock.unlock() }; return result }
}

func exercise() throws {
    try require(DSHSupportscannerVersion == "8.30.1")
    try require(DSHSupportscannerRulesDigest().count == 64)
    let original = Data("{\"schemaVersion\":1,\"status\":\"unavailable\"}\n".utf8)
    let input = NSMutableData(data: original)
    guard let operation = DSHSupportscannerOperation(input as Data, maximumBytes: 16 * 1024 * 1024, scanMilliseconds: 10_000) else {
        throw ProbeFailure.assertion(100)
    }
    input.resetBytes(in: NSRange(location: 0, length: input.length))
    guard let result = operation.run() else { throw ProbeFailure.assertion(101) }
    try require(result.status() == "approved")
    try require(result.data() == original)
    try require(result.bytes() == Int64(original.count))
    let expectedDigest = SHA256.hash(data: original).map { String(format: "%02x", $0) }.joined()
    try require(result.digest() == expectedDigest)
    var copy = result.data()!; copy[0] = 0
    try require(result.data() == original)
    try require(operation.run()?.status() == "already-run")
    operation.cancel()
    try require(result.data() == original)
    try require(DSHSupportscannerOperation(Data(), maximumBytes: 10, scanMilliseconds: 1000) == nil)
    try require(DSHSupportscannerOperation(original, maximumBytes: 1, scanMilliseconds: 1000) == nil)
    try require(DSHSupportscannerOperation(original, maximumBytes: 1000, scanMilliseconds: 0) == nil)

    let entropy = (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "").lowercased()
    let secret = Data(("GITHUB_TOKEN=ghp_" + String(entropy.prefix(36)) + " # gitleaks:allow\n").utf8)
    guard let refused = DSHSupportscannerOperation(secret, maximumBytes: 1024, scanMilliseconds: 10_000)?.run() else {
        throw ProbeFailure.assertion(102)
    }
    try require(refused.status() == "secrets-detected")
    try require(refused.data() == nil)
    try require(refused.bytes() == 0)
    try require(refused.digest().isEmpty)

    guard let cancelled = DSHSupportscannerOperation(original, maximumBytes: 1024, scanMilliseconds: 1000) else {
        throw ProbeFailure.assertion(103)
    }
    cancelled.cancel()
    try require(cancelled.run()?.status() == "cancelled")
    cancelled.cancel()

    let payload = Data(String(repeating: "safe diagnostic observation\n", count: 180_000).utf8)
    guard let pending = DSHSupportscannerOperation(payload, maximumBytes: 16 * 1024 * 1024, scanMilliseconds: 10_000) else {
        throw ProbeFailure.assertion(104)
    }
    let completion = CompletedScan(), group = DispatchGroup(), entered = DispatchSemaphore(value: 0)
    group.enter()
    DispatchQueue.global().async {
        entered.signal()
        completion.store(pending.run())
        group.leave()
    }
    try require(entered.wait(timeout: .now() + 5) == .success)
    pending.cancel()
    try require(group.wait(timeout: .now() + 15) == .success)
    // Cancellation can race a committed result; either outcome must preserve complete byte ownership.
    let raced = completion.load()
    let cancelledBeforeCommit = raced?.status() == "cancelled"
    try require(cancelledBeforeCommit || raced?.status() == "approved")
    if cancelledBeforeCommit {
        try require(raced?.data() == nil && raced?.bytes() == 0 && raced?.digest() == "")
        FileHandle.standardError.write(Data("Concurrent scan cancelled before commit\n".utf8))
    } else {
        let digest = SHA256.hash(data: payload).map { String(format: "%02x", $0) }.joined()
        try require(raced?.data() == payload && raced?.bytes() == Int64(payload.count) && raced?.digest() == digest)
        FileHandle.standardError.write(Data("Concurrent scan committed before cancellation\n".utf8))
    }
    try require(DSHSupportscannerRulesDigest().count == 64)
    try require(DSHSupportscannerOperation(original, maximumBytes: 1024, scanMilliseconds: 10_000)?.run()?.status() == "approved")
}

do {
    try exercise()
    #if os(iOS) && targetEnvironment(simulator)
    let platform = "ios-simulator"
    #elseif os(macOS)
    let platform = "macos"
    #else
    throw ProbeFailure.assertion(105)
    #endif
    #if arch(arm64)
    let architecture = "arm64"
    #else
    let architecture = "x86_64"
    #endif
    let value: [String: Any] = ["schemaVersion": 1, "status": "PASS", "platform": platform,
                                "architecture": architecture, "assertions": assertions,
                                "scannerVersion": DSHSupportscannerVersion, "rulesDigest": DSHSupportscannerRulesDigest()]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
    FileHandle.standardOutput.write(Data([10]))
} catch {
    if case let ProbeFailure.assertion(index) = error {
        FileHandle.standardError.write(Data("Apple scanner native assertion \(index) failed\n".utf8))
    } else {
        FileHandle.standardError.write(Data("Apple scanner native acceptance failed\n".utf8))
    }
    exit(1)
}
