import XCTest

/// Runs the installed iOS shell on a fresh simulator without credentials or a test Host.
final class CompanionStartupTests: XCTestCase {
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
        let navigationCancel = app.navigationBars.buttons["Cancel"].firstMatch
        // The system picker can expose its dismissal overlay as Other instead of a navigation button.
        let overlayCancel = app.otherElements["Cancel"].firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            picker.exists && ((navigationCancel.exists && navigationCancel.isHittable)
                || (overlayCancel.exists && overlayCancel.isHittable))
        }, object: nil)
        let appeared = XCTWaiter.wait(for: [ready], timeout: 30) == .completed
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
        let cancel = navigationCancel.exists && navigationCancel.isHittable ? navigationCancel : overlayCancel
        cancel.tap()
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in export.exists && export.isEnabled }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 10), .completed)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertEqual(app.state, .runningForeground)
    }
}
