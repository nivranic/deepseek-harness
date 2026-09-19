package ai.deepseek.dsh.contract

/**
 * Presentation semantics one Client surface agrees on for a Remote failure
 * code. Mirrors RemoteFailureClass from @deepseek-ai/dsh-typert-protocol;
 * [WIRE] keeps the cross-transport spelling stable. A class names what the
 * Client may do next and never grants capability, permission, retry policy,
 * or protocol-version admission.
 */
enum class RemoteFailureClass(val WIRE: String) {
    /** Re-authenticate, then retry the same call explicitly. */
    AUTHENTICATION("authentication"),

    /** The Host refused the caller; the unchanged request cannot succeed. */
    PERMISSION("permission"),

    /** The Host is not ready; the connection generation stays recoverable. */
    HOST_STATE("host-state"),

    /** Version or capability mismatch; terminal for this generation. */
    COMPATIBILITY("compatibility"),

    /** Discovery or stream contract violation; the carrier cannot recover. */
    CARRIER_INVALID("carrier-invalid"),

    /** Transport interrupted; mutation acceptance may be unknown on retry. */
    TRANSPORT("transport"),

    /** Stale revision conflicts with Host state; refresh before retrying. */
    CONFLICT("conflict"),

    /** The addressed target does not exist (anymore) on the Host. */
    UNAVAILABLE("unavailable"),

    /** Opaque diagnostic; present code, message and details unchanged. */
    UNKNOWN("unknown"),
}
