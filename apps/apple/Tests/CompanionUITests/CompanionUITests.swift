import XCTest
@testable import CompanionUI
import SharedAppleRemoteCore

/// A scriptable wire double: recorded unary answers per method and a
/// stream whose frames the test feeds.
actor FakeWire: CompanionWireDriving {
    private(set) var calls: [(method: String, args: [String: WireValue])] = []
    private var answers: [String: Result<WireValue, Error>] = [:]
    private var answerQueues: [String: [Result<WireValue, Error>]] = [:]
    private var streams: [String: Result<[WireValue], Error>] = [:]
    private(set) var streamCalls: [(endpoint: String, payload: [String: WireValue])] = []

    func stub(_ method: String, answer: Result<WireValue, Error>) {
        answers[method] = answer
    }

    /// Queue sequential answers for one method; each call pops the next.
    func stubSequence(_ method: String, answers: [Result<WireValue, Error>]) {
        answerQueues[method] = answers
    }

    func stubStream(_ endpoint: String, frames: Result<[WireValue], Error>) {
        streams[endpoint] = frames
    }

    func call(_ method: String, args: [String: WireValue]) async throws -> WireValue {
        calls.append((method, args))
        if var queue = answerQueues[method], !queue.isEmpty {
            let next = queue.removeFirst()
            answerQueues[method] = queue
            switch next {
            case .success(let value): return value
            case .failure(let error): throw error
            }
        }
        switch answers[method] ?? .success(.null) {
        case .success(let value): return value
        case .failure(let error): throw error
        }
    }

    func stream(_ endpoint: String, payload: [String: WireValue]) async throws -> AsyncThrowingStream<WireValue, Error> {
        streamCalls.append((endpoint, payload))
        switch streams[endpoint] ?? .success([]) {
        case .success(let frames):
            return AsyncThrowingStream { continuation in
                for frame in frames { continuation.yield(frame) }
                // A live follow stream stays open; the fake's frames have all
                // arrived and cancellation is the only end, so view models
                // under test never resubscribe mid-assertion.
            }
        case .failure(let error):
            return AsyncThrowingStream { continuation in
                continuation.finish(throwing: error)
            }
        }
    }
}

func jsonObject(_ entries: [String: WireValue]) -> WireValue {
    .object(entries)
}

/// One follow-frame record: `{type: "event", event: {type, seq, time, data}}`.
func eventEntry(_ seq: Double, _ type: String, _ data: [String: WireValue]) -> WireValue {
    jsonObject([
        "type": .string("event"),
        "event": jsonObject([
            "type": .string(type),
            "seq": .number(seq),
            "time": .number(1_759_017_600_000 + seq),
            "data": jsonObject(data),
        ]),
    ])
}

/// One packed-history record: `{type: "chunks", event: {…}}`.
func chunkEntry(_ seq: Double, _ type: String, _ data: [String: WireValue]) -> WireValue {
    jsonObject([
        "type": .string("chunks"),
        "event": jsonObject([
            "type": .string(type),
            "seq": .number(seq),
            "time": .number(1_759_017_600_000 + seq),
            "data": jsonObject(data),
        ]),
    ])
}

@MainActor
final class RemoteSessionViewModelTests: XCTestCase {
    func testLoadsAndProjectsSessionRows() async {
        let wire = FakeWire()
        await wire.stub("session/list", answer: .success(jsonObject([
            "items": .array([
                jsonObject(["sessionId": .string("s1"), "title": .string("Refactor"), "updatedAt": .number(100)]),
                jsonObject(["sessionId": .string("s2"), "title": .string("Notes")]),
            ]),
        ])))
        let model = RemoteSessionViewModel(wire: wire)
        await model.loadSessions()
        XCTAssertEqual(model.listState, .ready)
        XCTAssertEqual(model.sessions, [
            SessionRow(id: "s1", title: "Refactor", updatedAt: 100),
            SessionRow(id: "s2", title: "Notes", updatedAt: nil),
        ])
    }

