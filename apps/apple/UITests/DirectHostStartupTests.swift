import XCTest

/// Exercises the assembled app with its real bundled runtime on the ephemeral macOS runner.
final class DirectHostStartupTests: XCTestCase {
    @MainActor
    func testInvalidHomeConfigurationDoesNotLaunchTheRuntime() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["DSH_HOME"] = "relative-home"
        defer { app.terminate() }
        app.launch()
        XCTAssertTrue(app.staticTexts["DSH_HOME must be a valid absolute directory path"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["host.runtime.start"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    @MainActor
    func testBundledWebCarrierSurvivesStopStartAndRestart() throws {
        continueAfterFailure = false
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-host-ui-" + UUID().uuidString)
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["DSH_HOME"] = home.path
        defer {
            app.terminate()
            try? FileManager.default.removeItem(at: home)
        }
        app.launch()
        let restart = app.buttons["host.runtime.restart"]
        let stop = app.buttons["host.runtime.stop"]
        let start = app.buttons["host.runtime.start"]
        XCTAssertTrue(restart.waitForExistence(timeout: 60), "Bundled runtime did not become ready")
        prepareWebSurface(app, acknowledgeNotice: true)
        XCTAssertEqual(try runtimePids().count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: home.path))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "bundled-host-ready"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        stop.click()
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        XCTAssertFalse(app.webViews.firstMatch.exists)
        XCTAssertTrue(try runtimePids().isEmpty)
        start.click()
        XCTAssertTrue(restart.waitForExistence(timeout: 60))
        prepareWebSurface(app, acknowledgeNotice: false)
        let previous = try runtimePids()
        XCTAssertEqual(previous.count, 1)
        restart.click()
        let replaced = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            if app.state == .notRunning { return true }
            guard let current = try? self.runtimePids() else { return false }
            return current.count == 1 && current.isDisjoint(with: previous)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [replaced], timeout: 60), .completed)
        XCTAssertNotEqual(app.state, .notRunning, "Host application terminated during restart")
        let restarted = try runtimePids()
        XCTAssertEqual(restarted.count, 1)
        XCTAssertTrue(restarted.isDisjoint(with: previous))
        XCTAssertTrue(stop.waitForExistence(timeout: 60))
        prepareWebSurface(app, acknowledgeNotice: false)
        stop.click()
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        XCTAssertFalse(app.webViews.firstMatch.exists)
        XCTAssertTrue(try runtimePids().isEmpty)
    }

    /// Fresh WebViews use the shipped onboarding controls; the keyless candidate keeps provider setup deferred.
    @MainActor
    private func prepareWebSurface(_ app: XCUIApplication, acknowledgeNotice: Bool) {
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        if acknowledgeNotice {
            let proceed = app.webViews.buttons["Continue"].firstMatch
            XCTAssertTrue(proceed.waitForExistence(timeout: 15), "The first-run notice did not render")
            proceed.click()
        }
        let later = app.webViews.buttons["Configure later"].firstMatch
        XCTAssertTrue(later.waitForExistence(timeout: 15), "The keyless provider setup did not render")
        later.click()
        let newSession = app.webViews.buttons["New session"].firstMatch
        let usable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: newSession)
        XCTAssertEqual(XCTWaiter.wait(for: [usable], timeout: 15), .completed, "Production Web UI is not interactive")
        newSession.click()
    }

    /// ps comm excludes arguments; only PIDs of this assembled application's runtime are retained.
    private func runtimePids() throws -> Set<Int32> {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-axo", "pid=,comm="]
        process.standardOutput = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0, let text = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "HostProcessInspection", code: 1)
        }
        return Set(text.split(separator: "\n").compactMap { line in
            let fields = line.trimmingCharacters(in: .whitespaces).split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
            guard fields.count == 2,
                  fields[1].contains("/DSH Host.app/Contents/Resources/Runtime/"),
                  ["deepseek-harness-sdk-runtime-macos-arm64", "deepseek-harness-sdk-runtime-macos-x64"]
                    .contains(URL(fileURLWithPath: String(fields[1])).lastPathComponent) else { return nil }
            return Int32(fields[0])
        })
    }
}
