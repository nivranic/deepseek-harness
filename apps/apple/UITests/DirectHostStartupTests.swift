import XCTest

/// Exercises the assembled app with its real bundled runtime on the ephemeral macOS runner.
final class DirectHostStartupTests: XCTestCase {
    @MainActor
    func testInvalidHomeConfigurationDoesNotLaunchTheRuntime() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["DSH_HOME"] = "relative-home"
        defer { app.terminate() }
        app.launch()
        XCTAssertTrue(app.staticTexts["DSH_HOME must be a valid absolute directory path"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["host.runtime.start"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
        try exportSupport(app, state: "failed", failure: "invalidConfiguration")
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
        try exportSupport(app, state: "ready")
        stop.click()
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        XCTAssertFalse(app.webViews.firstMatch.exists)
        XCTAssertTrue(try runtimePids().isEmpty)
        try exportSupport(app, state: "stopped")
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

    /// Saves through the production FileDocument path; only validated, fixed-field JSON becomes an attachment.
    @MainActor
    private func exportSupport(_ app: XCUIApplication, state: String, failure: String? = nil) throws {
        continueAfterFailure = false
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-export-ui-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let button = app.buttons["host.support.export"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        let panel = app.sheets.firstMatch
        let filename = "host-runtime-support-\(state).json"
        chooseExportDestination(app, directory: directory, filename: "cancelled-" + filename)
        let cancel = panel.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.click()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !panel.exists && button.isEnabled
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
        XCTAssertFalse(app.alerts.firstMatch.exists)
        let cancellation = XCTAttachment(screenshot: app.screenshot())
        cancellation.name = "host-runtime-support-cancelled-" + state
        cancellation.lifetime = .keepAlways
        add(cancellation)
        chooseExportDestination(app, directory: directory, filename: filename)
        panel.buttons["OKButton"].click()
        let file = directory.appendingPathComponent(filename)
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            FileManager.default.fileExists(atPath: file.path)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 10), .completed)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [filename])
        let data = try Data(contentsOf: file)
        XCTAssertLessThanOrEqual(data.count, 16384)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(value.keys), Set(["schemaVersion", "platform", "runtimeClass", "complete", "product", "applicationSource", "runtime", "scanner", "uncollected"]))
        XCTAssertEqual(value["complete"] as? Bool, false)
        XCTAssertEqual(value["platform"] as? String, "macos")
        let runtime = try XCTUnwrap(value["runtime"] as? [String: Any])
        XCTAssertEqual(Set(runtime.keys), Set(failure == nil ? ["producer", "observation", "state", "lifecycleCounts", "carrierProbe"] :
            ["producer", "observation", "state", "failure", "lifecycleCounts", "carrierProbe"]))
        XCTAssertEqual(runtime["producer"] as? String, "RuntimeSupervisor")
        XCTAssertEqual(runtime["observation"] as? String, "current")
        let probe = try XCTUnwrap(runtime["carrierProbe"] as? [String: Any])
        XCTAssertEqual(probe["producer"] as? String, "RuntimeSupervisor.carrierProbe")
        if state == "ready" {
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(probe["successes"] as? Int), 1)
            XCTAssertTrue(["checking", "reachable"].contains(try XCTUnwrap(probe["state"] as? String)))
        } else {
            XCTAssertEqual(probe["state"] as? String, "unavailable")
        }
        XCTAssertEqual(runtime["state"] as? String, state)
        XCTAssertEqual(runtime["failure"] as? String, failure)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "host-runtime-support-" + state
        attachment.lifetime = .keepAlways
        add(attachment)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "host-runtime-support-saved-" + state
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    private func chooseExportDestination(_ app: XCUIApplication, directory: URL, filename: String) {
        app.buttons["host.support.export"].click()
        let panel = app.sheets.firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 25), "The scanned export did not open its save dialog")
        let name = panel.textFields.matching(NSPredicate(format: "value BEGINSWITH %@", "dsh-host-runtime-diagnostics")).firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.click()
        name.typeKey("a", modifierFlags: .command)
        name.typeText(filename)
        app.typeKey("g", modifierFlags: [.command, .shift])
        let folder = panel.sheets.firstMatch
        XCTAssertTrue(folder.waitForExistence(timeout: 5))
        let location = folder.comboBoxes.firstMatch.exists ? folder.comboBoxes.firstMatch : folder.textFields.firstMatch
        XCTAssertTrue(location.waitForExistence(timeout: 5))
        location.click()
        location.typeKey("a", modifierFlags: .command)
        location.typeText(directory.path)
        app.typeKey(.return, modifierFlags: [])
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: folder)
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 5), .completed)
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