    func testFailureSurfacesTheCarrierMessage() async {
        let wire = FakeWire()
        await wire.stub("session/list", answer: .failure(LinkClientError.carrier(status: 401, message: "unknown device")))
        let model = RemoteSessionViewModel(wire: wire)
        await model.loadSessions()
        XCTAssertEqual(model.listState, .failed("carrier 401: unknown device"))
    }

    func testOpenFoldsRealRecordsIntoTimelineAndPaneState() async {
        let wire = FakeWire()
        await wire.stubStream("session/follow", frames: .success([
            jsonObject([
                "type": .string("snapshot"),
                "cursor": .number(4),
                "records": .array([
                    eventEntry(1, "turn/start", ["turn": .number(1)]),
                    chunkEntry(2, "chunkrow/text-chunks", [
                        "turn": .number(1), "step": .number(1), "index": .number(0),
                        "dt": .array([.number(2)]),
                        "texts": .array([.string("你"), .string("好")]),
                    ]),
                    eventEntry(3, "plan/mode", ["active": .bool(true)]),
                    eventEntry(4, "assistant/message", [
                        "turn": .number(1), "step": .number(1),
                        "message": jsonObject([
                            "id": .string("m-1"),
                            "role": .string("assistant"),
                            "content": .array([jsonObject([
                                "type": .string("text"),
                                "text": .string("已完成：登录页液态玻璃样式落地。"),
                            ])]),
                            "source": jsonObject([
                                "kind": .string("model"),
                                "provider": .string("deepseek"),
                                "model": .string("deepseek-chat"),
                            ]),
                        ]),
                        "usage": jsonObject([
                            "inputTokens": .number(120),
                            "outputTokens": .number(36),
                            "totalTokens": .number(156),
                        ]),
                    ]),
                ]),
            ]),
            eventEntry(5, "todo/write", [
                "todos": .array([
                    jsonObject(["content": .string("编译伴侣应用"), "status": .string("in_progress")]),
                    jsonObject(["content": .string("跑契约回放测试"), "status": .string("pending")]),
                ]),
            ]),
            eventEntry(6, "goal/change", [
                "kind": .string("goal/change"),
                "version": .number(1),
                "operation": .string("create"),
                "goal": jsonObject([
                    "id": .string("goal-1"), "revision": .number(1),
                    "objective": .string("发布 0.2 伴侣版"),
                    "phase": .string("active"), "maxGoalRounds": .number(12),
                ]),
                "roundsStarted": .number(0),
                "createdAt": .number(1_759_017_600_000),
                "updatedAt": .number(1_759_017_600_000),
            ]),
        ]))
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s1")
        // The stream finished cleanly, which is a loss for a follow: the view
        // model schedules a resubscribe; the assertions below hold before and
        // after because folding is idempotent per open.
        try? await Task.sleep(for: .milliseconds(50))
        let active = model.active
        XCTAssertNotNil(active)
        XCTAssertEqual(active?.cursor, 6)
        XCTAssertEqual(active?.items.map(\.kind), [
            "turn/start", "chunkrow/text-chunks", "plan/mode", "assistant/message", "todo/write", "goal/change",
        ])
        XCTAssertEqual(active?.items.map(\.text), [
            "第 1 轮开始", "你好", "进入计划模式", "已完成：登录页液态玻璃样式落地。", "更新待办（2 项）", "目标：发布 0.2 伴侣版",
        ])
        XCTAssertEqual(model.planTodoGoal.planActive, true)
        XCTAssertEqual(model.planTodoGoal.todos.map(\.text), ["编译伴侣应用", "跑契约回放测试"])
        XCTAssertEqual(model.planTodoGoal.todos.map(\.status), ["in_progress", "pending"])
        XCTAssertEqual(model.planTodoGoal.goals.map(\.title), ["发布 0.2 伴侣版"])
        XCTAssertEqual(model.planTodoGoal.goals.map(\.state), ["active"])
    }

