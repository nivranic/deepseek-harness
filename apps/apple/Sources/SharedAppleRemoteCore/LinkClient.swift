import CryptoKit
import Foundation

/// Every way a link call can fail, mirroring the TypeScript reference
/// client's `LinkError` vocabulary.
public enum LinkClientError: Error, Equatable {
    /// The carrier failed before an HTTP response or returned a non-2xx status
    /// that is not an authorization refusal.
    case carrier(status: Int, message: String)
    /// A paired identity is required but none is persisted.
    case unpaired
    /// Carrier authorization or a Remote operation refused the request.
    case refused(code: String, message: String)
    /// The envelope or frame bytes were not decodable.
    case badWire(String)
}

/// The link-client state machine: pair once, then describe, call unary
/// endpoints through the shared `/api` chain, and open NDJSON Remote streams
/// — the same sequences the TypeScript reference client (`dsh-link-client`)
/// exercises for the pair → connect → session → prompt → approval →
/// reconnect vertical slice.
public final class LinkClient {
    private let baseURL: URL
    private let session: URLSession
    private let store: LinkCredentialsStoring
    private let pinned: String

    /// - Parameters:
    ///   - baseURL: the carrier endpoint from the pairing payload.
    ///   - pinnedFingerprint: SPKI fingerprint the TLS handshake pins.
    ///   - store: where the paired identity persists.
    /// The SPKI fingerprint this client pins; tests and restore read it.
    public var pinnedFingerprint: String { pinned }

    public init(baseURL: URL, pinnedFingerprint: String, store: LinkCredentialsStoring) {
        self.baseURL = baseURL
        self.store = store
        self.pinned = pinnedFingerprint
        self.session = URLSession(
            configuration: .ephemeral,
            delegate: LinkPinningDelegate(pinnedFingerprint: pinnedFingerprint),
            delegateQueue: nil
        )
    }

    /// The persisted identity, or nil before the first successful pairing.
    public var credentials: LinkCredentials? { store.load() }

    /// Pair with a host by exchanging the one-time QR code for a durable
    /// identity. Generates a fresh Ed25519 key whose SPKI DER the host
    /// stores; persists the returned identity.
    /// - Parameters:
    ///   - payload: the scanned pairing payload.
    ///   - deviceName: the user-chosen name shown in the host's device list.
    /// - Returns: the persisted credentials.
    public func pair(payload: LinkPairingPayload, deviceName: String) async throws -> LinkCredentials {
        guard Self.pairingPayloadOwnsTransport(payload, baseURL: baseURL, pinnedFingerprint: pinned) else {
            throw LinkClientError.badWire("pairing payload does not own this client transport")
        }
        let key = Curve25519.Signing.PrivateKey()
        let request = LinkPairRequest(
            code: payload.code,
            deviceName: deviceName,
            devicePublicKey: LinkSigning.ed25519SpkiDer(publicKeyRaw: key.publicKey.rawRepresentation).base64EncodedString()
        )
        let body = try JSONEncoder().encode(request)
        let data = try await post(path: "/link/pair", body: body, signed: false)
        let value = try Self.decode(LinkPairResponse.self, from: data)
        let credentials = LinkCredentials(
            deviceId: value.deviceId,
            hostId: value.hostId,
            hostName: value.hostName,
            role: value.role.rawValue,
            endpoint: payload.endpoint,
            pinnedFingerprint: payload.spkiFingerprint,
            signingKeyBase64: key.rawRepresentation.base64EncodedString()
        )
        store.save(credentials)
        return credentials
    }

    /// Ask the authenticated host for its description and capabilities.
    public func describe() async throws -> LinkHostDescription {
        let data = try await post(path: "/link/describe", body: Data(), signed: true)
        return try Self.decode(LinkHostDescription.self, from: data)
    }

