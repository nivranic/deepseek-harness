#if os(macOS)
import Darwin
import Foundation
import SupportExportCore
import XCTest
@testable import DirectHostRuntime

@MainActor
final class RuntimeSupportTests: XCTestCase {
    private let info: [String: Any] = ["DSHProductVersion": "0.1.2-alpha.1", "DSHBuildNumber": "1", "DSHDistributionChannel": "dev"]
    private var scanner: SupportScannerIdentity {
        SupportScannerIdentity(schemaVersion: 1, version: "8.30.1", archiveSha256: String(repeating: "a", count: 64),
                               originalBinarySha256: String(repeating: "b", count: 64), binarySha256: String(repeating: "b", count: 64),
                               licenseSha256: String(repeating: "c", count: 64))
    }

    func testSnapshotsSelectOnlyProductAndLifecycleFields() throws {
        let fixtures = try XCTUnwrap(Bundle.module.url(forResource: "runtime-support", withExtension: "json", subdirectory: "Fixtures"))
        let expected = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtures)) as? [String: Any])
        let cases: [(String, [RuntimeStatus], RuntimeStatus)] = [
            ("stopped", [], .stopped), ("ready", [.starting, .ready], .ready),
            ("failed", [.starting, .failed(.healthFailed)], .failed(.healthFailed)),
        ]
        for (name, transitions, state) in cases {
            var counts = SupportRuntimeCounts()
            transitions.forEach { counts.record($0) }
            let snapshot = RuntimeSupportSnapshot(status: state, counts: counts)
            var poisoned = info
            poisoned["HOME"] = "/Users/PRIVATE_PATH_CANARY"
            poisoned["credentials"] = ["token": "PRIVATE_TOKEN_CANARY"]
            poisoned["runtimeOutput"] = "PRIVATE_OUTPUT_CANARY"
            let bytes = try encodeRuntimeSupport(info: poisoned, snapshot: snapshot, scanner: scanner, maximumBytes: 16384)
            let output = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            let wanted = try XCTUnwrap(expected[name] as? [String: Any])
            XCTAssertTrue(NSDictionary(dictionary: output).isEqual(to: wanted), name)
            XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("PRIVATE_"))
            counts.record(.stopped)
            XCTAssertEqual(try encodeRuntimeSupport(info: info, snapshot: snapshot, scanner: scanner, maximumBytes: bytes.count), bytes)
            XCTAssertThrowsError(try encodeRuntimeSupport(info: info, snapshot: snapshot, scanner: scanner, maximumBytes: bytes.count - 1)) {
                XCTAssertEqual($0 as? SupportExportError, .oversized)
            }
        }
    }

    func testIdentityRefusesMalformedMetadataAndIncompatibleChannels() throws {
        for version in ["", "01.2.3", "1.2", "1.2.65536", "1.2.3\n", "1.2.3-", "1.2.3-a..b", "1.2.3-00", "1.2.3+meta", "版本1.2.3"] {
            var value = info
            value["DSHProductVersion"] = version
            XCTAssertThrowsError(try SupportProductIdentity(info: value))
        }
        let builds: [Any] = [0, 1, "0", "01", "65536", "1\n"]
        for build in builds {
            var value = info
            value["DSHBuildNumber"] = build
            XCTAssertThrowsError(try SupportProductIdentity(info: value))
        }
        for (version, channel) in [("1.2.3-beta.1", "stable"), ("1.2.3", "canary"), ("1.2.3-alpha", "beta"), ("1.2.3", "unknown")] {
            var value = info
            value["DSHProductVersion"] = version
            value["DSHDistributionChannel"] = channel
            XCTAssertThrowsError(try SupportProductIdentity(info: value))
        }
        XCTAssertThrowsError(try SupportProductIdentity(info: [:]))
        XCTAssertThrowsError(try SupportExportPolicy(maximumBytes: 0, maximumReportBytes: 1, scanMilliseconds: 1, shutdownMilliseconds: 1))
        XCTAssertThrowsError(try SupportExportPolicy(maximumBytes: 1, maximumReportBytes: 0, scanMilliseconds: 1, shutdownMilliseconds: 1))
        XCTAssertThrowsError(try SupportExportPolicy(maximumBytes: 1, maximumReportBytes: 1, scanMilliseconds: 0, shutdownMilliseconds: 1))
        XCTAssertThrowsError(try SupportExportPolicy(maximumBytes: 1, maximumReportBytes: 1, scanMilliseconds: 1, shutdownMilliseconds: 0))
    }

    private func fixture(_ mode: String) throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-support-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        addTeardownBlock { try FileManager.default.removeItem(at: root) }
        let script = #"""
        #!/bin/sh
        printf '%s' "$$" > '\#(root.path)/pid'
        printf '%s' "$PWD" > '\#(root.path)/scratch'
        printf '%s' "$DSH_SUPPORT_PRIVATE_CANARY" > '\#(root.path)/environment'
        printf 'ready' > '\#(root.path)/ready'
        mode='\#(mode)'
        if [ "$mode" = hang ]; then while :; do :; done; fi
        report=
        for arg; do case "$arg" in --report-path=*) report=${arg#--report-path=};; esac; done
        case "$2" in
          */canary)
            if [ "$mode" = bad-canary ]; then printf '[]' > "$report"; exit 0; fi
            if [ "$mode" = leaky-canary ]; then
              IFS= read -r line < "$2/input.json"
              token=${line#GITHUB_TOKEN=}; token=${token%% *}
              printf '[{"RuleID":"github-pat","Secret":"%s"}]' "$token" > "$report"
              exit 1
            fi
            printf '[{"RuleID":"github-pat","Secret":"REDACTED"}]' > "$report"
            exit 1;;
        esac
        case "$mode" in
          missing) exit 0;;
          rejected) printf '[{"RuleID":"github-pat","Secret":"REDACTED"}]' > "$report"; exit 1;;
          disagreement) printf '[]' > "$report"; exit 1;;
          malformed) printf '{}' > "$report"; exit 0;;
          symlink) /bin/ln -s '\#(root.path)/empty.json' "$report"; exit 0;;
          oversized) i=0; while [ "$i" -lt 5000 ]; do printf ' '; i=$((i+1)); done > "$report"; exit 0;;
        esac
        printf '[]' > "$report"
        """#
        let binary = Data((script + "\n").utf8)
        let executable = root.appendingPathComponent("gitleaks")
        try binary.write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let license = Data("MIT fixture".utf8)
        try license.write(to: root.appendingPathComponent("LICENSE"))
        try Data("[]".utf8).write(to: root.appendingPathComponent("empty.json"))
        let identity = SupportScannerIdentity(schemaVersion: 1, version: "8.30.1", archiveSha256: String(repeating: "a", count: 64),
                                              originalBinarySha256: supportDigest(binary), binarySha256: supportDigest(binary),
                                              licenseSha256: supportDigest(license))
        try JSONEncoder().encode(identity).write(to: root.appendingPathComponent("scanner.json"))
        return root
    }

    private func exporter(_ root: URL, milliseconds: UInt64 = 1000) throws -> RuntimeSupportExporter {
        let helper = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(".build/debug/HostRuntimeSupervisor")
        return RuntimeSupportExporter(scannerDirectory: root, supervisor: helper,
                                      policy: try SupportExportPolicy(maximumBytes: 16384, maximumReportBytes: 4096,
                                                                       scanMilliseconds: milliseconds, shutdownMilliseconds: 100))
    }

    private var stopped: RuntimeSupportSnapshot { RuntimeSupportSnapshot(status: .stopped, counts: SupportRuntimeCounts()) }

    private func assertReapedAndCleaned(_ root: URL) throws {
        let pid = try XCTUnwrap(Int32(String(contentsOf: root.appendingPathComponent("pid"), encoding: .utf8)))
        let result = kill(pid, 0)
        let error = errno
        XCTAssertEqual(result, -1)
        XCTAssertEqual(error, ESRCH)
        let scratch = try String(contentsOf: root.appendingPathComponent("scratch"), encoding: .utf8)
        XCTAssertFalse(FileManager.default.fileExists(atPath: scratch))
    }

    func testApprovedBytesAreImmutableAndPrivateScratchIsRemoved() async throws {
        let root = try fixture("clean")
        let old = getenv("DSH_SUPPORT_PRIVATE_CANARY").map { String(cString: $0) }
        setenv("DSH_SUPPORT_PRIVATE_CANARY", "private-environment-fixture", 1)
        defer {
            if let old { setenv("DSH_SUPPORT_PRIVATE_CANARY", old, 1) }
            else { unsetenv("DSH_SUPPORT_PRIVATE_CANARY") }
        }
        let approved = try await exporter(root).prepare(info: info, snapshot: stopped)
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("environment"), encoding: .utf8), "")
        let identity = try JSONDecoder().decode(SupportScannerIdentity.self, from: Data(contentsOf: root.appendingPathComponent("scanner.json")))
        XCTAssertEqual(approved.data, try encodeRuntimeSupport(info: info, snapshot: stopped, scanner: identity, maximumBytes: 16384))
        try assertReapedAndCleaned(root)
    }

    func testFailedScansCannotProduceAnExport() async throws {
        let cases: [(String, SupportExportError)] = [("bad-canary", .invalidScanner), ("leaky-canary", .invalidScanner), ("missing", .scanFailed),
                                                    ("rejected", .secretsDetected), ("disagreement", .scanFailed),
                                                    ("malformed", .scanFailed), ("symlink", .scanFailed), ("oversized", .scanFailed)]
        for (mode, refusal) in cases {
            let root = try fixture(mode)
            do {
                _ = try await exporter(root).prepare(info: info, snapshot: stopped)
                XCTFail("invalid scanner produced an export: \(mode)")
            } catch { XCTAssertEqual(error as? SupportExportError, refusal, mode) }
            try assertReapedAndCleaned(root)
        }
    }

    func testChangedExecutableIsRefusedBeforeItStarts() async throws {
        let root = try fixture("clean")
        try Data("changed executable".utf8).write(to: root.appendingPathComponent("gitleaks"))
        do {
            _ = try await exporter(root).prepare(info: info, snapshot: stopped)
            XCTFail("changed executable was accepted")
        } catch { XCTAssertEqual(error as? SupportExportError, .invalidScanner) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("pid").path))
    }

    func testTimeoutAndCancellationReapTheScannerBeforeReturning() async throws {
        for cancel in [false, true] {
            let root = try fixture("hang")
            let scanner = try exporter(root, milliseconds: cancel ? 5000 : 100)
            let task = Task { try await scanner.prepare(info: info, snapshot: stopped) }
            if cancel {
                let deadline = Date().addingTimeInterval(3)
                while !FileManager.default.fileExists(atPath: root.appendingPathComponent("ready").path) {
                    guard Date() < deadline else { task.cancel(); _ = try? await task.value; throw SupportExportError.timedOut }
                    try await Task.sleep(nanoseconds: 10_000_000)
                }
                task.cancel()
            }
            do {
                _ = try await task.value
                XCTFail("unresponsive scanner produced an export")
            } catch { XCTAssertEqual(error as? SupportExportError, cancel ? .cancelled : .timedOut) }
            try assertReapedAndCleaned(root)
        }
    }

    func testRealStagedScannerAdmitsTheSnapshotAndRejectsASecretInMetadata() async throws {
        guard let directory = ProcessInfo.processInfo.environment["DSH_SUPPORT_SCANNER_DIRECTORY"] else {
            throw XCTSkip("the native candidate lane stages the pinned scanner")
        }
        let scanner = try exporter(URL(fileURLWithPath: directory), milliseconds: 10000)
        let approved = try await scanner.prepare(info: info, snapshot: stopped)
        XCTAssertFalse(approved.data.isEmpty)
        var poisoned = info
        poisoned["DSHProductVersion"] = "0.1.2-" + "AKIA" + "BCDEFGHIJKLMNOPQ"
        do {
            _ = try await scanner.prepare(info: poisoned, snapshot: stopped)
            XCTFail("scanner accepted a synthetic credential in otherwise valid metadata")
        } catch { XCTAssertEqual(error as? SupportExportError, .secretsDetected) }
    }
}
#endif
