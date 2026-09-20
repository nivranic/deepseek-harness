/// Codes with agreed cross-Client semantics, mirrored from
/// REMOTE_FAILURE_CLASSES in @deepseek-ai/dsh-typert-protocol. The vocabulary
/// is merge-extensible: unlisted codes deliberately resolve to `unknown` and
/// must stay presentable as opaque diagnostics. Tests assert this mirror
/// equals the generated projection of the TypeScript authority.
public enum RemoteFailureClasses {
    /// Mirror of the TypeScript authority; kept exact by the package tests.
    public static let byCode: [String: RemoteFailureClass] = [
        "gateway/authentication-required": .authentication,
        "device/admission-expired": .authentication,
        "device/replay-detected": .authentication,
        "gateway/permission-denied": .permission,
        "subagent/unauthorized": .permission,
        "gateway/host-not-ready": .hostState,
        "gateway/protocol-unsupported": .compatibility,
        "host/protocol-unsupported": .compatibility,
        "host/capability-unavailable": .compatibility,
        "host/description-invalid": .carrierInvalid,
        "gateway/preparation-unavailable": .carrierInvalid,
        "gateway/stream-invalid": .carrierInvalid,
        "gateway/transport-interrupted": .transport,
        "gateway/connection-unavailable": .transport,
        "revision-conflict": .conflict,
        "session/revision-conflict": .conflict,
        "session/not-found": .unavailable,
        "session/queue-item-not-found": .unavailable,
        "subagent/not-found": .unavailable,
        "agent-preset/not-found": .unavailable,
        "workspace/not-found": .unavailable,
        "workspace-file/not-found": .unavailable,
        "workspace-file/not-regular-file": .unavailable,
        "workspace-file/not-directory": .unavailable,
        "presented-file/not-found": .unavailable,
        "session/attachment-invalid": .invalidInput,
        "subagent/attachment-invalid": .invalidInput,
        "session/title-invalid": .invalidInput,
        "agent-preset/invalid": .invalidInput,
        "workspace/invalid-path": .invalidInput,
    ]

    /// Classify one Remote failure code for presentation.
    /// - Parameter code: code carried by a Remote failure envelope.
    /// - Returns: the agreed class; `unknown` for codes without shared semantics.
    public static func classify(_ code: String) -> RemoteFailureClass {
        byCode[code] ?? .unknown
    }
}
