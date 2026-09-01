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

/// One push-stream frame: a reference envelope, or a same-account device's
/// presence change.
public enum RelayStreamEvent: Equatable, Sendable {
    case envelope(RelayEnvelope)
    case presence(deviceId: String, online: Bool)
}

/// The relay's Noise-encrypted HTTP consumer (chapters 68/69): the client
/// completes one Noise_XX handshake lazily on the first call
/// (hello → verify the server-assigned session id equals our own transcript
/// hash → complete → consume the encrypted ack), then registers a device,
/// publishes reference envelopes, drains pending ones by poll, holds the
/// push stream open, and answers the account roster's online state — every
/// body a framed AEAD message under the split session keys. The stream
/// rides a one-time key the encrypted request carries, so live pushes
/// never share a counter with HTTP responses. The LAN-direct link stays
/// the primary transport; the relay is the rendezvous path, and APNs/FCM
/// delivery will extend it with a push-token step.
public final class RelayClient: @unchecked Sendable {
    private let transport: RelayTransport

    /// - Parameters:
    ///   - endpoint: the relay service base URL.
    ///   - session: the URL session serving the calls.
    public init(endpoint: URL, session: URLSession = .shared) {
        self.transport = RelayTransport(endpoint: endpoint, session: session)
    }

    /// Register one device at the rendezvous service.
    /// - Parameter device: the device identity and its push-token slot.
    /// - Returns: the rendezvous token polling and streaming require.
    /// - Throws on transport failure, a non-2xx answer, or a body without
    ///   a string token.
    public func register(_ device: RelayDevice) async throws -> String {
        struct Reply: Decodable { let token: String }
        let reply: Reply = try await transport.call(path: "/relay/register", body: device)
        return reply.token
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
        let reply: Reply = try await transport.call(
            path: "/relay/publish",
            body: Body(
                accountId: accountId,
                kind: envelope.kind,
                sessionId: envelope.sessionId,
                eventId: envelope.eventId,
                turn: envelope.turn
            ),
        )
        return reply.delivered
    }

    /// Drain the device's pending envelopes in arrival order.
    /// - Parameter token: the rendezvous token from registration.
    /// - Returns: the forwarded envelopes, oldest first.
    /// - Throws on transport failure or a non-2xx answer.
    public func poll(token: String) async throws -> [RelayEnvelope] {
        struct Body: Encodable { let token: String }
        let payloads = try await transport.callFrames(path: "/relay/poll", body: Body(token: token))
        return try payloads.map { try JSONDecoder().decode(RelayEnvelope.self, from: $0) }
    }

