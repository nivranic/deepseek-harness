package ai.deepseek.dsh.link

/** Local description-query lifecycle; success records an observation, never a continuing authorization grant. */
enum class LinkDescriptionState(val wire: String) {
    NOT_REQUESTED("not-requested"), CHECKING("checking"), AVAILABLE("available"),
    FAILED("failed"), CANCELLED("cancelled"), RETIRED("retired"),
}

/** Closed failure categories exclude remote messages and local exception details. */
enum class LinkDescriptionFailure(val wire: String) {
    UNPAIRED("unpaired"), REFUSED("refused"), CARRIER("carrier"), BAD_WIRE("bad-wire"), INTERNAL("internal"),
}

/** Unknown runtime labels are represented without retaining the remote string. */
enum class LinkObservedRuntimeClass(val wire: String) { FULL("full"), UNRECOGNIZED("unrecognized") }

/** Fixed-field projection of one authenticated description; Host identities and application versions are excluded. */
data class LinkProtocolObservation(
    val linkProtocolVersion: Double,
    val contractVersion: Double,
    val sessionFormatVersion: Double,
    val runtimeClass: LinkObservedRuntimeClass,
    val allowRemoteApproval: Boolean,
    val capabilities: LinkCapabilities,
)

/** Snapshotting performs no I/O. Stored pairing roles and successful descriptions are last-known observations. */
data class LinkDiagnosticSnapshot(
    val requests: LinkRequestSnapshot,
    val lastKnownRole: LinkDeviceRole?,
    val descriptionState: LinkDescriptionState,
    val descriptionFailure: LinkDescriptionFailure?,
    val description: LinkProtocolObservation?,
)
