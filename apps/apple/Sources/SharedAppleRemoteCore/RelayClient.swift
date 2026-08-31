import Foundation

/// Why a relay call failed, in one closed vocabulary: the service answered
/// over HTTP but refused the request.
public enum RelayClientError: Error, Equatable {
    case http(Int)
}

/// One device's roster entry with its stream-derived online state.
public struct RelayPresence: Equatable, Sendable, Codable {
    public let deviceId: String
    public let platform: String
    public let online: Bool

    /// - Parameters:
    ///   - deviceId: the registered device's identity.
    ///   - platform: the registered device's platform tag.
    ///   - online: whether the device holds an open stream.
    public init(deviceId: String, platform: String, online: Bool) {
        self.deviceId = deviceId
        self.platform = platform
        self.online = online
    }
}

/// One push-stream line: a reference envelope, or a same-account device's
/// presence change.
public enum RelayStreamEvent: Equatable, Sendable {
    case envelope(RelayEnvelope)
    case presence(deviceId: String, online: Bool)
}

/// The relay's HTTP consumer (chapters 68/69): registers a device,
/// publishes reference envelopes, drains pending ones by poll, holds the
/// push stream open (connect flushes the pending queue, then reference
/// envelopes and same-account presence changes arrive as NDJSON lines,
/// replacing poll for a connected device), and answers the account
/// roster's online state. The LAN-direct link stays the primary transport;
/// the relay is the rendezvous path, and APNs/FCM delivery will extend it
/// with a push-token step.
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
    /// first lines, then every live publish to this device and every
    /// same-account device's presence change arrives as one NDJSON line;
    /// the stream finishes when the service closes it.
    /// - Parameter token: the rendezvous token from registration.
    /// - Returns: the stream events, oldest first, unbounded in time.
    public func stream(token: String) -> AsyncThrowingStream<RelayStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: URLRequest(url: route("/relay/stream", query: ["token": token])))
                    try check(response)
                    let decoder = JSONDecoder()
                    for try await line in bytes.lines {
                        guard !line.trimmingCharacters(in: .whitespaces).isEmpty,
                              let data = line.data(using: .utf8) else { continue }
                        continuation.yield(try Self.parseStreamEvent(from: data, decoder: decoder))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The account roster with each device's stream-derived online state.
    /// - Parameter accountId: the account whose devices are listed.
    /// - Returns: the registered devices, in registration order; an
    ///   unknown account lists nothing.
    /// - Throws on transport failure or a non-2xx answer.
    public func presence(accountId: String) async throws -> [RelayPresence] {
        try await decode([RelayPresence].self, request: URLRequest(url: route("/relay/presence", query: ["accountId": accountId])))
    }

    /// One decoded stream line: a `type: presence` object is a presence
    /// change, any other object is a reference envelope.
    private static func parseStreamEvent(from data: Data, decoder: JSONDecoder) throws -> RelayStreamEvent {
        struct Line: Decodable {
            let type: String?
            let deviceId: String?
            let online: Bool?
            let kind: String?
            let sessionId: String?
            let eventId: String?
            let turn: Int?
        }
        let line = try decoder.decode(Line.self, from: data)
        if line.type == "presence" {
            guard let deviceId = line.deviceId else {
                throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "presence event missing deviceId"))
            }
            return .presence(deviceId: deviceId, online: line.online ?? false)
        }
        return .envelope(RelayEnvelope(kind: line.kind ?? "", sessionId: line.sessionId ?? "", eventId: line.eventId, turn: line.turn))
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
