import Foundation
import XCTest
@testable import DirectHostRuntime

final class RuntimeEndpointTests: XCTestCase {
    func testAcceptsOnlyTheAuthenticatedLoopbackRoot() throws {
        let raw = "http://127.0.0.1:45678/?token=fixture-token"
        XCTAssertEqual(RuntimeEndpoint.parse("dsh web: " + raw)?.absoluteString, raw)
        let invalid = [
            "http://example.com:45678/?token=fixture-token",
            "http://user@127.0.0.1:45678/?token=fixture-token",
            "http://127.0.0.1:0/?token=fixture-token",
            "http://127.0.0.1:65536/?token=fixture-token",
            "http://127.0.0.1:45678/api?token=fixture-token",
            "http://127.0.0.1:45678/?token=fixture-token&token=other",
            "http://127.0.0.1:45678/?other=fixture-token",
            "http://127.0.0.1:45678/?token=fixture-token#fragment",
            "http://127.0.0.1:45678/?token=fixture-token (LAN: http://example.com)",
        ]
        for value in invalid { XCTAssertNil(RuntimeEndpoint.parse("dsh web: " + value)) }
        XCTAssertNil(RuntimeEndpoint.parse("ordinary runtime output"))
    }

    func testNavigationCannotLeaveTheRuntimeCarrier() throws {
        let launch = try XCTUnwrap(RuntimeEndpoint.parse("dsh web: http://127.0.0.1:45678/?token=fixture-token"))
        for value in ["http://127.0.0.1:45678/", "http://127.0.0.1:45678/assets/main.js"] {
            XCTAssertTrue(RuntimeEndpoint.sameCarrier(try XCTUnwrap(URL(string: value)), as: launch))
        }
        for value in ["http://127.0.0.1:45679/", "https://127.0.0.1:45678/", "http://localhost:45678/", "http://user@127.0.0.1:45678/"] {
            XCTAssertFalse(RuntimeEndpoint.sameCarrier(try XCTUnwrap(URL(string: value)), as: launch))
        }
    }

    #if os(macOS)
    func testRejectsInvalidLifecycleTimingBeforeLaunch() throws {
        XCTAssertThrowsError(try RuntimePolicy(startupMilliseconds: 0, healthMilliseconds: 5000,
                                               requestMilliseconds: 3000, shutdownMilliseconds: 10000))
        XCTAssertThrowsError(try RuntimePolicy(startupMilliseconds: 60000, healthMilliseconds: 5000,
                                               requestMilliseconds: 3000, shutdownMilliseconds: 60001))
    }
    #endif
}
