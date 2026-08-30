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

@MainActor
final class LiteLoopDriverTests: XCTestCase {
    func testDrivesPromptStreamToolsToCompletion() async {
        let provider = ScriptedLiteProvider(scripts: [
            "搜索契约文档": [
                .reasoning("先查规范"),
                .text("找到要点："),
                .toolCall(id: "c1", name: "web_search", arguments: "{\"query\":\"lite\"}"),
                .text("共两条。"),
            ],
        ])
        let driver = LiteLoopDriver(provider: provider) { _, name, _ in
            (ok: true, text: name == "web_search" ? "找到 2 篇。" : "")
        }
        await driver.submit(prompt: "搜索契约文档")
        let state = driver.fold.state
        XCTAssertEqual(state.conversation.map(\.role), ["user", "assistant"])
        XCTAssertEqual(state.conversation[1].text, "找到要点：共两条。")
        XCTAssertEqual(state.toolCalls, [
            LiteToolRecord(id: "c1", name: "web_search", arguments: "{\"query\":\"lite\"}", phase: .completed, resultText: "找到 2 篇。"),
        ])
        XCTAssertEqual(state.lastTurnEnd, .completed)
        XCTAssertNil(state.pendingHandoff)
        XCTAssertEqual(await provider.submitted, ["搜索契约文档"])
    }

    func testHandsOffInsteadOfExecutingFullRuntimeTools() async {
        let provider = ScriptedLiteProvider(scripts: [
            "跑测试": [.toolCall(id: "c2", name: "run_tests", arguments: "{}")],
        ])
        var executed = 0
        let driver = LiteLoopDriver(provider: provider) { _, _, _ in
            executed += 1
            return (ok: false, text: "")
        }
        await driver.submit(prompt: "跑测试")
        XCTAssertEqual(driver.fold.state.pendingHandoff, LITE_REQUIRES_FULL_RUNTIME)
        XCTAssertEqual(executed, 0)
        XCTAssertNil(driver.fold.state.lastTurnEnd)
    }

    func testUnknownToolNamesNeverDispatch() async {
        let provider = ScriptedLiteProvider(scripts: [
            "下载并运行": [.text("试试。"), .toolCall(id: "c3", name: "download_and_run", arguments: "{}")],
        ])
        var executed = 0
        let driver = LiteLoopDriver(provider: provider) { _, _, _ in
            executed += 1
            return (ok: false, text: "")
        }
        await driver.submit(prompt: "下载并运行")
        XCTAssertEqual(executed, 0)
        XCTAssertEqual(driver.fold.state.toolCalls.map(\.phase), [.running])
        XCTAssertEqual(driver.fold.state.lastTurnEnd, .completed)
    }
}
