import Foundation

/// Why a real-provider stream failed, in the Behavior Spec's vocabulary:
/// transport problems are `network/error` kinds, API problems are
/// `provider/error` codes — the loop driver folds the thrown value into the
/// matching event.
public enum LiteTransportError: Error, Equatable {
    case network(kind: String)
    case provider(code: String, message: String)

    /// Map a URL failure to its network-error kind.
    /// - Parameter error: the transport failure.
    /// - Returns: the spec vocabulary for it.
    public static func classify(_ error: URLError) -> LiteTransportError {
        switch error.code {
        case .timedOut: return .network(kind: "timeout")
        case .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return .network(kind: "unreachable")
        case .networkConnectionLost, .dataNotAllowed: return .network(kind: "dropped")
        default: return .network(kind: "dropped")
        }
    }
}

/// One parsed streaming line: either server-sent events (`data: {…}` lines
/// with a `[DONE]` terminator) or bare NDJSON, in the OpenAI-compatible
/// chat-completions delta shape DeepSeek serves.
public enum LiteStreamLineParser {
    /// Decode one raw line into a chunk, if it carries one.
    /// - Parameter line: one trimmed stream line.
    /// - Returns: the chunk, or nil for blanks, `data: [DONE]`, and
    ///   non-payload lines (comments, event names).
    public static func parse(line: String) -> LiteStreamChunk? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty || trimmed.hasPrefix(":") { return nil }
        let payload = trimmed.hasPrefix("data:")
            ? String(trimmed.dropFirst("data:".count)).trimmingCharacters(in: .whitespaces)
            : trimmed
        if payload == "[DONE]" { return nil }
        guard let data = payload.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = object["choices"] as? [[String: Any]],
              let delta = choices.first?["delta"] as? [String: Any] else { return nil }
        if let reasoning = delta["reasoning_content"] as? String, !reasoning.isEmpty {
            return .reasoning(reasoning)
        }
        if let text = delta["content"] as? String, !text.isEmpty {
            return .text(text)
        }
        if let calls = delta["tool_calls"] as? [[String: Any]],
           let call = calls.first,
           let function = call["function"] as? [String: Any],
           let name = function["name"] as? String,
           let arguments = function["arguments"] as? String {
            let id = call["id"] as? String ?? "tool-\(call["index"] ?? 0)"
            return .toolCall(id: id, name: name, arguments: arguments)
        }
        return nil
    }
}

/// The real-provider seam: an OpenAI-compatible streaming chat completion
/// per prompt, decoded line by line into Lite chunks. Fragmented tool-call
/// argument deltas are deferred — providers that split a call across lines
/// arrive with the real product surface; this skeleton serves whole-call
/// deltas.
public actor LiteHTTPProvider: LiteProviding {
    private let endpoint: URL
    private let apiKey: String
    private let model: String
    private let session: URLSession

    /// - Parameters:
    ///   - endpoint: the chat-completions URL.
    ///   - apiKey: bearer credential.
    ///   - model: the model id to request.
    ///   - session: the URL session; tests inject a stubbed protocol.
    public init(endpoint: URL, apiKey: String, model: String, session: URLSession = .shared) {
        self.endpoint = endpoint
        self.apiKey = apiKey
        self.model = model
        self.session = session
    }

    public func stream(prompt: String) async throws -> AsyncThrowingStream<LiteStreamChunk, Error> {
        let body: [String: Any] = [
            "model": model,
            "stream": true,
            "messages": [["role": "user", "content": prompt]],
        ]
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        do {
            let (bytes, response) = try await session.bytes(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw LiteTransportError.provider(code: "HTTP_\(http.statusCode)", message: "provider refused the request")
            }
            return AsyncThrowingStream { continuation in
                let task = Task {
                    do {
                        for try await line in bytes.lines {
                            if let chunk = LiteStreamLineParser.parse(line: String(line)) {
                                continuation.yield(chunk)
                            }
                        }
                        continuation.finish()
                    } catch let error as URLError {
                        continuation.finish(throwing: LiteTransportError.classify(error))
                    } catch {
                        continuation.finish(throwing: error)
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        } catch let error as URLError {
            throw LiteTransportError.classify(error)
        }
    }
}
