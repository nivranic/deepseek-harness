import Foundation
import Network
import XCTest
@testable import SharedAppleRemoteCore

private func hex(_ bytes: [UInt8]) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
}

private func unhex(_ value: String) -> [UInt8] {
    var bytes: [UInt8] = []
    var index = value.startIndex
    while index < value.endIndex {
        let next = value.index(after: index)
        bytes.append(UInt8(value[index...next], radix: 16)!)
        index = value.index(after: next)
    }
    return bytes
}

private func vectors() throws -> [String: Any] {
    let url = URL(fileURLWithPath: #filePath, isDirectory: false)
        .deletingLastPathComponent()
        .appendingPathComponent("Fixtures/relay-noise-vectors.json", isDirectory: false)
    return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
}

private func pinnedHandshake(_ role: NoiseHandshake.Role) throws -> NoiseHandshake {
    let keys = try vectors()["keys"] as! [String: String]
    let prefix = role == .initiator ? "initiator" : "responder"
    return try NoiseHandshake(
        role: role,
        staticScalar: unhex(keys["\(prefix)Static"]!),
        ephemeralScalar: unhex(keys["\(prefix)Ephemeral"]!)
    )
}

/// The Noise_XX stack against the fixed-key vectors the node reference
/// implementation (apps/relay/noise.mjs) generated: every port must
/// reproduce the handshake bytes, session id, channel binding, split keys,
/// and transport frames exactly — that byte-level agreement is the
/// cross-implementation interop proof, since no CI lane runs the node
/// service itself.
final class NoiseVectorTests: XCTestCase {
    func testReproducesTheHandshakeBytesSessionIdAndChannelBinding() throws {
        let section = try vectors()["handshake"] as! [String: String]
        let alice = try pinnedHandshake(.initiator)
        let bob = try pinnedHandshake(.responder)
        let msg1 = try alice.writeMessage1()
        XCTAssertEqual(hex(msg1), section["msg1"], "msg1 bytes")
        try bob.readMessage1(msg1)
        let msg2 = try bob.writeMessage2()
        XCTAssertEqual(hex(msg2), section["msg2"], "msg2 bytes")
        try alice.readMessage2(msg2)
        XCTAssertEqual(hex(alice.transcriptHash), section["sessionIdAfterMsg2"], "session id after msg2")
        let msg3 = try alice.writeMessage3()
        XCTAssertEqual(hex(msg3), section["msg3"], "msg3 bytes")
        try bob.readMessage3(msg3)
        XCTAssertEqual(hex(alice.transcriptHash), section["channelBindingAfterMsg3"], "channel binding")
        XCTAssertEqual(hex(bob.transcriptHash), hex(alice.transcriptHash), "both roles agree")
    }

    func testSplitsTheReferenceTrafficKeysAndRoundTripsEveryFrame() throws {
        let section = try vectors()["transport"] as! [String: Any]
        let alice = try pinnedHandshake(.initiator)
        let bob = try pinnedHandshake(.responder)
        try bob.readMessage1(try alice.writeMessage1())
        try alice.readMessage2(try bob.writeMessage2())
        try bob.readMessage3(try alice.writeMessage3())
        let aliceSide = try alice.split()
        let bobSide = try bob.split()
        XCTAssertEqual(hex([UInt8](aliceSide.send.keyData)), section["c1Key"] as! String, "c1 key")
        XCTAssertEqual(hex([UInt8](aliceSide.recv.keyData)), section["c2Key"] as! String, "c2 key")
        for entry in section["c1Frames"] as! [[String: String]] {
            let payload = unhex(entry["payload"]!)
            let sealed = unhex(entry["frame"]!)
            XCTAssertEqual(hex(try aliceSide.send.encryptWithAd([], payload)), entry["frame"], "c1 frame seals identically")
            XCTAssertEqual(try bobSide.recv.decryptWithAd([], sealed), payload, "c1 frame opens")
        }
        for entry in section["c2Frames"] as! [[String: String]] {
            let payload = unhex(entry["payload"]!)
            let sealed = unhex(entry["frame"]!)
            XCTAssertEqual(hex(try bobSide.send.encryptWithAd([], payload)), entry["frame"], "c2 frame seals identically")
            XCTAssertEqual(try aliceSide.recv.decryptWithAd([], sealed), payload, "c2 frame opens")
        }
    }

    func testRejectsTamperedFramesAndTruncatedFraming() throws {
        let section = try vectors()["transport"] as! [String: Any]
        let alice = try pinnedHandshake(.initiator)
        let bob = try pinnedHandshake(.responder)
        try bob.readMessage1(try alice.writeMessage1())
        try alice.readMessage2(try bob.writeMessage2())
        try bob.readMessage3(try alice.writeMessage3())
        var tampered = unhex((section["c1Frames"] as! [[String: String]])[0]["frame"]!)
        tampered[0] ^= 1
        XCTAssertThrowsError(try bob.split().recv.decryptWithAd([], tampered))
        XCTAssertThrowsError(try decodeNoiseFrames([0, 4, 9]))
        let framing = try vectors()["framing"] as! [String: String]
        XCTAssertEqual(encodeNoiseFrame(Array(0..<16).map { UInt8($0) }), unhex(framing["single"]!))
    }
}

/// A real local HTTP/1.1 server over a TCP listener running the Noise
/// responder side of the relay protocol: it parses enough of each request
/// to route by path and headers, completes the XX handshake, decrypts
/// framed bodies, and answers framed AEAD responses; the push stream
/// writes chunked frames and holds open until `releaseStream()`. Two
/// corruption switches let the failure paths be pinned.
final class NoiseRelayServer {
    /// Answer hello with a session id unrelated to the transcript.
    var corruptSessionHeader = false
    /// Seal the complete ack under an unrelated handshake's keys.
    var sealAckWithStrangerKeys = false

    private let listener: NWListener
    private let queue = DispatchQueue(label: "noise-relay-test-server")
    private var pendingHandshakes: [String: NoiseHandshake] = [:]
    private var sessions: [String: (send: NoiseCipherState, recv: NoiseCipherState)] = [:]
    private var devices: [(token: String, accountId: String, deviceId: String, platform: String)] = []
    private var queues: [String: [[UInt8]]] = [:]
    private var stream: (write: ([UInt8]) -> Void, state: NoiseCipherState, hold: DispatchSemaphore)?

    /// - Throws when the listener cannot be created.
    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
    }

    /// Start listening; returns once the assigned port is live.
    func start() throws {
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.signal() }
            if case .failed = state { ready.signal() }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        guard ready.wait(timeout: .now() + 5) == .success, listener.port != nil else {
            throw NSError(
                domain: "noise-relay-test-server", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "listener never became ready"]
            )
        }
    }

    func stop() {
        releaseStream()
        listener.cancel()
    }

    var port: UInt16 { listener.port?.rawValue ?? 0 }

    /// Let the held-open stream finish (its terminating chunk ends the flow).
    func releaseStream() {
        stream?.hold.signal()
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        readRequest(connection, accumulated: Data())
    }

    /// Accumulate bytes until one full request (head + content-length body).
    private func readRequest(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, error in
            guard let self, error == nil, let data else { return }
            let buffer = accumulated + data
            guard let headEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                self.readRequest(connection, accumulated: buffer)
                return
            }
            let head = String(decoding: buffer[buffer.startIndex..<headEnd.lowerBound], as: UTF8.self)
            let lines = head.components(separatedBy: "\r\n")
            var contentLength = 0
            var headers: [String: String] = [:]
            for line in lines.dropFirst() {
                let parts = line.split(separator: ":", maxSplits: 1)
                guard parts.count == 2 else { continue }
                headers[parts[0].lowercased()] = parts[1].trimmingCharacters(in: .whitespaces)
                if parts[0].lowercased() == "content-length" {
                    contentLength = Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
                }
            }
            let bodyStart = headEnd.upperBound
            guard buffer.distance(from: bodyStart, to: buffer.endIndex) >= contentLength else {
                self.readRequest(connection, accumulated: buffer)
                return
            }
            let body = [UInt8](buffer[bodyStart..<buffer.index(bodyStart, offsetBy: contentLength)])
            let requestLine = lines.first ?? ""
            let fields = requestLine.components(separatedBy: " ")
            let path = fields.count >= 2 ? URLComponents(string: fields[1])?.path ?? "" : ""
            self.route(path: path, headers: headers, body: body, connection: connection)
        }
    }

    private func route(path: String, headers: [String: String], body: [UInt8], connection: NWConnection) {
        do {
            switch path {
            case "/relay/noise/hello":
                let handshake = try NoiseHandshake(role: .responder)
                try handshake.readMessage1(body)
                let message = try handshake.writeMessage2()
                let id = hex(handshake.transcriptHash)
                pendingHandshakes[id] = handshake
                let answered = corruptSessionHeader ? "deadbeef" : id
                respond(connection, status: 200, body: Data(message), headers: ["x-relay-session": answered])
            case "/relay/noise/complete":
                guard let id = headers["x-relay-session"], let handshake = pendingHandshakes.removeValue(forKey: id) else {
                    respond(connection, status: 410, body: Data("{\"error\":\"unknown relay session\"}".utf8))
                    return
                }
                if sealAckWithStrangerKeys {
                    let stranger = try NoiseHandshake(role: .responder)
                    try stranger.readMessage1([UInt8](repeating: 0, count: 32))
                    respond(connection, status: 200, body: Data(encodeNoiseFrame(try stranger.split().send.encryptWithAd([], Array("{\"ok\":true}".utf8)))))
                    return
                }
                try handshake.readMessage3(body)
                let split = try handshake.split()
                sessions[id] = split
                respond(connection, status: 200, body: Data(encodeNoiseFrame(try split.send.encryptWithAd([], Array("{\"ok\":true}".utf8)))))
            case "/relay/register":
                let opened = try openSession(headers: headers, body: body, connection: connection)
                let request = opened.request
                let token = "rt-\(request["accountId"] as! String)-\(request["deviceId"] as! String)"
                devices.append((token, request["accountId"] as! String, request["deviceId"] as! String, request["platform"] as? String ?? ""))
                queues[token] = []
                respondEncrypted(connection, session: opened.session, value: "{\"token\":\"\(token)\"}")
            case "/relay/publish":
                let opened = try openSession(headers: headers, body: body, connection: connection)
                let accountId = opened.request["accountId"] as! String
                let envelope = opened.request.filter { $0.key != "accountId" }
                let json = try! JSONSerialization.data(withJSONObject: envelope)
                var delivered = 0
                for device in devices where device.accountId == accountId {
                    if let stream {
                        stream.write(try stream.state.encryptWithAd([], [UInt8](json)))
                    } else {
                        queues[device.token]?.append([UInt8](json))
                    }
                    delivered += 1
                }
                respondEncrypted(connection, session: opened.session, value: "{\"delivered\":\(delivered)}")
            case "/relay/poll":
                let opened = try openSession(headers: headers, body: body, connection: connection)
                let token = opened.request["token"] as! String
                let queued = queues.removeValue(forKey: token) ?? []
                let bodyOut = queued.map { encodeNoiseFrame(try opened.session.send.encryptWithAd([], $0)) }.reduce([], +)
                respond(connection, status: 200, body: Data(bodyOut))
            case "/relay/presence":
                let opened = try openSession(headers: headers, body: body, connection: connection)
                let accountId = opened.request["accountId"] as! String
                let roster = devices
                    .filter { $0.accountId == accountId }
                    .map { "{\"deviceId\":\"\($0.deviceId)\",\"platform\":\"\($0.platform)\",\"online\":false}" }
                    .joined(separator: ",")
                respondEncrypted(connection, session: opened.session, value: "[\(roster)]")
            case "/relay/stream":
                try streamRoute(headers: headers, body: body, connection: connection)
            default:
                respond(connection, status: 404, body: Data())
            }
        } catch {
            respond(connection, status: 400, body: Data())
        }
    }

    private func streamRoute(headers: [String: String], body: [UInt8], connection: NWConnection) throws {
        let opened = try openSession(headers: headers, body: body, connection: connection)
        let token = opened.request["token"] as! String
        let state = NoiseCipherState(key: unhex(opened.request["streamKey"] as! String))
        let queued = queues.removeValue(forKey: token) ?? []
        let head = "HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n"
        send(connection, Data(head.utf8)) {
            for envelope in queued {
                self.writeChunk(connection, try! state.encryptWithAd([], envelope))
            }
            self.establishStream(connection: connection, state: state)
        }
    }

    /// Store the live writer and hold the stream open until release.
    private func establishStream(connection: NWConnection, state: NoiseCipherState) {
        let hold = DispatchSemaphore(value: 0)
        stream = (
            write: { ciphertext in
                self.writeChunk(connection, ciphertext)
            },
            state: state,
            hold: hold
        )
        // Waiting must leave this serial queue free for live publishes; the
        // terminating chunk rides the release.
        DispatchQueue.global().async {
            _ = hold.wait(timeout: .now() + 10)
            self.queue.async {
                self.send(connection, Data("0\r\n\r\n".utf8)) { connection.cancel() }
            }
        }
    }

    /// One chunked-transfer piece carrying one framed ciphertext.
    private func writeChunk(_ connection: NWConnection, _ ciphertext: [UInt8]) {
        let framed = encodeNoiseFrame(ciphertext)
        let head = "\(String(framed.count, radix: 16))\r\n"
        send(connection, Data(head.utf8)) {
            self.send(connection, Data(framed)) {
                self.send(connection, Data("\r\n".utf8)) {}
            }
        }
    }

    /// The session + decrypted request JSON, or a 410 reply and throw.
    private func openSession(headers: [String: String], body: [UInt8], connection: NWConnection) throws -> (session: (send: NoiseCipherState, recv: NoiseCipherState), request: [String: Any]) {
        guard let id = headers["x-relay-session"], let session = sessions[id] else {
            respond(connection, status: 410, body: Data("{\"error\":\"unknown relay session\"}".utf8))
            throw RelayClientError.http(410)
        }
        let frames = try decodeNoiseFrames(body)
        let payload = try session.recv.decryptWithAd([], frames[0])
        return (session, try JSONSerialization.jsonObject(with: Data(payload)) as! [String: Any])
    }

    private func respondEncrypted(_ connection: NWConnection, session: (send: NoiseCipherState, recv: NoiseCipherState), value: String) {
        respond(connection, status: 200, body: Data(encodeNoiseFrame(try! session.send.encryptWithAd([], Array(value.utf8)))))
    }

    private func respond(_ connection: NWConnection, status: Int, body: Data, headers: [String: String] = [:]) {
        var head = "HTTP/1.1 \(status) Answer\r\ncontent-type: application/octet-stream\r\ncontent-length: \(body.count)\r\nconnection: close\r\n"
        for (name, value) in headers {
            head += "\(name): \(value)\r\n"
        }
        head += "\r\n"
        send(connection, Data(head.utf8)) {
            self.send(connection, body) { connection.cancel() }
        }
    }

    private func send(_ connection: NWConnection, _ data: Data, then: @escaping () -> Void) {
        connection.send(content: data, completion: .contentProcessed { _ in then() })
    }
}