    /// Hold the push stream open: connect flushes the pending queue as its
    /// first frames, then every live publish to this device and every
    /// same-account device's presence change arrives as one encrypted frame;
    /// the stream finishes when the service closes it.
    /// - Parameter token: the rendezvous token from registration.
    /// - Returns: the stream events, oldest first, unbounded in time.
    public func stream(token: String) -> AsyncThrowingStream<RelayStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    // The stream rides its own one-time key so live pushes
                    // never share a counter with HTTP responses.
                    var streamKey = [UInt8](repeating: 0, count: 32)
                    let result = SecRandomCopyBytes(kSecRandomDefault, streamKey.count, &streamKey)
                    guard result == errSecSuccess else {
                        throw RelayClientError.http(-1)
                    }
                    struct Body: Encodable { let token: String; let streamKey: String }
                    let body = Body(token: token, streamKey: Self.hex(streamKey))
                    let decrypt = NoiseCipherState(key: streamKey)
                    let (bytes, response) = try await self.transport.openStream(path: "/relay/stream", body: body)
                    try RelayTransport.check(response)
                    var buffer: [UInt8] = []
                    var decoder = JSONDecoder()
                    for try await byte in bytes {
                        buffer.append(byte)
                        while let (frame, rest) = Self.takeFrame(buffer) {
                            buffer = rest
                            let event = try Self.parseStreamEvent(
                                from: Data(try decrypt.decryptWithAd([], frame)),
                                decoder: &decoder,
                            )
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The account roster with each stream-derived online state.
    /// - Parameter accountId: the account whose devices are listed.
    /// - Returns: the registered devices, in registration order; an
    ///   unknown account lists nothing.
    /// - Throws on transport failure or a non-2xx answer.
    public func presence(accountId: String) async throws -> [RelayPresence] {
        struct Body: Encodable { let accountId: String }
        let payloads = try await transport.callFrames(path: "/relay/presence", body: Body(accountId: accountId))
        return try payloads.map { try JSONDecoder().decode(RelayPresence.self, from: $0) }
    }

    /// One decoded stream frame: a `type: presence` object is a presence
    /// change, any other object is a reference envelope.
    private static func parseStreamEvent(from data: Data, decoder: inout JSONDecoder) throws -> RelayStreamEvent {
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

    /// Pull the first complete frame out of the buffer, or nil if none yet.
    private static func takeFrame(_ buffer: [UInt8]) -> ([UInt8], [UInt8])? {
        guard buffer.count >= 2 else { return nil }
        let length = (Int(buffer[0]) << 8) | Int(buffer[1])
        guard buffer.count >= 2 + length else { return nil }
        return (Array(buffer[2..<(2 + length)]), Array(buffer[(2 + length)...]))
    }

    private static func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }
}

/// The serialized Noise session one RelayClient owns: an actor so the
/// handshake and every counter advance happen without races.
private actor RelayTransport {
    private let endpoint: URL
    private let session: URLSession
    private var established: (id: String, send: NoiseCipherState, recv: NoiseCipherState)?

    init(endpoint: URL, session: URLSession) {
        self.endpoint = endpoint
        self.session = session
    }

    /// Complete the XX handshake and consume the encrypted ack, once.
    private func ensure() async throws -> (id: String, send: NoiseCipherState, recv: NoiseCipherState) {
        if let established { return established }
        let handshake = try NoiseHandshake(role: .initiator)
        let (helloBody, helloResponse) = try await post("/relay/noise/hello", sealed: try handshake.writeMessage1(), sessionHeader: nil)
        try Self.check(helloResponse)
        guard let id = (helloResponse as? HTTPURLResponse)?.value(forHTTPHeaderField: "x-relay-session") else {
            throw RelayClientError.http(-1)
        }
        try handshake.readMessage2([UInt8](helloBody))
        guard Self.hex(handshake.transcriptHash) == id else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "relay session id does not match the handshake transcript"))
        }
        let (completeBody, completeResponse) = try await post("/relay/noise/complete", sealed: try handshake.writeMessage3(), sessionHeader: id)
        try Self.check(completeResponse)
        let split = try handshake.split()
        let acks = try decodeNoiseFrames([UInt8](completeBody))
        guard acks.count == 1 else { throw RelayClientError.http(-1) }
        struct Ack: Decodable { let ok: Bool }
        guard try JSONDecoder().decode(Ack.self, from: Data(try split.recv.decryptWithAd([], acks[0]))).ok else {
            throw RelayClientError.http(-1)
        }
        let value = (id, split.send, split.recv)
        established = value
        return value
    }

    /// One framed encrypted request/response answered by one JSON value.
    func call<Body: Encodable, Value: Decodable>(path: String, body: Body) async throws -> Value {
        let payloads = try await callFrames(path: path, body: body)
        guard payloads.count == 1 else { throw RelayClientError.http(-1) }
        return try JSONDecoder().decode(Value.self, from: payloads[0])
    }

    /// One framed encrypted request answered by any number of frames.
    func callFrames<Body: Encodable>(path: String, body: Body) async throws -> [Data] {
        let sealed = try await seal(path: path, body: body)
        let (data, response) = try await post(path, sealed: sealed.frame, sessionHeader: sealed.session.id)
        try Self.check(response)
        return try open(frames: decodeNoiseFrames([UInt8](data)), session: sealed.session)
    }

    /// Open the push stream: the sealed one-time-key request, then the raw
    /// byte stream of frames.
    func openStream<Body: Encodable>(path: String, body: Body) async throws -> (URLSession.AsyncBytes, URLResponse) {
        let sealed = try await seal(path: path, body: body)
        var request = URLRequest(url: endpoint.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
        request.setValue(sealed.session.id, forHTTPHeaderField: "x-relay-session")
        request.httpBody = Data(sealed.frame)
        return try await session.bytes(for: request)
    }

    private func seal<Body: Encodable>(path: String, body: Body) async throws -> (frame: [UInt8], session: (id: String, send: NoiseCipherState, recv: NoiseCipherState)) {
        let established = try await ensure()
        let json = try JSONEncoder().encode(body)
        return (try encodeNoiseFrame(established.send.encryptWithAd([], [UInt8](json))), established)
    }

    private func open(frames: [[UInt8]], session: (id: String, send: NoiseCipherState, recv: NoiseCipherState)) throws -> [Data] {
        try frames.map { Data(try session.recv.decryptWithAd([], $0)) }
    }

    private func post(_ path: String, sealed: [UInt8], sessionHeader: String?) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: endpoint.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
        if let sessionHeader {
            request.setValue(sessionHeader, forHTTPHeaderField: "x-relay-session")
        }
        request.httpBody = Data(sealed)
        return try await session.data(for: request)
    }

    static func check(_ response: URLResponse) throws {
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw RelayClientError.http(http.statusCode)
        }
    }

    private static func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }
}