    func testPaneStateFoldsLastWritePerKind() async {
        let wire = FakeWire()
        await wire.stubStream("session/follow", frames: .success([
            eventEntry(1, "todo/write", [
                "todos": .array([jsonObject(["content": .string("旧任务"), "status": .string("pending")])]),
            ]),
            eventEntry(2, "goal/change", [
                "kind": .string("goal/change"), "version": .number(1), "operation": .string("create"),
                "goal": jsonObject([
                    "id": .string("goal-1"), "revision": .number(1),
                    "objective": .string("发布 0.2 伴侣版"),
                    "phase": .string("active"), "maxGoalRounds": .number(12),
                ]),
                "roundsStarted": .number(0),
                "createdAt": .number(1_759_017_600_000),
                "updatedAt": .number(1_759_017_600_000),
            ]),
            eventEntry(3, "goal/change", [
                "kind": .string("goal/change"), "version": .number(1), "operation": .string("clear"),
                "clearedAt": .number(1_759_017_700_000),
            ]),
        ]))
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s1")
        try? await Task.sleep(for: .milliseconds(50))
        // The clear tombstone drops the goal; the seeded todo stays until the
        // next whole-list write replaces it.
        XCTAssertEqual(model.planTodoGoal.goals, [])
        XCTAssertEqual(model.planTodoGoal.todos.map(\.text), ["旧任务"])
    }

    func testToolTrajectoryPairsCallsWithResultsByCallId() async {
        let wire = FakeWire()
        await wire.stubStream("session/follow", frames: .success([
            eventEntry(1, "tool/call", [
                "turn": .number(1), "step": .number(1),
                "callId": .string("call-1"), "name": .string("write_file"),
                "arguments": .string("{\"path\":\"Login.swift\"}"),
            ]),
            eventEntry(2, "tool/call", [
                "turn": .number(1), "step": .number(1),
                "callId": .string("call-2"), "name": .string("run_tests"),
                "arguments": .string("{}"),
            ]),
            eventEntry(3, "tool/result", [
                "turn": .number(1), "step": .number(1),
                "message": jsonObject([
                    "id": .string("m-1"),
                    "role": .string("user"),
                    "content": .array([jsonObject([
                        "type": .string("tool-result"),
                        "toolCallId": .string("call-1"),
                        "content": .array([jsonObject(["type": .string("text"), "text": .string("已写入 42 行。")])]),
                    ])]),
                    "source": jsonObject(["kind": .string("tool"), "callId": .string("call-1")]),
                ]),
            ]),
            eventEntry(4, "tool/result", [
                "turn": .number(1), "step": .number(1),
                "message": jsonObject([
                    "id": .string("m-2"),
                    "role": .string("user"),
                    "content": .array([jsonObject([
                        "type": .string("tool-result"),
                        "toolCallId": .string("call-2"),
                        "content": .array([jsonObject(["type": .string("text"), "text": .string("2 个断言失败")])]),
                    ])]),
                    "source": jsonObject(["kind": .string("tool"), "callId": .string("call-2")]),
                ]),
                "error": jsonObject(["name": .string("AssertionError"), "code": .string("EXIT_1")]),
            ]),
            // A result whose call never arrived is tolerated as a no-op.
            eventEntry(5, "tool/result", [
                "turn": .number(1), "step": .number(1),
                "message": jsonObject([
                    "id": .string("m-3"),
                    "role": .string("user"),
                    "content": .array([jsonObject([
                        "type": .string("tool-result"),
                        "toolCallId": .string("call-x"),
                        "content": .array([jsonObject(["type": .string("text"), "text": .string("孤儿结果")])]),
                    ])]),
                    "source": jsonObject(["kind": .string("tool"), "callId": .string("call-x")]),
                ]),
            ]),
        ]))
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s1")
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(model.toolCalls.map(\.name), ["write_file", "run_tests"])
        XCTAssertEqual(model.toolCalls.map(\.phase), [.completed, .failed])
        XCTAssertEqual(model.toolCalls[0].resultText, "已写入 42 行。")
        XCTAssertEqual(model.toolCalls[1].resultText, "2 个断言失败")
        XCTAssertEqual(model.toolCalls[0].arguments, "{\"path\":\"Login.swift\"}")

        // Reopening a session resets the trajectory alongside the pane state
        // (the quiet stream replays nothing).
        await wire.stubStream("session/follow", frames: .success([]))
        await model.open(sessionId: "s1")
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(model.toolCalls.isEmpty)
    }

