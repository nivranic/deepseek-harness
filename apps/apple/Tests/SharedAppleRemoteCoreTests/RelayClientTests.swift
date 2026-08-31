import Network
import XCTest
@testable import SharedAppleRemoteCore

/// A minimal real HTTP/1.1 server over a TCP listener, serving one
/// scripted answer per test: the push-stream tests need a live socket
/// whose body bytes arrive incrementally, which URLProtocol stubs cannot
/// provide. Requests are not parsed beyond arrival; the script owns the
/// answer.
final class RelayHTTPServer {
    enum Script {
        /// Write one NDJSON line immediately, hold the stream open until
        /// `release` fires, then write the second line and close cleanly.
        case flushThenLive(String, String, release: DispatchSemaphore)
        /// Write every NDJSON line immediately, then close cleanly.
        case lines([String])
        /// Answer 200 with one fixed-length JSON body.
        case jsonBody(String)
        /// Answer 200 with zero lines and a clean close.
        case emptyClose
        /// Answer one bare status with no body.
        case status(Int)
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "relay-http-test-server")
    private var connection: NWConnection?
    let script: Script

    /// - Parameter script: the answer this server serves.
    init(script: Script) throws {
        self.script = script
        listener = try NWListener(using: .tcp, on: .any)
    }

    /// Start listening; returns once the assigned port is live.
    /// - Throws when the listener never reaches the ready state.
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
                domain: "relay-http-test-server", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "listener never became ready"]
            )
        }
    }

    func stop() {
        listener.cancel()
        connection?.cancel()
    }

    var port: UInt16 { listener.port?.rawValue ?? 0 }

    private func accept(_ connection: NWConnection) {
        self.connection = connection
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] _, _, _, error in
            // The request head has arrived in one local segment; the
            // script answers now without parsing it.
            guard error == nil else { return }
            self?.answer(connection)
        }
    }

    private func answer(_ connection: NWConnection) {
        switch script {
        case let .flushThenLive(first, second, release):
            send(connection, chunkedHead()) {
                self.send(connection, self.chunk(first)) {
                    release.wait()
                    self.send(connection, self.chunk(second)) {
                        self.send(connection, Data("0\r\n\r\n".utf8)) { connection.cancel() }
                    }
                }
            }
        case let .lines(lines):
            send(connection, chunkedHead()) {
                for line in lines { self.send(connection, self.chunk(line)) {} }
                self.send(connection, Data("0\r\n\r\n".utf8)) { connection.cancel() }
            }
        case let .jsonBody(body):
            let bytes = Data(body.utf8)
            let head = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: \(bytes.count)\r\nconnection: close\r\n\r\n"
            send(connection, Data(head.utf8)) {
                self.send(connection, bytes) { connection.cancel() }
            }
        case .emptyClose:
            send(connection, chunkedHead()) {
                self.send(connection, Data("0\r\n\r\n".utf8)) { connection.cancel() }
            }
        case let .status(code):
            let head = "HTTP/1.1 \(code) Refused\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            send(connection, Data(head.utf8)) { connection.cancel() }
        }
    }

    private func chunkedHead() -> Data {
        let head = "HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n"
        return Data(head.utf8)
    }

    private func chunk(_ line: String) -> Data {
        let payload = line + "\n"
        return Data("\(String(payload.utf8.count, radix: 16))\r\n\(payload)\r\n".utf8)
    }

    private func send(_ connection: NWConnection, _ data: Data, then: @escaping () -> Void) {
        connection.send(content: data, completion: .contentProcessed { _ in then() })
    }
}

/// The HTTP consumer's push stream and presence against a real local
/// server: connect flushes, then live lines arrive; a clean close finishes
/// the stream.
final class RelayClientStreamTests: XCTestCase {
    private struct StreamTestTimeout: Error {}

