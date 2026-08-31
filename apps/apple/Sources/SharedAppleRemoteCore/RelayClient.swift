import Foundation

/// Why a relay call failed, in one closed vocabulary: the service answered
/// over HTTP but refused the request.
public enum RelayClientError: Error, Equatable {
    case http(Int)
}

/// The relay's HTTP consumer (chapters 68/69): registers a device,
/// publishes reference envelopes, drains pending ones by poll, and holds
/// the push stream open — connect flushes the pending queue, then live
/// envelopes arrive as NDJSON lines, replacing poll for a connected
/// device. The LAN-direct link stays the primary transport; the relay is
/// the rendezvous path, and APNs/FCM delivery will extend it with a
/// push-token step.
public final class RelayClient: @unchecked Sendable {
    private let endpoint: URL
    private let session: URLSession

    /// - Parameters:
    ///   - endpoint: the relay service base URL.
    ///   - session: the URL session serving the calls.
    public init(endpoint: URL, session: URLSession = .shared) {
        self.endpoint = endpoint
        self.session = session
    }

    /// Register one device at the rendezvous service.
    /// - Parameter device: the device identity and its push-token slot.
    /// - Returns: the rendezvous token polling and streaming require.
    /// - Throws on transport failure, a non-2xx answer, or a body without
    ///   a string token.
    public func register(_ device: RelayDevice) async throws -> String {
        struct Reply: Decodable { let token: String }
        return try await decode(Reply.self, request: post("/relay/register", body: device)).token
    }

    /// Publish one reference envelope to an account's devices.
    /// - Parameters:
    ///   - accountId: the account whose devices receive the envelope.
    ///   - envelope: the minimized, reference-only payload.
    /// - Returns: how many devices the envelope reached.
    /// - Throws on transport failure or a non-2xx answer.
    public func publish(accountId: String, envelope: RelayEnvelope) async throws -> Int {
        struct Body: Encodable {
            let accountId: String
            let kind: String
            let sessionId: String
            let eventId: String?
            let turn: Int?
        }
        struct Reply: Decodable { let delivered: Int }
        let body = Body(
            accountId: accountId,
            kind: envelope.kind,
            sessionId: envelope.sessionId,
            eventId: envelope.eventId,
            turn: envelope.turn
        )
        return try await decode(Reply.self, request: post("/relay/publish", body: body)).delivered
    }

    /// Drain the device's pending envelopes in arrival order.
    /// - Parameter token: the rendezvous token from registration.
    /// - Returns: the forwarded envelopes, oldest first.
    /// - Throws on transport failure or a non-2xx answer.
    public func poll(token: String) async throws -> [RelayEnvelope] {
        try await decode([RelayEnvelope].self, request: URLRequest(url: route("/relay/poll", query: ["token": token])))
    }

    /// Hold the push stream open: connect flushes the pending queue as its
    /// first lines, then every live publish to this device arrives as one
    /// NDJSON line; the stream finishes when the service closes it.
    /// - Parameter token: the rendezvous token from registration.
    /// - Returns: the forwarded envelopes, oldest first, unbounded in time.
    public func stream(token: String) -> AsyncThrowingStream<RelayEnvelope, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: URLRequest(url: route("/relay/stream", query: ["token": token])))
                    try check(response)
                    for try await line in bytes.lines {
                        guard !line.trimmingCharacters(in: .whitespaces).isEmpty,
                              let data = line.data(using: .utf8) else { continue }
                        continuation.yield(try JSONDecoder().decode(RelayEnvelope.self, from: data))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func route(_ path: String, query: [String: String] = [:]) -> URL {
        var components = URLComponents(url: endpoint.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url!
    }

    private func post<B: Encodable>(_ path: String, body: B) throws -> URLRequest {
        var request = URLRequest(url: route(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private func decode<R: Decodable>(_ type: R.Type, request: URLRequest) async throws -> R {
        let (data, response) = try await session.data(for: request)
        try check(response)
        return try JSONDecoder().decode(type, from: data)
    }

    private func check(_ response: URLResponse) throws {
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw RelayClientError.http(http.statusCode)
        }
    }
}
