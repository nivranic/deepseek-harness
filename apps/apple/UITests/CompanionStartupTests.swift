import XCTest

/// Runs the installed iOS shell on a fresh simulator without credentials or a test Host.
final class CompanionStartupTests: XCTestCase {
    @MainActor
    func testUnpairedDiagnosticsSaveToLocalFiles() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let export = app.buttons["companion.support.export"]
        XCTAssertTrue(export.waitForExistence(timeout: 15))
        export.tap()
        let navigation = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 30))
        XCTAssertTrue(navigation.staticTexts["On My iPhone"].waitForExistence(timeout: 30))
        let filename = app.textFields["DOCPicker.filenameTextField"]
        XCTAssertTrue(filename.exists)
        XCTAssertEqual(filename.value as? String, "dsh-companion-diagnostics")
        let save = navigation.buttons["Save"]
        XCTAssertTrue(save.exists && save.isEnabled)
        save.tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !navigation.exists && export.exists && export.isEnabled
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 15), .completed)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertEqual(app.state, .runningForeground)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "unpaired-diagnostics-saved-ios"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    func testUnpairedStartupRendersPairing() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["配对到宿主"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.textFields["设备名称"].exists)
        XCTAssertTrue(app.buttons["配对"].exists)
        XCTAssertFalse(app.buttons["配对"].isEnabled)
        XCTAssertEqual(app.state, .runningForeground)

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "unpaired-startup"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    func testUnpairedDiagnosticsReachTheSystemExporterAndCancelWithoutFailure() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let export = app.buttons["companion.support.export"]
        XCTAssertTrue(export.waitForExistence(timeout: 15))
        XCTAssertTrue(export.isEnabled)
        export.tap()
        let picker = app.otherElements["Browse View (Picker)"].firstMatch
        let navigation = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"]
        let appeared = navigation.waitForExistence(timeout: 30) && picker.exists
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "unpaired-diagnostics-system-exporter"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        if !appeared {
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "diagnostics-exporter-hierarchy"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
        }
        XCTAssertTrue(appeared)
        XCTAssertFalse(app.buttons["companion.support.cancel"].exists)
        let cancel = navigation.buttons["Cancel"].firstMatch
        if cancel.exists && cancel.isHittable {
            cancel.tap()
        } else {
            // Some system pickers omit a Cancel button; dismiss their modal sheet using its navigation area.
            let start = navigation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9))
            start.press(forDuration: 0.1, thenDragTo: end)
        }
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !picker.exists && export.exists && export.isEnabled
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 10), .completed)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertEqual(app.state, .runningForeground)
        let cancelled = XCTAttachment(screenshot: app.screenshot())
        cancelled.name = "unpaired-diagnostics-cancelled"
        cancelled.lifetime = .keepAlways
        add(cancelled)
    }
}
