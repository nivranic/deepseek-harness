import Foundation
import XCTest
@testable import CompanionUI

final class CompanionSessionDiagnosticsTests: XCTestCase {
    func testAbsentOwnerAndUnselectedOwnerHaveDifferentExplicitObservations() throws {
        let absent = try JSONSerialization.jsonObject(with: JSONEncoder().encode(CompanionSessionDiagnostics.unavailable)) as? [String: String]
        XCTAssertEqual(absent, ["producer": "RemoteSessionViewModel", "activityScope": "retained-local-projection", "observation": "unavailable"])
        let unselected = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(CompanionSessionDiagnostics.unselected)) as? [String: Any])
        XCTAssertEqual(unselected["observation"] as? String, "current")
        XCTAssertEqual(unselected["selected"] as? Bool, false)
        XCTAssertNil(unselected["snapshot"])
    }

    func testEveryRetainedCountClampsAndDisclosesTheUnsigned32BitCeiling() {
        let overflow = Int(UInt32.max) + 1
        let bounded = CompanionSessionDiagnostics.Counts(timelineRows: overflow, toolCalls: overflow, artifacts: overflow,
                                                         images: overflow, todos: overflow, goals: overflow)
        XCTAssertEqual([bounded.timelineRows, bounded.toolCalls, bounded.artifacts, bounded.images, bounded.todos, bounded.goals],
                       Array(repeating: UInt32.max, count: 6))
        XCTAssertTrue(bounded.countsSaturated)
        let ordinary = CompanionSessionDiagnostics.Counts(timelineRows: 1, toolCalls: 2, artifacts: 3, images: 4, todos: 5, goals: 6)
        XCTAssertEqual([ordinary.timelineRows, ordinary.toolCalls, ordinary.artifacts, ordinary.images, ordinary.todos, ordinary.goals], [1, 2, 3, 4, 5, 6])
        XCTAssertFalse(ordinary.countsSaturated)
    }

    @MainActor
    func testOpeningAnEmptyLocalProjectionDoesNotClaimThatHostHistoryWasReceived() async {
        let wire = FakeWire()
        let model = RemoteSessionViewModel(wire: wire)
        XCTAssertEqual(model.sessionDiagnostics, .unselected)
        await model.open(sessionId: "private-session")
        let value = model.sessionDiagnostics
        XCTAssertEqual(value.observation, "current")
        XCTAssertEqual(value.activityScope, "retained-local-projection")
        XCTAssertEqual(value.selected, true)
        XCTAssertEqual(value.snapshot, CompanionSessionDiagnostics.Counts(timelineRows: 0, toolCalls: 0, artifacts: 0, images: 0, todos: 0, goals: 0))
        model.close()
        XCTAssertEqual(model.sessionDiagnostics, .unselected)
        XCTAssertEqual(value.selected, true)
    }
}
