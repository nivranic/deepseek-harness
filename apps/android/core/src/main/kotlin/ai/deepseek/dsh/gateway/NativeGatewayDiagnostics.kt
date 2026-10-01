package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.companion.ConnectionFailure

/** Query lifecycle is independent of retained protocol observations and HTTP callback ownership. */
enum class NativeDescriptionState(val wire: String) {
    NOT_REQUESTED("not-requested"), CHECKING("checking"), AVAILABLE("available"),
    FAILED("failed"), CANCELLED("cancelled"), RETIRED("retired"),
}

/** Pairing-time roles are observations, not current authorization. */
enum class NativeObservedRole(val wire: String) {
    VIEWER("viewer"), COLLABORATOR("collaborator"), CONTROLLER("controller"), OWNER("owner");

    companion object {
        internal fun from(value: String?): NativeObservedRole? = entries.find { it.wire == value }
    }
}

/** Public capabilities recognized by the native companion and permitted in diagnostic documents. */
enum class NativeObservedCapability(val wire: String) {
    SESSION_FOLLOW("session.follow.v1"), SESSION_CONTROL("session.control.v1"),
    SESSION_LIST("session.list.v1"), SESSION_MANAGE("session.manage.v1"),
    WORKSPACE_FOLLOW("workspace.follow.v1"), FILE_STAT("workspace-files.stat.v1"),
    FILE_LIST("workspace-files.list.v1"), FILE_TEXT("workspace-files.read-text.v1"),
    FILE_BYTES("workspace-files.read-bytes.v1"), FILE_UPLOAD("file-upload.stage.v1"),
    FILE_UPLOAD_DEDUPE("file-upload.dedupe.v1"), IMAGE_UPLOAD("image-upload.stage.v1"),
    SUBAGENT_CATALOG("subagent.catalog.v1"), HTTP_REQUEST_BUDGET("native-remote.http-request-budget.v1"),
    MODEL_STEER("model.steer.v1"), MODEL_CATALOG("model.catalog.v1"), MODEL_SELECT("model.select.v1");

    companion object {
        /** Native-owned operations mirror their Remote owner's advertised method sets. */
        internal fun forEndpoint(endpoint: String): NativeObservedCapability? = when (endpoint) {
            "session/follow", "session/page" -> SESSION_FOLLOW
            "session/control", "session/prompt", "session/updateQueue", "session/cancel" -> SESSION_CONTROL
            "session/list" -> SESSION_LIST
            "session/create", "session/rename", "session/fork" -> SESSION_MANAGE
            "workspace/follow" -> WORKSPACE_FOLLOW
            "workspaceFiles/stat" -> FILE_STAT
            "workspaceFiles/list" -> FILE_LIST
            "workspaceFiles/read" -> FILE_TEXT
            "workspaceFiles/readBytes" -> FILE_BYTES
            "fileUploads/upload" -> FILE_UPLOAD
            "fileUploads/uploadDedupe" -> FILE_UPLOAD_DEDUPE
            "fileUploads/uploadImage" -> IMAGE_UPLOAD
            "subagents/list" -> SUBAGENT_CATALOG
            "nativeRemote/httpRequestBudget" -> HTTP_REQUEST_BUDGET
            "session/modelCatalog" -> MODEL_CATALOG
            "session/selectModel" -> MODEL_SELECT
            // Gateway event transport and extension methods have no native-owned operation requirement here.
            else -> null
        }
    }
}

/** Successful API 2/full negotiation with independent durable Session version; no Host identity fields. */
data class NativeProtocolObservation(
    val sessionFormatVersion: Long,
    val capabilities: Set<NativeObservedCapability>,
)

/** Pure client-generation snapshot. HTTP counts include negotiation and pairing, exclude mux traffic,
 * and finish when the owned callback settles, even if its caller was already cancelled.
 * Registered streams exclude subscriptions removed on termination; retiring muxes await terminal callbacks.
 */
data class NativeGatewayDiagnosticSnapshot(
    val closed: Boolean,
    val pendingHttpCallbacks: Int,
    val startedHttpCalls: Long,
    val finishedHttpCalls: Long,
    val registeredMuxStreams: Int,
    val retiringMuxes: Int,
    val lastKnownRole: NativeObservedRole?,
    val descriptionState: NativeDescriptionState,
    val descriptionFailure: ConnectionFailure?,
    val description: NativeProtocolObservation?,
)
