#if os(macOS)
import Darwin
import Foundation
import XCTest
@testable import DirectHostRuntime

@MainActor
final class RuntimeSupervisorTests: XCTestCase {
    private func makeRuntime(_ behavior: String = "serve") throws -> (RuntimeSupervisor, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("fixture-dsh")
        let code = """
        #!/usr/bin/env node
        const fs = require('node:fs');
        const http = require('node:http');
        const path = require('node:path');
        if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['--profile','web','--no-open','--host','127.0.0.1','--port','0'])) process.exit(42);
        fs.appendFileSync(path.join(process.env.DSH_HOME, 'starts'), process.pid + '\\n');
        process.stderr.write('PRIVATE_RUNTIME_OUTPUT_FIXTURE\\n');
        const mode = '\(behavior)';
        if (mode === 'exit') process.exit(7);
        if (mode === 'silent') { process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000); }
        else {
          const server = http.createServer((request, response) => {
            response.writeHead(mode === 'unhealthy' ? 503 : 200, { 'Content-Type': 'text/html' });
            response.end('<html><script>window.__DSH_BOOT__={}</script></html>');
          }).listen(0, '127.0.0.1', () => console.log('dsh web: http://127.0.0.1:' + server.address().port + '/?token=fixture-token'));
          process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); process.exit(0); });
        }
        """
        try code.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let apple = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let helper = apple.appendingPathComponent(".build/debug/HostRuntimeSupervisor")
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: helper.path), "Build HostRuntimeSupervisor before running lifecycle tests")
        let policy = try RuntimePolicy(startupMilliseconds: behavior == "silent" ? 250 : 8000,
                                       healthMilliseconds: 100, requestMilliseconds: 1000, shutdownMilliseconds: 1000)
        let runtime = RuntimeSupervisor(executable: executable, helper: helper,
                                        home: root.appendingPathComponent("home"), policy: policy)
        addTeardownBlock { await runtime.stop() }
        return (runtime, root)
    }

    private func waitUntil(_ predicate: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(10)
        while !predicate() {
            guard Date() < deadline else { XCTFail("runtime state did not settle"); throw RuntimeFailure.startupTimeout }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    private func pids(_ root: URL) throws -> [pid_t] {
        try String(contentsOf: root.appendingPathComponent("home/starts"), encoding: .utf8)
            .split(separator: "\n").map { try XCTUnwrap(pid_t($0)) }
    }

    func testStartIsIdempotentAndRestartWaitsForTheOldRuntime() async throws {
        let (runtime, root) = try makeRuntime()
        runtime.start()
        try await waitUntil { runtime.status == .ready }
        let first = runtime.activationID
        runtime.start()
        XCTAssertEqual(runtime.activationID, first)
        XCTAssertEqual(try pids(root).count, 1)
        await runtime.restart()
        try await waitUntil { runtime.status == .ready }
        XCTAssertNotEqual(runtime.activationID, first)
        let processes = try pids(root)
        XCTAssertEqual(processes.count, 2)
        XCTAssertEqual(kill(processes[0], 0), -1)
        await runtime.stop()
        XCTAssertEqual(runtime.status, .stopped)
        XCTAssertNil(runtime.launchURL)
        XCTAssertEqual(kill(processes[1], 0), -1)
    }

    func testStartupTimeoutStopsTheUnreadyRuntime() async throws {
        let (runtime, root) = try makeRuntime("silent")
        runtime.start()
        try await waitUntil { runtime.status == .failed(.startupTimeout) }
        await runtime.stop()
        XCTAssertNil(runtime.launchURL)
        // Cancellation can win before the fixture executable creates its startup marker.
        if FileManager.default.fileExists(atPath: root.appendingPathComponent("home/starts").path) {
            for pid in try pids(root) { XCTAssertEqual(kill(pid, 0), -1) }
        }
    }

    func testFailedHealthDoesNotPublishReadyAndReapsTheRuntime() async throws {
        let (runtime, root) = try makeRuntime("unhealthy")
        runtime.start()
        try await waitUntil { runtime.status == .failed(.healthFailed) }
        XCTAssertNil(runtime.launchURL)
        for pid in try pids(root) { XCTAssertEqual(kill(pid, 0), -1) }
    }

    func testStoppingDuringStartupCannotPublishALateReadyURL() async throws {
        let (runtime, _) = try makeRuntime()
        runtime.start()
        await runtime.stop()
        XCTAssertEqual(runtime.status, .stopped)
        XCTAssertNil(runtime.launchURL)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(runtime.status, .stopped)
    }

    func testUnexpectedRuntimeDeathClosesTheCarrier() async throws {
        let (runtime, root) = try makeRuntime()
        runtime.start()
        try await waitUntil { runtime.status == .ready }
        XCTAssertEqual(kill(try XCTUnwrap(pids(root).first), SIGKILL), 0)
        try await waitUntil { if case .failed = runtime.status { return true }; return false }
        XCTAssertNil(runtime.launchURL)
    }
}
#endif