    func testSendSubmitsQueuedPromptAndCancelTargetsActiveSession() async {
        let wire = FakeWire()
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s1")
        model.close()
        // Reopen through the public path with a follow stream that stays quiet.
        await wire.stubStream("session/follow", frames: .success([]))
        await model.open(sessionId: "s9")
        await model.send(text: "hi")
        await model.cancelActive()
        let methods = await wire.calls.map(\.method)
        XCTAssertTrue(methods.contains("session/prompt"))
        XCTAssertTrue(methods.contains("session/cancel"))
        let prompt = await wire.calls.first { $0.method == "session/prompt" }
        let request = prompt?.args["request"]
        XCTAssertEqual(WireShape.string(request ?? .null, field: "sessionId"), "s9")
        XCTAssertEqual(WireShape.string(request ?? .null, field: "mode"), "queue")
    }

    func testSendCarriesInlineImageUploads() async {
        let wire = FakeWire()
        await wire.stubStream("session/follow", frames: .success([]))
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s9")
        await model.send(text: "看这张截图", images: [
            CompanionImageUpload(mediaType: "image/png", base64: "iVBORw0KGgo=", name: "shot.png"),
        ])
        let prompt = await wire.calls.first { $0.method == "session/prompt" }
        let request = prompt?.args["request"] ?? .null
        let content = WireShape.array(request, field: "content")
        XCTAssertEqual(content?.count, 2)
        let image = content?[1] ?? .null
        XCTAssertEqual(WireShape.string(image, field: "type"), "image")
        XCTAssertEqual(WireShape.string(image, field: "mediaType"), "image/png")
        XCTAssertEqual(WireShape.string(image, field: "data"), "iVBORw0KGgo=")
        XCTAssertEqual(WireShape.string(image, field: "name"), "shot.png")
    }

    func testReadsAttachmentsOverTheWireAndCachesBytes() async {
        let wire = FakeWire()
        await wire.stubStream("session/follow", frames: .success([]))
        await wire.stub("session/attachment", answer: .success(jsonObject([
            "attachment": jsonObject([
                "attachmentId": .string("att-1"),
                "mediaType": .string("image/png"),
                "bytes": .number(12),
                "width": .number(800),
                "height": .number(600),
                "name": .string("shot.png"),
                "originalDimensions": jsonObject(["width": .number(1600), "height": .number(1200)]),
            ]),
            "data": .string("iVBORw0KGgo="),
        ])))
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s9")
        let read = await model.readAttachment("att-1")
        XCTAssertEqual(read?.attachment.attachmentId, "att-1")
        XCTAssertEqual(read?.attachment.mediaType, .imagePng)
        XCTAssertEqual(model.attachments["att-1"], Data(base64Encoded: "iVBORw0KGgo="))
        let call = await wire.calls.first { $0.method == "session/attachment" }
        let request = call?.args["request"] ?? .null
        XCTAssertEqual(WireShape.string(request, field: "sessionId"), "s9")
        XCTAssertEqual(WireShape.string(request, field: "attachmentId"), "att-1")
    }
}

@MainActor
final class InteractionViewModelTests: XCTestCase {
    func testCollectsApprovalAndQuestionForwardsAndDeduplicates() {
        let model = InteractionViewModel(wire: FakeWire())
        model.collect(jsonObject([
            "event": .string("approval/requested"), "eventId": .string("e1"),
            "sessionId": .string("s1"), "title": .string("Run command"),
        ]))
        model.collect(jsonObject([
            "event": .string("question/requested"), "eventId": .string("e2"),
            "sessionId": .string("s1"), "text": .string("Pick one"),
        ]))
        model.collect(jsonObject(["event": .string("approval/requested"), "eventId": .string("e1")]))
        XCTAssertEqual(model.inbox.count, 2)
        XCTAssertEqual(model.inbox[0].kind, .approval)
        XCTAssertEqual(model.inbox[0].title, "Run command")
        XCTAssertEqual(model.inbox[1].kind, .question)
        XCTAssertEqual(model.inbox[1].detail, "Pick one")
    }

