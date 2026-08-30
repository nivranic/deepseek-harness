import CryptoKit
import Foundation

/// Every way a link call can fail, mirroring the TypeScript reference
/// client's `LinkError` vocabulary.
public enum LinkClientError: Error, Equatable {
    /// The carrier answered with a non-200 status and a message.
    case carrier(status: Int, message: String)
    /// A paired identity is required but none is persisted.
    case unpaired
    /// A unary call reached the gateway but the business call refused.
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

    /// - Parameters:
    ///   - baseURL: the carrier endpoint from the pairing payload.
    ///   - pinnedFingerprint: SPKI fingerprint the TLS handshake pins.
    ///   - store: where the paired identity persists.
    public init(baseURL: URL, pinnedFingerprint: String, store: LinkCredentialsStoring) {
        self.baseURL = baseURL
        self.store = store
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
        let key = Curve25519.Signing.PrivateKey()
        let request = PairRequestBody(
            code: payload.code,
            deviceName: deviceName,
            devicePublicKey: LinkSigning.ed25519SpkiDer(publicKeyRaw: key.publicKey.rawRepresentation).base64EncodedString()
        )
        let body = try JSONEncoder().encode(request)
        let data = try await post(path: "/link/pair", body: body, signed: false)
        let value = try Self.decode(PairResponseBody.self, from: data)
        let credentials = LinkCredentials(
            deviceId: value.deviceId,
            hostId: value.hostId,
            hostName: value.hostName,
            role: value.role,
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
    /// - Throws: `LinkClientError.refused` when the business call fails.
    public func call(
        _ method: String,
        args: [String: LinkWire.RequestEnvelope.Payload.Value] = [:]
    ) async throws -> LinkWire.ResponseEnvelope.Result.Value {
        let envelope = LinkWire.RequestEnvelope(rpcId: "rpc-\(method)", method: method, args: args)
        let body = try JSONEncoder().encode(envelope)
        let data = try await post(path: "/api/\(method)", body: body, signed: true)
        let response = try Self.decode(LinkWire.ResponseEnvelope.self, from: data)
        guard response.type == "server-response" else {
            throw LinkClientError.badWire("unexpected response type \(response.type)")
        }
        if response.result.ok, let value = response.result.value {
            return value
        }
        if let failure = response.result.error {
            throw LinkClientError.refused(code: failure.code, message: failure.message)
        }
        throw LinkClientError.badWire("ok result without a value")
    }

    /// Open one NDJSON Remote stream. Values yield as frames arrive; a
    /// typed failure frame finishes with `refused`. A transport failure
    /// mid-stream surfaces as the underlying `URLError` so callers
    /// resubscribe rather than treat silence as completion.
    /// - Parameters:
    ///   - endpoint: canonical stream endpoint, for example `$events`.
    ///   - payload: the stream's opening payload arguments.
    /// - Returns: an async stream of decoded frame values.
    public func stream(
        _ endpoint: String,
        payload: [String: LinkWire.RequestEnvelope.Payload.Value] = [:]
    ) async throws -> AsyncThrowingStream<LinkWire.ResponseEnvelope.Result.Value, Error> {
        let body = try JSONEncoder().encode(StreamBody(args: payload))
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
        try Self.check(response: data.response, data: nil)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await line in data.bytes.lines {
                        guard let frameData = line.data(using: .utf8), !frameData.isEmpty else { continue }
                        let frame = try Self.decode(LinkWire.StreamFrame.self, from: frameData)
                        if frame.isFailure {
                            continuation.finish(throwing: LinkClientError.refused(
                                code: frame.c ?? "internal",
                                message: frame.m ?? "stream failed"
                            ))
                            return
                        }
                        if let value = frame.v {
                            continuation.yield(value)
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

    /// Forget the paired identity; the host refuses the next request.
    public func unpair() {
        store.clear()
    }

    // MARK: - Internals

    private struct PairRequestBody: Encodable {
        let code: String
        let deviceName: String
        let devicePublicKey: String
    }

    private struct PairResponseBody: Decodable {
        let deviceId: String
        let hostId: String
        let hostName: String
        let role: String
    }

    private struct StreamBody: Encodable {
        let args: [String: LinkWire.RequestEnvelope.Payload.Value]
    }

    /// Join the carrier base URL with an absolute request path.
    static func url(base: URL, path: String) -> URL {
        let trimmed = base.absoluteString.hasSuffix("/")
            ? String(base.absoluteString.dropLast())
            : base.absoluteString
        return URL(string: trimmed + path)!
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

    /// Fail loud on a non-2xx carrier answer.
    static func check(response: URLResponse, data: Data?) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let message = data.flatMap { d in
                (try? JSONDecoder().decode([String: String].self, from: d))?["message"]
            } ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw LinkClientError.carrier(status: http.statusCode, message: message)
        }
    }

    /// Decode or map to `badWire`.
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw LinkClientError.badWire(String(describing: error))
        }
    }
}
