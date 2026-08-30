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
        let submitted = await provider.submitted
        XCTAssertEqual(submitted, ["搜索契约文档"])
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

final class LiteStoreTests: XCTestCase {
    private func temporaryDirectory(_ name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("lite-stores-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func testSessionJournalRoundTripsAndReplays() async throws {
        let store = try LiteFileSessionStore(directory: temporaryDirectory("sessions"))
        var session = LiteSession(id: "s1")
        session.record(.promptAccepted(requestId: "r1", content: "搜索契约文档"))
        session.record(.toolCall(id: "c1", name: "web_search", arguments: "{}"))
        session.record(.toolResult(id: "c1", ok: true, text: "找到 2 篇。"))
        session.record(.messageCompleted(text: "完成。", usage: LiteUsage(inputTokens: 10, outputTokens: 5)))
        session.record(.turnCompleted)
        try await store.save(session)

        let restored = try await store.load(id: "s1")
        XCTAssertEqual(restored, session)
        XCTAssertEqual(restored?.state.toolCalls.first?.phase, .completed)
        XCTAssertEqual(restored?.state.lastTurnEnd, .completed)

        try await store.delete(id: "s1")
        let gone = try await store.load(id: "s1")
        XCTAssertNil(gone)
    }

    func testArtifactContentRoundTrips() async throws {
        let store = try LiteFileArtifactStore(directory: temporaryDirectory("artifacts"))
        try await store.put(id: "a1", data: Data("# 报告\n".utf8))
        let loaded = try await store.get(id: "a1")
        XCTAssertEqual(String(data: loaded ?? Data(), encoding: .utf8), "# 报告\n")
        try await store.remove(id: "a1")
        let removed = try await store.get(id: "a1")
        XCTAssertNil(removed)
    }
}

final class LiteProviderTests: XCTestCase {
    /// One NDJSON wire line carrying a single delta, exactly as the provider
    /// receives it.
    private func wireLine(_ delta: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: ["choices": [["delta": delta]]])
        return String(data: data, encoding: .utf8)!
    }

    func testParsesSSEAndNDJSDLines() throws {
        if case .reasoning("先想")? = LiteStreamLineParser.parsePiece(line: "data: " + (try wireLine(["reasoning_content": "先想"]))) {} else {
            XCTFail("reasoning delta did not parse")
        }
        if case .text("你好")? = LiteStreamLineParser.parsePiece(line: try wireLine(["content": "你好"])) {} else {
            XCTFail("text delta did not parse")
        }
        let entries: [[String: Any]] = [["id": "c1", "index": 0, "function": ["name": "web_search", "arguments": "{}"]]]
        if case .toolCallEntries(let parsed)? = LiteStreamLineParser.parsePiece(line: "data: " + try wireLine(["tool_calls": entries])) {
            XCTAssertEqual(parsed[0]["id"] as? String, "c1")
            XCTAssertEqual((parsed[0]["function"] as? [String: Any])?["name"] as? String, "web_search")
        } else {
            XCTFail("tool-call delta did not parse")
        }
        XCTAssertNil(LiteStreamLineParser.parsePiece(line: "data: [DONE]"))
        XCTAssertNil(LiteStreamLineParser.parsePiece(line: ""))
        XCTAssertNil(LiteStreamLineParser.parsePiece(line: ": keep-alive"))
    }

    func testAssemblesFragmentedToolCallDeltasIntoWholeCalls() {
        let quote = String(UnicodeScalar(34))
        let assembled = "{" + quote + "path" + quote + ":" + quote + "Log" + quote + "}"
        var assembler = LiteToolCallAssembler()
        assembler.ingest(["id": "call-1", "index": 0, "function": ["name": "write_file", "arguments": "{"]])
        assembler.ingest(["index": 0, "function": ["arguments": quote + "path" + quote + ":" + quote + "Log" + quote]])
        assembler.ingest(["index": 0, "function": ["arguments": "}"]])
        XCTAssertEqual(assembler.finish(), [
            .toolCall(id: "call-1", name: "write_file", arguments: assembled),
        ])
        XCTAssertEqual(assembler.finish(), [], "flush drains the slots")
    }

    func testAssemblesParallelCallsInIndexOrderWithDefaults() {
        var assembler = LiteToolCallAssembler()
        assembler.ingest(["index": 1, "function": ["name": "url_fetch", "arguments": "{1:"]])
        assembler.ingest(["index": 0, "function": ["name": "web_search"]])
        assembler.ingest(["index": 1, "function": ["arguments": "2}"]])
        assembler.ingest(["index": 0, "function": ["arguments": "{}"]])
        assembler.ingest(["index": 2, "function": ["arguments": "no name ever arrives"]])
        XCTAssertEqual(assembler.finish(), [
            .toolCall(id: "tool-0", name: "web_search", arguments: "{}"),
            .toolCall(id: "tool-1", name: "url_fetch", arguments: "{1:2}"),
        ])
    }

    @MainActor
    func testDriverFoldsTransportFailuresIntoTheSpecVocabulary() async {
        actor NetworkDrop: LiteProviding {
            func stream(prompt: String) async throws -> AsyncThrowingStream<LiteStreamChunk, Error> {
                AsyncThrowingStream { $0.finish(throwing: LiteTransportError.network(kind: "dropped")) }
            }
        }
        actor RateLimited: LiteProviding {
            func stream(prompt: String) async throws -> AsyncThrowingStream<LiteStreamChunk, Error> {
                AsyncThrowingStream { $0.finish(throwing: LiteTransportError.provider(code: "RATE_LIMITED", message: "并发超限")) }
            }
        }
        let dropped = LiteLoopDriver(provider: NetworkDrop()) { _, _, _ in (ok: false, text: "") }
        await dropped.submit(prompt: "继续")
        XCTAssertEqual(dropped.fold.state.lastTurnEnd, .networkError)
        XCTAssertEqual(dropped.fold.state.errors.last?.kind, "network")

        let limited = LiteLoopDriver(provider: RateLimited()) { _, _, _ in (ok: false, text: "") }
        await limited.submit(prompt: "继续")
        XCTAssertEqual(limited.fold.state.lastTurnEnd, .providerError)
        XCTAssertEqual(limited.fold.state.errors.last?.code, "RATE_LIMITED")
    }
}

@MainActor
final class LiteChatViewModelTests: XCTestCase {
    func testSubmitsPersistsAndExposesTheFoldedState() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("lite-ui-\(UUID().uuidString)", isDirectory: true)
        let store = try LiteFileSessionStore(directory: directory)
        let provider = ScriptedLiteProvider(scripts: [
            "你好": [.text("你好，这里是 Lite。")],
        ])
        let model = LiteChatViewModel(sessionId: "ui1", provider: provider, execute: { _, _, _ in (ok: false, text: "") }, store: store)
        await model.send(prompt: "你好")
        XCTAssertEqual(model.state.conversation.map(\.text), ["你好", "你好，这里是 Lite。"])
        XCTAssertEqual(model.state.lastTurnEnd, .completed)

        let restored = try await store.load(id: "ui1")
        XCTAssertEqual(restored?.state.conversation.count, 2)

        let handoffProvider = ScriptedLiteProvider(scripts: [
            "跑测试": [.toolCall(id: "c", name: "run_tests", arguments: "{}")],
        ])
        let handoffModel = LiteChatViewModel(sessionId: "ui2", provider: handoffProvider, execute: { _, _, _ in (ok: false, text: "") })
        await handoffModel.send(prompt: "跑测试")
        XCTAssertEqual(handoffModel.lastHandoff, LITE_REQUIRES_FULL_RUNTIME)
    }
}