    func testAnswerSubmitsResultOutcomeAndClearsOnSuccess() async {
        let wire = FakeWire()
        await wire.stub("$events/result", answer: .success(.null))
        let model = InteractionViewModel(wire: wire)
        await model.startWatching()
        model.collect(jsonObject(["event": .string("approval/requested"), "eventId": .string("e1"), "title": .string("T")]))
        let pending = model.inbox[0]
        await model.answer(pending, with: .allowedOnce)
        XCTAssertTrue(model.inbox.isEmpty)
        let answer = await wire.calls.first { $0.method == "$events/result" }
        XCTAssertNotNil(answer)
        let outcome = answer?.args["outcome"]
        XCTAssertEqual(WireShape.string(outcome ?? .null, field: "kind"), "result")
        XCTAssertEqual(WireShape.string(outcome ?? .null, field: "value"), "allowed-once")
    }

    func testRefusedAnswerSurfacesAndKeepsTheCard() async {
        let wire = FakeWire()
        await wire.stub("$events/result", answer: .failure(LinkClientError.refused(code: "forbidden", message: "approval disabled on host")))
        let model = InteractionViewModel(wire: wire)
        model.collect(jsonObject(["event": .string("approval/requested"), "eventId": .string("e1"), "title": .string("T")]))
        await model.answer(model.inbox[0], with: .rejected)
        XCTAssertEqual(model.inbox.count, 1)
        XCTAssertEqual(model.lastRefusal, "forbidden: approval disabled on host")
    }
}

/// Domain-state conformance (plan chapter 62): the generated golden
/// scenarios — records plus the TypeScript reference fold's expected state —
/// must fold to exactly that state here too.

@MainActor
final class SubagentsViewModelTests: XCTestCase {
    func testListsChildrenAndOpensTheChildTimeline() async {
        let wire = FakeWire()
        await wire.stub("subagents/list", answer: .success(jsonObject([
            "entries": .array([
                jsonObject([
                    "kind": .string("child"),
                    "id": .string("sa-1"),
                    "activity": .string("running"),
                    "hasChildren": .bool(false),
                    "mode": .string("continuable"),
                    "label": .string("检索合约文档"),
                ]),
                jsonObject([
                    "kind": .string("diagnostic"),
                    "id": .string("sa-2"),
                    "reason": .string("corrupt"),
                ]),
            ]),
            "parentAvailable": .bool(true),
        ])))
        await wire.stubStream("session/follow", frames: .success([
            jsonObject([
                "type": .string("snapshot"),
                "cursor": .number(1),
                "records": .array([
                    eventEntry(1, "turn/start", ["turn": .number(1)]),
                ]),
            ]),
        ]))
        let model = SubagentsViewModel(wire: wire)
        await model.load(parentSessionId: "p1")
        XCTAssertEqual(model.listState, .ready)
        XCTAssertEqual(model.rows.count, 2)
        guard let firstRow = model.rows.first else { return XCTFail("child row missing") }
        XCTAssertEqual(firstRow.label, "检索合约文档")
        XCTAssertEqual(firstRow.mode, .continuable)
        XCTAssertEqual(firstRow.activity, .running)
        XCTAssertEqual(model.rows[1].reason, .corrupt)
        let listCall = await wire.calls.first { $0.method == "subagents/list" }
        guard case .string(let parent)? = listCall?.args["parentSessionId"] else {
            return XCTFail("subagents/list must carry parentSessionId flat")
        }
        XCTAssertEqual(parent, "p1")

        await model.openChild(model.rows[0])
        // openChild returns once the follow task is scheduled, not once its
        // stream request lands; yield until the fake records it.
        var follow: (endpoint: String, payload: [String: WireValue])?
        for _ in 0..<100 where follow == nil {
            await Task.yield()
            follow = await wire.streamCalls.first { $0.endpoint == "session/follow" }
        }
        let request = follow?.payload["request"]
        let address = WireShape.object(request ?? .null, field: "address") ?? .null
        XCTAssertEqual(WireShape.string(address, field: "kind"), "subagent")
        XCTAssertEqual(WireShape.string(address, field: "parentSessionId"), "p1")
        XCTAssertEqual(WireShape.string(address, field: "childSessionId"), "sa-1")
        XCTAssertEqual(WireShape.string(address, field: "mode"), "continuable")
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(model.childTimeline?.active?.items.map(\.kind), ["turn/start"])
    }

