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
}
