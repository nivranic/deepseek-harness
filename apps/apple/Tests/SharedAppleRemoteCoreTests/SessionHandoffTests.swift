import XCTest
@testable import SharedAppleRemoteCore

/// The chapter-40 Handoff L1 device side: snapshot building and sending
/// against a scripted wire seam.
final class SessionHandoffTests: XCTestCase {
    func testBuildsTheSnapshotWireValue() throws {
        let snapshot = SessionHandoff.snapshotValue(
            sourceSessionId: "lite-7f3a",
            capability: "run_tests",
            provenance: HandoffProvenance(deviceId: "dev-phone", platform: "ios", at: 1_782_000_000_000),
            recentContext: [
                HandoffContextRow(role: "user", text: "帮我跑一遍测试"),
                HandoffContextRow(role: "assistant", text: "需要宿主。"),
            ],
            planActive: true,
            todo: [HandoffTodoRow(content: "在宿主继续执行测试", status: "pending")],
            artifactRefs: [HandoffArtifactRef(id: "art-lite-1", kind: "report", title: "本机报告", status: "ready")],
            modelPreference: "deepseek-chat"
        )
        guard case let .object(fields) = snapshot else {
            return XCTFail("snapshot is not an object")
        }
        XCTAssertEqual(fields["sourceSessionId"], .string("lite-7f3a"))
        XCTAssertEqual(fields["sourceRuntime"], .string("lite"))
        XCTAssertEqual(fields["requestedCapability"], .string("run_tests"))
        XCTAssertEqual(fields["planActive"], .bool(true))
        XCTAssertEqual(fields["modelPreference"], .string("deepseek-chat"))
        XCTAssertEqual(fields["provenance"], .object([
            "deviceId": .string("dev-phone"),
            "platform": .string("ios"),
            "at": .number(1_782_000_000_000),
        ]))
        XCTAssertEqual(fields["recentContext"], .array([
            .object(["role": .string("user"), "text": .string("帮我跑一遍测试")]),
            .object(["role": .string("assistant"), "text": .string("需要宿主。")]),
        ]))
        XCTAssertEqual(fields["todo"], .array([
            .object(["content": .string("在宿主继续执行测试"), "status": .string("pending")]),
        ]))
        XCTAssertEqual(fields["artifactRefs"], .array([
            .object([
                "id": .string("art-lite-1"),
                "kind": .string("report"),
                "title": .string("本机报告"),
                "status": .string("ready"),
            ]),
        ]))
    }

    func testOmitsModelPreferenceWhenUnknown() throws {
        let snapshot = SessionHandoff.snapshotValue(
            sourceSessionId: "lite-1",
            capability: "workflow",
            provenance: HandoffProvenance(deviceId: "dev-pad", platform: "ios", at: 1),
            recentContext: [],
            planActive: false,
            todo: [],
            artifactRefs: []
        )
        guard case let .object(fields) = snapshot else {
            return XCTFail("snapshot is not an object")
        }
        XCTAssertNil(fields["modelPreference"])
        XCTAssertEqual(fields["recentContext"], .array([]))
    }

    func testSendsAndReadsTheNewSessionId() async throws {
        var seen: (method: String, hasSnapshot: Bool)?
        let call: SessionHandoff.Call = { method, args in
            seen = (method, args["request"] != nil)
            return .object(["sessionId": .string("session-hnd-1")])
        }
        let snapshot = SessionHandoff.snapshotValue(
            sourceSessionId: "lite-1",
            capability: "run_tests",
            provenance: HandoffProvenance(deviceId: "dev-phone", platform: "ios", at: 1),
            recentContext: [],
            planActive: false,
            todo: [],
            artifactRefs: []
        )
        let sessionId = await SessionHandoff.send(call, snapshot: snapshot)
        XCTAssertEqual(sessionId, "session-hnd-1")
        XCTAssertEqual(seen?.method, "session/handoff")
        XCTAssertEqual(seen?.hasSnapshot, true)
    }

    func testRefusalAndMissingAnswerReadAsNil() async throws {
        let refused: SessionHandoff.Call = { _, _ in
            throw LinkClientError.refused(code: "role", message: "observer may not hand off")
        }
        let refusedId = await SessionHandoff.send(refused, snapshot: .object([:]))
        XCTAssertNil(refusedId)

        let empty: SessionHandoff.Call = { _, _ in .object([:]) }
        let emptyId = await SessionHandoff.send(empty, snapshot: .object([:]))
        XCTAssertNil(emptyId)
    }
}
