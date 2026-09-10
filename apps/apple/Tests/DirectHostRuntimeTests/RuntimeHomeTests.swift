import Foundation
import XCTest
@testable import DirectHostRuntime

final class RuntimeHomeTests: XCTestCase {
    #if os(macOS)
    @MainActor
    func testInvalidOverrideFailsBeforeCreatingDefaultHomeOrLaunching() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let policy = try RuntimePolicy(startupMilliseconds: 1000, healthMilliseconds: 1000,
                                       requestMilliseconds: 1000, shutdownMilliseconds: 1000)
        let runtime = RuntimeSupervisor(executable: home, helper: home, home: home,
                                        policy: policy, homeOverride: "relative-home")
        runtime.start()
        XCTAssertEqual(runtime.status, .failed(.invalidConfiguration))
        XCTAssertNil(runtime.launchURL)
        XCTAssertFalse(FileManager.default.fileExists(atPath: home.path))
    }
    #endif

    func testDefaultAndExplicitHomesResolveBeforeLaunch() throws {
        let base = URL(fileURLWithPath: "/Users/fixture/Library/Application Support/DeepSeek Harness/Host")
        XCTAssertEqual(try RuntimeHome.resolve(defaultHome: base, override: nil), base)
        XCTAssertEqual(try RuntimeHome.resolve(defaultHome: base, override: "/tmp/host fixture").path, "/tmp/host fixture")
        XCTAssertEqual(try RuntimeHome.resolve(defaultHome: base, override: "/tmp/other/../host").path, "/tmp/host")
        XCTAssertEqual(try RuntimeHome.resolve(defaultHome: base, override: "/...").path, "/...")
    }

    func testInvalidExplicitHomeCannotFallBackToUserData() throws {
        let base = URL(fileURLWithPath: "/Users/fixture/host")
        // Root aliases must not traverse the system's /tmp symlink.
        let invalid = ["", "relative", "~/host", "/", "/.", "/..", "/./.", "/../.", "/../../..",
                       "//server/share", "/tmp/host\n", "/tmp/host\u{0}"]
        for (index, value) in invalid.enumerated() {
            XCTAssertThrowsError(try RuntimeHome.resolve(defaultHome: base, override: value), "invalid home fixture \(index)")
        }
        XCTAssertThrowsError(try RuntimeHome.resolve(defaultHome: XCTUnwrap(URL(string: "https://example.com")), override: nil))
    }
}
