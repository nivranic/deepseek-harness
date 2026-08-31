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
        case flushThenLive(RelayEnvelope, RelayEnvelope, release: DispatchSemaphore)
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

    private func chunk(_ envelope: RelayEnvelope) -> Data {
        let line = (try? String(data: JSONEncoder().encode(envelope), encoding: .utf8)) ?? "{}"
        let payload = line + "\n"
        return Data("\(String(payload.utf8.count, radix: 16))\r\n\(payload)\r\n".utf8)
    }

    private func send(_ connection: NWConnection, _ data: Data, then: @escaping () -> Void) {
        connection.send(content: data, completion: .contentProcessed { _ in then() })
    }
}

/// The HTTP consumer's push stream against a real local server: connect
/// flushes, then live lines arrive; a clean close finishes the stream.
final class RelayClientStreamTests: XCTestCase {
    private struct StreamTestTimeout: Error {}

    /// Bounds one async pull so a stuck server fails the test instead of
    /// hanging the lane.
    private func withTestTimeout<T>(_ pull: () async throws -> T) async throws -> T {
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

    func testStreamFlushesOnConnectThenPushesTheLiveLine() async throws {
        let release = DispatchSemaphore(value: 0)
        let server = try RelayHTTPServer(script: .flushThenLive(
            RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1"),
            RelayEnvelope(kind: "task-completed", sessionId: "s1", turn: 3),
            release: release
        ))
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        var envelopes = client.stream(token: "rt-acct-phone").makeAsyncIterator()
        let first = try await withTestTimeout { try await envelopes.next() }
        XCTAssertEqual(first, RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1"))
        release.signal()
        let second = try await withTestTimeout { try await envelopes.next() }
        XCTAssertEqual(second, RelayEnvelope(kind: "task-completed", sessionId: "s1", turn: 3))
    }

    func testUnknownTokenStreamsACleanEmptyClose() async throws {
        let server = try RelayHTTPServer(script: .emptyClose)
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        var envelopes = client.stream(token: "rt-none").makeAsyncIterator()
        let first = try await withTestTimeout { try await envelopes.next() }
        XCTAssertNil(first)
    }

    func testRefusedStreamsFailLoud() async throws {
        let server = try RelayHTTPServer(script: .status(500))
        try server.start()
        defer { server.stop() }
        let client = RelayClient(endpoint: URL(string: "http://127.0.0.1:\(server.port)")!)

        var envelopes = client.stream(token: "rt-acct-phone").makeAsyncIterator()
        do {
            _ = try await withTestTimeout { try await envelopes.next() }
            XCTFail("expected the refusal to surface")
        } catch let error as RelayClientError {
            XCTAssertEqual(error, .http(500))
        }
    }
}
