import Foundation

/// One streaming chunk a Lite model provider emits.
public enum LiteStreamChunk: Equatable {
    case reasoning(String)
    case text(String)
    case toolCall(id: String, name: String, arguments: String)
}

/// The model seam a Lite loop drives: one streamed response per prompt.
public protocol LiteProviding: Actor {
    /// Stream one response's chunks for a submitted prompt.
    /// - Parameter prompt: the accepted user prompt text.
    /// - Returns: the ordered chunks of one model response.
    func stream(prompt: String) async throws -> AsyncThrowingStream<LiteStreamChunk, Error>
}

/// A scripted provider: one prompt-matched chunk script, for tests and previews.
public actor ScriptedLiteProvider: LiteProviding {
    private let scripts: [String: [LiteStreamChunk]]
    private var calls: [String] = []

    /// - Parameter scripts: prompt text to its ordered chunks.
    public init(scripts: [String: [LiteStreamChunk]]) {
        self.scripts = scripts
    }

    /// The prompts streamed so far, in order.
    public var submitted: [String] { calls }

    public func stream(prompt: String) async throws -> AsyncThrowingStream<LiteStreamChunk, Error> {
        calls.append(prompt)
        let chunks = scripts[prompt] ?? []
        return AsyncThrowingStream { continuation in
            for chunk in chunks { continuation.yield(chunk) }
            continuation.finish()
        }
    }
}

/// Executes one bundled tool invocation.
public typealias LiteToolExecuting = @Sendable (_ id: String, _ name: String, _ arguments: String) async -> (ok: Bool, text: String)

/// The Lite loop driver skeleton: submits a prompt to the provider, folds
/// the streamed chunks into the Behavior-Spec state, dispatches bundled
/// tools through the registry, and emits the handoff marker when a tool
/// demands the full runtime instead of executing on-device.
@MainActor
public final class LiteLoopDriver {
    public private(set) var fold = LiteFold()
    public private(set) var running = false

    private let provider: any LiteProviding
    private let execute: LiteToolExecuting
    private var task: Task<Void, Never>?

    /// - Parameters:
    ///   - provider: the model seam; tests pass a scripted provider.
    ///   - execute: the bundled-tool executor the registry dispatches to.
    public init(provider: any LiteProviding, execute: @escaping LiteToolExecuting) {
        self.provider = provider
        self.execute = execute
    }

    /// Submit one prompt and drive its response to the terminal event.
    public func submit(prompt: String) async {
        task?.cancel()
        running = true
        defer { running = false }
        fold.apply(.promptAccepted(requestId: "lite-\(UUID().uuidString)", content: prompt))
        do {
            let chunks = try await provider.stream(prompt: prompt)
            var text = ""
            for try await chunk in chunks {
                switch chunk {
                case .reasoning(let value):
                    fold.apply(.streamReasoning(text: value))
                case .text(let value):
                    fold.apply(.streamDelta(text: value))
                    text += value
                case .toolCall(let id, let name, let arguments):
                    fold.apply(.toolCall(id: id, name: name, arguments: arguments))
                    // A tool the registry cannot serve on-device hands off
                    // instead of executing; the loop stops at the marker.
                    if let capability = LiteToolRegistry.handoffCapability(for: name) {
                        fold.apply(.handoffRequested(capability: capability))
                        return
                    }
                    guard LiteToolRegistry.tool(named: name) != nil else { continue }
                    let outcome = await execute(id, name, arguments)
                    fold.apply(.toolResult(id: id, ok: outcome.ok, text: outcome.text))
                }
            }
            fold.apply(.messageCompleted(text: text, usage: nil))
            fold.apply(.turnCompleted)
        } catch is CancellationError {
            fold.apply(.turnCancelled(reason: "user"))
        } catch {
            fold.apply(.providerError(code: "PROVIDER_FAILED", message: String(describing: error)))
        }
    }

    /// Cancel the in-flight turn; the fold finalizes the delivered prefix.
    public func cancel() {
        task?.cancel()
    }
}
