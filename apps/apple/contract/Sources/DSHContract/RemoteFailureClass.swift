/// Presentation semantics one Client surface agrees on for a Remote failure
/// code. Mirrors RemoteFailureClass from @deepseek-ai/dsh-typert-protocol;
/// a class names what the Client may do next and never grants capability,
/// permission, retry policy, or protocol-version admission.
public enum RemoteFailureClass: String, CaseIterable, Sendable, Equatable {
    case authentication
    case permission
    case hostState = "host-state"
    case compatibility
    case carrierInvalid = "carrier-invalid"
    case transport
    case conflict
    case unavailable
    case invalidInput = "invalid-input"
    case unknown
}