/// The Noise-encrypted relay consumer against the real local responder:
/// handshake, register, publish, poll, presence, and the push stream ride
/// framed AEAD bodies over real sockets; the two corruption switches pin
/// the failure paths.
final class RelayClientNoiseTests: XCTestCase {
    private struct TestTimeout: Error {}

    /// Bounds one async pull so a stuck server fails the test instead of
    /// hanging the lane.
    private func withTestTimeout<T>(_ pull: @escaping () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await pull() }
            group.addTask {
                try await Task.sleep(nanoseconds: 10_000_000_000)
                throw TestTimeout()
            }
            let value = try await group.next()!
            group.cancelAll()
            return value
        }
    }

    func testHandshakesRegistersPublishesPollsAndAnswersPresence() async throws {
        let server = try NoiseRelayServer()
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        let token = try await withTestTimeout { try await client.register(RelayDevice(accountId: "acct", deviceId: "phone", platform: "android")) }
        XCTAssertEqual(token, "rt-acct-phone")
        _ = try await withTestTimeout {
            try await client.publish(accountId: "acct", envelope: RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1"))
        }
        let polled = try await withTestTimeout { try await client.poll(token: token) }
        XCTAssertEqual(polled, [RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1")])
        let roster = try await withTestTimeout { try await client.presence(accountId: "acct") }
        XCTAssertEqual(roster, [RelayPresence(deviceId: "phone", platform: "android", online: false)])
    }

    func testStreamFlushesTheQueueThenDeliversLivePublishes() async throws {
        let server = try NoiseRelayServer()
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)
        let token = try await withTestTimeout { try await client.register(RelayDevice(accountId: "acct", deviceId: "phone", platform: "android")) }
        _ = try await withTestTimeout {
            try await client.publish(accountId: "acct", envelope: RelayEnvelope(kind: "task-completed", sessionId: "s1", turn: 3))
        }

        var events = client.stream(token: token).makeAsyncIterator()
        let first = try await withTestTimeout { try await events.next() }
        XCTAssertEqual(first, .envelope(RelayEnvelope(kind: "task-completed", sessionId: "s1", turn: 3)))
        _ = try await withTestTimeout {
            try await client.publish(accountId: "acct", envelope: RelayEnvelope(kind: "question-waiting", sessionId: "s9", eventId: "e2"))
        }
        let second = try await withTestTimeout { try await events.next() }
        XCTAssertEqual(second, .envelope(RelayEnvelope(kind: "question-waiting", sessionId: "s9", eventId: "e2")))
        server.releaseStream()
        let end = try await withTestTimeout { try await events.next() }
        XCTAssertNil(end)
    }

    func testASessionIdMismatchFailsLoud() async throws {
        let server = try NoiseRelayServer()
        server.corruptSessionHeader = true
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        do {
            _ = try await withTestTimeout { try await client.register(RelayDevice(accountId: "acct", deviceId: "phone", platform: "android")) }
            XCTFail("expected the mismatched session id to surface")
        } catch let error as DecodingError {
            // The wire boundary refuses a session id it cannot bind.
        }
    }

    func testABrokenAckFailsKeyConfirmation() async throws {
        let server = try NoiseRelayServer()
        server.sealAckWithStrangerKeys = true
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        do {
            _ = try await withTestTimeout { try await client.register(RelayDevice(accountId: "acct", deviceId: "phone", platform: "android")) }
            XCTFail("expected the broken ack to surface")
        } catch {
            // Key confirmation refuses an ack sealed under stranger keys.
        }
    }
}
