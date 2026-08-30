import XCTest
@testable import LiteRuntime

/// Lite Behavior Spec conformance: every golden fixture — events plus the
/// TypeScript reference fold's expected state — must fold to exactly that
/// state here too (plan chapter 63).
final class LiteConformanceTests: XCTestCase {
    private var fixturesDirectory: URL {
        URL(fileURLWithPath: #filePath, isDirectory: false)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures", isDirectory: true)
            .appendingPathComponent("lite-conformance", isDirectory: true)
    }

    private struct Scenario: Decodable {
        let covers: [String]
        let events: [LiteEvent]
        let expected: LiteDomainState
    }

    func testEveryScenarioFoldsToTheReferenceState() throws {
        let ids = [
            "prompt-and-streaming", "cancel-preserves-prefix", "tool-call-and-result",
            "plan-todo-artifact", "provider-and-network-errors", "handoff-request",
        ]
        var covered = Set<String>()
        for id in ids {
            let data = try Data(contentsOf: fixturesDirectory.appendingPathComponent("\(id).json"))
            let scenario = try JSONDecoder().decode(Scenario.self, from: data)
            covered.formUnion(scenario.covers)
            var fold = LiteFold()
            for event in scenario.events { fold.apply(event) }
            XCTAssertEqual(fold.state, scenario.expected, "scenario \(id) must fold to the TypeScript reference state")
        }
        XCTAssertEqual(covered.count, 11)
    }
}

final class LiteToolRegistryTests: XCTestCase {
    func testBundledSetIsStaticAndRefusesUnknownNames() {
        for descriptor in LiteToolRegistry.bundled {
            XCTAssertFalse(descriptor.name.isEmpty)
        }
        XCTAssertNil(LiteToolRegistry.tool(named: "download_and_run"))
        XCTAssertNil(LiteToolRegistry.handoffCapability(for: "web_search"))
    }

    func testFullRuntimeToolsHandOff() {
        XCTAssertEqual(LiteToolRegistry.handoffCapability(for: "run_tests"), LITE_REQUIRES_FULL_RUNTIME)
    }
}