    func testSessionFollowSendsTheRequestEnvelope() async {
        let wire = FakeWire()
        await wire.stubStream("session/follow", frames: .success([]))
        let model = RemoteSessionViewModel(wire: wire)
        await model.open(sessionId: "s1")
        try? await Task.sleep(for: .milliseconds(50))
        let follow = await wire.streamCalls.first { $0.endpoint == "session/follow" }
        let request = follow?.payload["request"]
        let address = WireShape.object(request ?? .null, field: "address") ?? .null
        XCTAssertEqual(WireShape.string(address, field: "kind"), "session")
        XCTAssertEqual(WireShape.string(address, field: "sessionId"), "s1")
    }
}

@MainActor
final class FilesViewModelTests: XCTestCase {
    private func listValue(_ path: String, _ entries: [WireValue]) -> WireValue {
        jsonObject(["path": .string(path), "entries": .array(entries)])
    }

    private func entry(_ name: String, _ type: String, _ size: Double? = nil) -> WireValue {
        var fields: [String: WireValue] = ["name": .string(name), "type": .string(type)]
        if let size { fields["size"] = .number(size) }
        return jsonObject(fields)
    }

    func testFollowsWorkspacesAndListsTheRoot() async {
        let wire = FakeWire()
        await wire.stubStream("workspace/follow", frames: .success([
            jsonObject([
                "type": .string("baseline"),
                "value": jsonObject([
                    "items": .array([
                        jsonObject([
                            "workspaceId": .string("w1"),
                            "title": .string("项目"),
                            "path": .string("E:/work/project"),
                            "sessionIds": .array([]),
                            "createdAt": .string("2026-08-30T00:00:00Z"),
                            "updatedAt": .string("2026-08-30T00:00:00Z"),
                        ]),
                    ]),
                    "archivedSessionIds": .array([]),
                ]),
            ]),
        ]))
        await wire.stub("workspaceFiles/list", answer: .success(listValue("", [
            entry("src", "directory"),
            entry("readme.md", "file", 12),
        ])))
        let model = FilesViewModel(wire: wire)
        await model.start()
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(model.workspaces.map(\.title), ["项目"])

        await model.select(workspaceId: "w1")
        XCTAssertEqual(model.listState, .ready)
        XCTAssertEqual(model.directory, "")
        XCTAssertEqual(model.entries.map(\.name), ["src", "readme.md"])
        XCTAssertEqual(model.entries.map(\.type), [.directory, .file])
        XCTAssertEqual(model.entries[1].size, 12)
        let listCall = await wire.calls.first { $0.method == "workspaceFiles/list" }
        guard case .string(let sentWorkspace)? = listCall?.args["workspaceId"] else {
            return XCTFail("list must carry the workspaceId")
        }
        XCTAssertEqual(sentWorkspace, "w1")
        XCTAssertNil(listCall?.args["path"])
    }

    func testNavigatesIntoDirectoriesAndBackUp() async {
        let wire = FakeWire()
        await wire.stubStream("workspace/follow", frames: .success([]))
        await wire.stubSequence("workspaceFiles/list", answers: [
            .success(listValue("", [entry("src", "directory")])),
            .success(listValue("src", [entry("main.ts", "file", 24)])),
            .success(listValue("", [entry("src", "directory")])),
        ])
        let model = FilesViewModel(wire: wire)
        await model.start()
        await model.select(workspaceId: "w1")
        await model.open(model.entries[0])
        XCTAssertEqual(model.directory, "src")
        XCTAssertEqual(model.entries.map(\.name), ["main.ts"])
        guard case .string(let sentPath)? = await wire.calls.last?.args["path"] else {
            return XCTFail("nested list must carry the path")
        }
        XCTAssertEqual(sentPath, "src")
        await model.goUp()
        XCTAssertEqual(model.directory, "")
        XCTAssertEqual(model.entries.map(\.name), ["src"])
        await model.goUp()
        // The root stays put.
        XCTAssertEqual(model.directory, "")
    }