    /// Bounds one async pull so a stuck server fails the test instead of
    /// hanging the lane.
    private func withTestTimeout<T>(_ pull: @escaping () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await pull() }
            group.addTask {
                try await Task.sleep(nanoseconds: 10_000_000_000)
                throw StreamTestTimeout()
            }
            let value = try await group.next()!
            group.cancelAll()
            return value
        }
    }

    /// One bare envelope line exactly as the wire writes it (optional keys
    /// omitted), for scripting stream bodies.
    private func envelopeLine(_ envelope: RelayEnvelope) throws -> String {
        try String(decoding: JSONEncoder().encode(envelope), as: UTF8.self)
    }

    func testStreamFlushesOnConnectThenPushesTheLiveLine() async throws {
        let release = DispatchSemaphore(value: 0)
        let firstEnvelope = RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1")
        let secondEnvelope = RelayEnvelope(kind: "task-completed", sessionId: "s1", turn: 3)
        let server = try RelayHTTPServer(script: .flushThenLive(
            envelopeLine(firstEnvelope),
            envelopeLine(secondEnvelope),
            release: release
        ))
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        var events = client.stream(token: "rt-acct-phone").makeAsyncIterator()
        let first = try await withTestTimeout { try await events.next() }
        XCTAssertEqual(first, .envelope(firstEnvelope))
        release.signal()
        let second = try await withTestTimeout { try await events.next() }
        XCTAssertEqual(second, .envelope(secondEnvelope))
    }

    func testPresenceLinesDecodeAsSameAccountPresenceEvents() async throws {
        let envelope = RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1")
        let server = try RelayHTTPServer(script: .lines([
            envelopeLine(envelope),
            "{\"type\":\"presence\",\"deviceId\":\"pad\",\"online\":true}",
            "{\"type\":\"presence\",\"deviceId\":\"pad\",\"online\":false}",
        ]))
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        var events = client.stream(token: "rt-acct-phone").makeAsyncIterator()
        let first = try await withTestTimeout { try await events.next() }
        XCTAssertEqual(first, .envelope(envelope))
        let online = try await withTestTimeout { try await events.next() }
        XCTAssertEqual(online, .presence(deviceId: "pad", online: true))
        let offline = try await withTestTimeout { try await events.next() }
        XCTAssertEqual(offline, .presence(deviceId: "pad", online: false))
        let end = try await withTestTimeout { try await events.next() }
        XCTAssertNil(end)
    }

    func testMalformedPresenceLinesFailLoud() async throws {
        let server = try RelayHTTPServer(script: .lines([
            "{\"type\":\"presence\",\"online\":true}",
        ]))
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        var events = client.stream(token: "rt-acct-phone").makeAsyncIterator()
        do {
            _ = try await withTestTimeout { try await events.next() }
            XCTFail("expected the malformed presence line to surface")
        } catch is DecodingError {
            // The wire boundary refuses lines it cannot name.
        }
    }

    func testPresenceAnswersTheAccountRosterWithOnlineState() async throws {
        let body = "[{\"deviceId\":\"phone\",\"platform\":\"android\",\"online\":true},{\"deviceId\":\"pad\",\"platform\":\"ios\",\"online\":false}]"
        let server = try RelayHTTPServer(script: .jsonBody(body))
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        let roster = try await withTestTimeout { try await client.presence(accountId: "acct") }
        XCTAssertEqual(roster, [
            RelayPresence(deviceId: "phone", platform: "android", online: true),
            RelayPresence(deviceId: "pad", platform: "ios", online: false),
        ])
    }

    func testUnknownTokenStreamsACleanEmptyClose() async throws {
        let server = try RelayHTTPServer(script: .emptyClose)
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        var events = client.stream(token: "rt-none").makeAsyncIterator()
        let first = try await withTestTimeout { try await events.next() }
        XCTAssertNil(first)
    }

    func testRefusedStreamsFailLoud() async throws {
        let server = try RelayHTTPServer(script: .status(500))
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        var events = client.stream(token: "rt-acct-phone").makeAsyncIterator()
        do {
            _ = try await withTestTimeout { try await events.next() }
            XCTFail("expected the refusal to surface")
        } catch let error as RelayClientError {
            XCTAssertEqual(error, .http(500))
        }
    }
}
