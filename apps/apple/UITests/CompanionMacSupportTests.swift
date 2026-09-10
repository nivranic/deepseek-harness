import XCTest

/// Exercises the production Mac Companion save dialog on the disposable runner without pairing credentials.
final class CompanionMacSupportTests: XCTestCase {
    @MainActor
    func testUnpairedDiagnosticsCancelThenSave() throws {
        continueAfterFailure = false
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-companion-export-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        defer {
            app.terminate()
            try? FileManager.default.removeItem(at: directory)
        }
        app.launch()
        XCTAssertTrue(app.staticTexts["配对到宿主"].waitForExistence(timeout: 15))
        let export = app.buttons["companion.support.export"]
        XCTAssertTrue(export.waitForExistence(timeout: 5))
        let panel = app.sheets.firstMatch
        chooseDestination(app, directory: directory, filename: "cancelled.json")
        let cancel = panel.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.click()
        waitForDismissal(app, panel: panel, export: export)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
        attachScreenshot(app, name: "companion-support-cancelled-macos")

        let filename = "companion-support-unpaired-macos.json"
        chooseDestination(app, directory: directory, filename: filename)
        panel.buttons["OKButton"].click()
        waitForDismissal(app, panel: panel, export: export)
        let file = directory.appendingPathComponent(filename)
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            FileManager.default.fileExists(atPath: file.path)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 10), .completed)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [filename])
        let data = try Data(contentsOf: file)
        XCTAssertLessThanOrEqual(data.count, 16384)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(value.keys), Set(["schemaVersion", "kind", "complete", "application", "scanner", "link", "uncollected"]))
        XCTAssertEqual(value["kind"] as? String, "companion-support")
        XCTAssertEqual(value["complete"] as? Bool, false)
        let link = try XCTUnwrap(value["link"] as? [String: Any])
        XCTAssertEqual(Set(link.keys), Set(["producer", "activityScope", "roleFreshness", "descriptionFreshness", "state"]))
        XCTAssertEqual(link["state"] as? String, "unavailable")
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "companion-support-unpaired-macos"
        attachment.lifetime = .keepAlways
        add(attachment)
        attachScreenshot(app, name: "companion-support-saved-macos")
    }

    @MainActor
    private func chooseDestination(_ app: XCUIApplication, directory: URL, filename: String) {
        app.buttons["companion.support.export"].click()
        let panel = app.sheets.firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 25))
        let name = panel.textFields.matching(NSPredicate(format: "value BEGINSWITH %@", "dsh-companion-diagnostics")).firstMatch
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

    @MainActor
    private func waitForDismissal(_ app: XCUIApplication, panel: XCUIElement, export: XCUIElement) {
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !panel.exists && export.exists && export.isEnabled
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertEqual(app.state, .runningForeground)
    }

    @MainActor
    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
