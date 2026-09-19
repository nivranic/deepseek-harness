package ai.deepseek.dsh.contract

/**
 * Codes with agreed cross-Client semantics, mirrored from
 * REMOTE_FAILURE_CLASSES in @deepseek-ai/dsh-typert-protocol. The vocabulary
 * is merge-extensible: codes without an entry deliberately resolve to
 * [RemoteFailureClass.UNKNOWN] and must stay presentable as opaque
 * diagnostics. The repository test asserts this mirror equals the generated
 * projection of the TypeScript authority and references only codes the
 * published envelope schema declares.
 */
object RemoteFailureClasses {

    /** Mirror of the TypeScript authority; kept exact by EnvelopeSchemaTest. */
    val BY_CODE: Map<String, RemoteFailureClass> = mapOf(
        "gateway/authentication-required" to RemoteFailureClass.AUTHENTICATION,
        "gateway/permission-denied" to RemoteFailureClass.PERMISSION,
        "subagent/unauthorized" to RemoteFailureClass.PERMISSION,
        "gateway/host-not-ready" to RemoteFailureClass.HOST_STATE,
        "gateway/protocol-unsupported" to RemoteFailureClass.COMPATIBILITY,
        "host/protocol-unsupported" to RemoteFailureClass.COMPATIBILITY,
        "host/capability-unavailable" to RemoteFailureClass.COMPATIBILITY,
        "host/description-invalid" to RemoteFailureClass.CARRIER_INVALID,
        "gateway/preparation-unavailable" to RemoteFailureClass.CARRIER_INVALID,
        "gateway/stream-invalid" to RemoteFailureClass.CARRIER_INVALID,
        "gateway/transport-interrupted" to RemoteFailureClass.TRANSPORT,
        "gateway/connection-unavailable" to RemoteFailureClass.TRANSPORT,
        "revision-conflict" to RemoteFailureClass.CONFLICT,
        "session/revision-conflict" to RemoteFailureClass.CONFLICT,
        "session/not-found" to RemoteFailureClass.UNAVAILABLE,
        "session/queue-item-not-found" to RemoteFailureClass.UNAVAILABLE,
        "subagent/not-found" to RemoteFailureClass.UNAVAILABLE,
        "agent-preset/not-found" to RemoteFailureClass.UNAVAILABLE,
        "workspace/not-found" to RemoteFailureClass.UNAVAILABLE,
        "workspace-file/not-found" to RemoteFailureClass.UNAVAILABLE,
        "presented-file/not-found" to RemoteFailureClass.UNAVAILABLE,
    )

    /**
     * Classify one Remote failure code for presentation.
     * @param code code carried by a Remote failure envelope, known or unknown.
     * @returns the agreed class; UNKNOWN for codes without shared semantics.
     */
    fun classify(code: String): RemoteFailureClass = BY_CODE[code] ?: RemoteFailureClass.UNKNOWN
}
