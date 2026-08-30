import Foundation

/// One tool invocation in the open session's trajectory, paired across the
/// wire by `callId`: the `tool/call` event opens the record as running, the
/// matching `tool/result` event closes it with the model-facing text or the
/// failure identity. Folded by the session view model from the
/// session-event contract models, in arrival (seq) order.
public struct ToolCallRecord: Identifiable, Equatable {
    /// Lifecycle of one invocation on the wire.
    public enum Phase: Equatable {
        /// Opened by `tool/call`, no matching result yet.
        case running
        /// Closed by a `tool/result` without a failure identity.
        case completed
        /// Closed by a `tool/result` carrying a failure identity.
        case failed
    }

    /// The wire `callId`; pairs the call with its result.
    public let id: String
    /// Seq of the opening `tool/call`, fixing trajectory order.
    public let seq: Double
    /// Tool name the model requested.
    public let name: String
    /// Raw arguments JSON string exactly as the model produced it.
    public let arguments: String
    public var phase: Phase
    /// Visible result text; empty while running.
    public var resultText: String

    public init(
        id: String, seq: Double, name: String, arguments: String,
        phase: Phase = .running, resultText: String = ""
    ) {
        self.id = id
        self.seq = seq
        self.name = name
        self.arguments = arguments
        self.phase = phase
        self.resultText = resultText
    }
}