    func testReadsWholeFiles() async {
        let wire = FakeWire()
        await wire.stubStream("workspace/follow", frames: .success([]))
        await wire.stub("workspaceFiles/list", answer: .success(listValue("", [entry("readme.md", "file", 12)])))
        await wire.stub("workspaceFiles/read", answer: .success(jsonObject([
            "content": .string("# 伴侣\n"),
            "truncated": .bool(false),
            "size": .number(5),
            "mediaType": .string("text/markdown"),
        ])))
        let model = FilesViewModel(wire: wire)
        await model.start()
        await model.select(workspaceId: "w1")
        await model.open(model.entries[0])
        XCTAssertEqual(model.openFile?.text, "# 伴侣\n")
        XCTAssertEqual(model.openFile?.mediaType, "text/markdown")
        XCTAssertEqual(model.openFile?.hasMore, false)
        XCTAssertEqual(model.openFile?.loadedUnits, 5)
        XCTAssertNil(model.openFileError)
    }

    func testPagesFilesTheHostReportsTooLarge() async {
        let wire = FakeWire()
        await wire.stubStream("workspace/follow", frames: .success([]))
        await wire.stub("workspaceFiles/list", answer: .success(listValue("", [entry("big.log", "file", 200_000)])))
        let pageSize = FilesViewModel.pageSize
        await wire.stubSequence("workspaceFiles/read", answers: [
            // The unbounded read the host caps.
            .failure(LinkClientError.refused(code: "file-too-large", message: "read it in ranges")),
            // The automatic first page.
            .success(jsonObject([
                "content": .string(String(repeating: "x", count: pageSize)),
                "truncated": .bool(true),
                "size": .number(Double(pageSize * 3)),
                "mediaType": .string("text/plain"),
            ])),
            // loadMore's page.
            .success(jsonObject([
                "content": .string("尾"),
                "truncated": .bool(false),
                "size": .number(Double(pageSize * 3)),
                "mediaType": .string("text/plain"),
            ])),
        ])
        let model = FilesViewModel(wire: wire)
        await model.start()
        await model.select(workspaceId: "w1")
        await model.open(model.entries[0])
        XCTAssertEqual(model.openFile?.text.count, pageSize)
        XCTAssertEqual(model.openFile?.hasMore, true)
        XCTAssertEqual(model.openFile?.loadedUnits, pageSize)
        XCTAssertEqual(model.openFile?.totalUnits, pageSize * 3)
        // The retry carried the explicit page range.
        let reads = await wire.calls.filter { $0.method == "workspaceFiles/read" }.map(\.args)
        XCTAssertEqual(reads.count, 2)
        XCTAssertEqual(reads[1]["offset"], .number(0))
        XCTAssertEqual(reads[1]["limit"], .number(Double(pageSize)))

        await model.loadMore()
        XCTAssertEqual(model.openFile?.text.count, pageSize + 1)
        XCTAssertEqual(model.openFile?.hasMore, false)
        XCTAssertEqual(model.openFile?.loadedUnits, pageSize + 1)
    }

    func testSurfacesBinaryAndBoundaryFailures() async {
        let wire = FakeWire()
        await wire.stubStream("workspace/follow", frames: .success([]))
        await wire.stubSequence("workspaceFiles/list", answers: [
            .success(listValue("", [entry("logo.bin", "file", 9), entry("src", "directory")])),
            .failure(LinkClientError.refused(code: "path-outside-workspace", message: "escapes")),
        ])
        await wire.stub("workspaceFiles/read", answer: .failure(LinkClientError.refused(code: "file-binary", message: "not text")))
        let model = FilesViewModel(wire: wire)
        await model.start()
        await model.select(workspaceId: "w1")
        await model.open(model.entries[0])
        XCTAssertEqual(model.openFileError, "二进制文件，无法预览。")
        XCTAssertNil(model.openFile)

        // Navigating into a directory the host rejects (a link escaping the
        // root) surfaces the containment failure as list state.
        await model.open(model.entries[1])
        XCTAssertEqual(model.listState, .failed("路径越出工作区根。"))
    }
}