    /// Call one unary Remote endpoint through the shared `/api` chain.
    /// - Parameters:
    ///   - method: canonical endpoint, for example `session/list`.
    ///   - args: named wire arguments.
    /// - Returns: the business value on success.
    /// - Throws: `LinkClientError.unpaired` or `badWire` for unusable local
    ///   credentials or response bytes, `carrier` for transport failures, and
    ///   `refused` for carrier authorization or business-call refusal.
    public func call(
        _ method: String,
        args: [String: LinkJsonValue] = [:]
    ) async throws -> LinkJsonValue {
        let rpcId = "rpc-\(UUID().uuidString)"
        let envelope = LinkRpcRequestEnvelope(
            type: "client-request",
            rpcId: rpcId,
            method: method,
            payload: LinkRpcPayload(args: args)
        )
        let body = try JSONEncoder().encode(envelope)
        let data = try await post(path: "/api/\(method)", body: body, signed: true)
        let response = try Self.decode(LinkRpcResponseEnvelope.self, from: data)
        return try Self.value(from: response, expectedRpcId: rpcId)
    }

    /// Open one NDJSON Remote stream. A carrier authorization refusal throws
    /// before the stream is returned; a typed failure frame finishes the
    /// returned stream with `refused`. A transport failure mid-stream surfaces
    /// as the underlying `URLError` so callers resubscribe rather than treat
    /// silence as completion.
    /// - Parameters:
    ///   - endpoint: canonical stream endpoint, for example `$events`.
    ///   - payload: the stream's opening payload arguments.
    /// - Returns: an async stream of decoded frame values.
    /// - Throws: `LinkClientError.unpaired` or `badWire` for unusable local
    ///   credentials or response bytes, `carrier` for transport failures, and
    ///   `refused` when carrier authorization rejects the stream request.
    public func stream(
        _ endpoint: String,
        payload: [String: LinkJsonValue] = [:]
    ) async throws -> AsyncThrowingStream<LinkJsonValue, Error> {
        let body = try JSONEncoder().encode(LinkStreamRequest(args: payload))
        let data: (bytes: URLSession.AsyncBytes, response: URLResponse)
        do {
            var request = try URLRequest(url: Self.url(base: baseURL, path: "/link/stream/\(endpoint)"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            try Self.applyCredentials(to: &request, body: body, store: store)
            request.httpBody = body
            data = try await session.bytes(for: request)
        } catch let error as LinkClientError {
            throw error
        } catch {
            throw LinkClientError.carrier(status: 0, message: String(describing: error))
        }
        try await Self.checkStreamResponse(response: data.response, bytes: data.bytes)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await line in data.bytes.lines {
                        guard let frameData = line.data(using: .utf8), !frameData.isEmpty else { continue }
                        let frame = try Self.decode(LinkStreamFrame.self, from: frameData)
                        if frame.k == .e {
                            continuation.finish(throwing: LinkClientError.refused(
                                code: frame.c ?? "internal",
                                message: frame.m ?? "stream failed"
                            ))
                            return
                        }
                        continuation.yield(frame.v ?? .null)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Forget the paired identity; the host refuses the next request.
    public func unpair() {
        store.clear()
    }

    /// Rebuild the paired client from persisted credentials — the relaunch
    /// path that skips pairing and pins the stored fingerprint again.
    /// - Parameter store: where the identity persists.
    /// - Returns: the client, or nil before the first successful pairing or
    ///   when the stored endpoint no longer parses.
    public static func restore(store: LinkCredentialsStoring) -> LinkClient? {
        guard let credentials = store.load() else { return nil }
        guard let endpoint = URL(string: credentials.endpoint) else { return nil }
        return LinkClient(
            baseURL: endpoint,
            pinnedFingerprint: credentials.pinnedFingerprint,
            store: store
        )
    }

    // MARK: - Internals

    /// Join the carrier base URL with an absolute request path.
    static func url(base: URL, path: String) -> URL {
        let trimmed = base.absoluteString.hasSuffix("/")
            ? String(base.absoluteString.dropLast())
            : base.absoluteString
        return URL(string: trimmed + path)!
    }

    /// Whether one pairing payload names the endpoint and pin this client uses.
    static func pairingPayloadOwnsTransport(
        _ payload: LinkPairingPayload,
        baseURL: URL,
        pinnedFingerprint: String
    ) -> Bool {
        guard let payloadURL = URL(string: payload.endpoint) else { return false }
        let normalizedPayload = payloadURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let normalizedBase = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return normalizedPayload == normalizedBase && payload.spkiFingerprint == pinnedFingerprint
    }

    /// Send one unary request, optionally device-signed, checking the status.
    private func post(path: String, body: Data, signed: Bool) async throws -> Data {
        do {
            var request = try URLRequest(url: Self.url(base: baseURL, path: path))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            if signed {
                try Self.applyCredentials(to: &request, body: body, store: store)
            }
            request.httpBody = body
            let (data, response) = try await session.data(for: request)
            try Self.check(response: response, data: data)
            return data
        } catch let error as LinkClientError {
            throw error
        } catch {
            throw LinkClientError.carrier(status: 0, message: String(describing: error))
        }
    }

    /// Attach the three credential headers with a fresh timestamp signature.
    static func applyCredentials(to request: inout URLRequest, body: Data, store: LinkCredentialsStoring) throws {
        guard let credentials = store.load() else { throw LinkClientError.unpaired }
        guard let privateKey = Data(base64Encoded: credentials.signingKeyBase64) else {
            throw LinkClientError.badWire("stored signing key is not base64")
        }
        let timestamp = String(Int(Date().timeIntervalSince1970 * 1000))
        let path = request.url?.path ?? "/"
        let input = LinkSigning.signingInput(
            timestamp: timestamp,
            method: request.httpMethod ?? "POST",
            path: path,
            bodySha256Hex: LinkSigning.sha256Hex(body)
        )
        request.setValue(credentials.deviceId, forHTTPHeaderField: LinkSigning.deviceIdHeader)
        request.setValue(timestamp, forHTTPHeaderField: LinkSigning.timestampHeader)
        request.setValue(try LinkSigning.sign(input: input, privateKeyRaw: privateKey), forHTTPHeaderField: LinkSigning.signatureHeader)
    }

    /// Classify a non-2xx carrier answer. Only an HTTP 403 with the JSON string
    /// `error` equal to `forbidden` is an authorization refusal; all other
    /// statuses remain carrier failures.
    static func check(response: URLResponse, data: Data?) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let document: [String: Any]? = data.flatMap { body in
                guard let value = try? JSONSerialization.jsonObject(with: body) else { return nil }
                return value as? [String: Any]
            }
            let message = nonemptyString("message", in: document)
                ?? nonemptyString("reason", in: document)
                ?? "HTTP \(http.statusCode)"
            if http.statusCode == 403, document?["error"] as? String == "forbidden" {
                throw LinkClientError.refused(code: "forbidden", message: message)
            }
            throw LinkClientError.carrier(status: http.statusCode, message: message)
        }
    }

    /// Read and classify an unsuccessful stream response without consuming a
    /// successful stream's first byte.
    static func checkStreamResponse<Bytes: AsyncSequence>(
        response: URLResponse,
        bytes: Bytes
    ) async throws where Bytes.Element == UInt8 {
        guard let http = response as? HTTPURLResponse,
              !(200..<300).contains(http.statusCode) else { return }
        var body = Data()
        do {
            for try await byte in bytes {
                body.append(byte)
            }
        } catch {
            throw LinkClientError.carrier(status: http.statusCode, message: "HTTP \(http.statusCode)")
        }
        try check(response: http, data: body)
    }

    private static func nonemptyString(_ field: String, in document: [String: Any]?) -> String? {
        guard let value = document?[field] as? String, !value.isEmpty else { return nil }
        return value
    }

    /// Decode or map to `badWire`.
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw LinkClientError.badWire(String(describing: error))
        }
    }

    /// Validate one generated unary response and project its business value.
    /// - Parameters:
    ///   - response: decoded canonical response envelope.
    ///   - expectedRpcId: request identity the Host must echo.
    /// - Returns: the returned JSON value, or `.null` for a successful void RPC.
    static func value(from response: LinkRpcResponseEnvelope, expectedRpcId: String) throws -> LinkJsonValue {
        guard response.type == "server-response" else {
            throw LinkClientError.badWire("unexpected response type \(response.type)")
        }
        guard response.rpcId == expectedRpcId else {
            throw LinkClientError.badWire("rpcId mismatch")
        }
        if response.result.ok {
            guard response.result.error == nil else {
                throw LinkClientError.badWire("successful result carried an error")
            }
            return response.result.value ?? .null
        }
        guard response.result.value == nil, let failure = response.result.error else {
            throw LinkClientError.badWire("failed result lacked a structured error")
        }
        throw LinkClientError.refused(code: failure.code, message: failure.message)
    }
}