final class CompanionFoldConformanceTests: XCTestCase {
    private var conformanceDirectory: URL {
        URL(fileURLWithPath: #filePath, isDirectory: false)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures", isDirectory: true)
            .appendingPathComponent("conformance", isDirectory: true)
    }

    private struct Scenario: Decodable {
        let records: [WireValue]
        let expected: CompanionDomainState
    }

    func testImageBlocksRenderInlineSummaries() {
        var fold = CompanionSessionFold()
        fold.ingest(eventEntry(1, "user/message", [
            "id": .string("m1"),
            "role": .string("user"),
            "content": .array([
                jsonObject(["type": .string("text"), "text": .string("这张截图有问题")]),
                jsonObject([
                    "type": .string("image"),
                    "attachment": jsonObject([
                        "attachmentId": .string("att-1"),
                        "mediaType": .string("image/png"),
                        "bytes": .number(52_444),
                        "width": .number(800),
                        "height": .number(600),
                        "name": .string("screenshot.png"),
                        "originalDimensions": jsonObject(["width": .number(1600), "height": .number(1200)]),
                    ]),
                ]),
            ]),
            "source": jsonObject(["kind": .string("user")]),
        ]))
        XCTAssertEqual(fold.state.images, [
            CompanionDomainState.ImageRef(
                attachmentId: "att-1",
                mediaType: "image/png",
                width: 800,
                height: 600,
                name: "screenshot.png"
            ),
        ])
        XCTAssertEqual(
            fold.state.items.last?.text,
            "这张截图有问题" + "\n" + "图片 screenshot.png（image/png，800×600）"
        )
    }

    func testEveryScenarioFoldsToTheReferenceState() throws {
        let ids = ["basic-turn", "plan-todo-goal", "tool-trajectory"]
        for id in ids {
            let data = try Data(contentsOf: conformanceDirectory.appendingPathComponent("\(id).json"))
            let scenario = try JSONDecoder().decode(Scenario.self, from: data)
            var fold = CompanionSessionFold()
            for record in scenario.records { fold.ingest(record) }
            XCTAssertEqual(fold.state, scenario.expected, "scenario \(id) must fold to the TypeScript reference state")
        }
    }

    func testResetReturnsTheFoldToEmpty() {
        var fold = CompanionSessionFold()
        fold.ingest(eventEntry(1, "turn/start", ["turn": .number(1)]))
        XCTAssertFalse(fold.state.items.isEmpty)
        fold.reset()
        XCTAssertEqual(fold.state, .empty)
    }
}

final class CompanionThemeTests: XCTestCase {
    func testLiquidGlassDegradesWithoutGlassCapableOS() {
        let theme = CompanionTheme.resolve(requested: .liquidGlass, glassCapableOS: false, reduceTransparency: false, increaseContrast: false)
        XCTAssertEqual(theme.style, .neumorphic)
    }

    func testLiquidGlassDegradesOnReducedTransparency() {
        let theme = CompanionTheme.resolve(requested: .liquidGlass, glassCapableOS: true, reduceTransparency: true, increaseContrast: false)
        XCTAssertEqual(theme.style, .neumorphic)
    }

    func testLiquidGlassDegradesOnIncreasedContrast() {
        let theme = CompanionTheme.resolve(requested: .liquidGlass, glassCapableOS: true, reduceTransparency: false, increaseContrast: true)
        XCTAssertEqual(theme.style, .neumorphic)
    }

    func testLiquidGlassSurvivesOnCapableEnvironment() {
        let theme = CompanionTheme.resolve(requested: .liquidGlass, glassCapableOS: true, reduceTransparency: false, increaseContrast: false)
        XCTAssertEqual(theme.style, .liquidGlass)
        XCTAssertTrue(theme.translucent)
    }

    func testNeumorphicNeverUpgrades() {
        let theme = CompanionTheme.resolve(requested: .neumorphic, glassCapableOS: true, reduceTransparency: false, increaseContrast: false)
        XCTAssertEqual(theme.style, .neumorphic)
        XCTAssertFalse(theme.translucent)
    }
}
