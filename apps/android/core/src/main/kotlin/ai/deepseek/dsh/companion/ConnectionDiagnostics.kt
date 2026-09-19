package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** An open subscription has received a decoded frame; it does not establish Host health or authorization. */
enum class ConnectionState(val wire: String) {
    IDLE("idle"), OPENING("opening"), OPEN("open"), RECONNECTING("reconnecting"),
    ENDED("ended"), STOPPING("stopping"), STOPPED("stopped"),
}

/** Fixed failures discard exception messages, server codes and transport addresses. */
enum class ConnectionFailure(val wire: String) {
    UNPAIRED("unpaired"), REFUSED("refused"), TRANSPORT("transport"),
    INVALID_RESPONSE("invalid-response"), CANCELLED("cancelled"), INTERNAL("internal");

    companion object {
        fun from(error: Throwable): ConnectionFailure = when (error) {
            is CancellationException -> CANCELLED
            is LinkClientException.Unpaired -> UNPAIRED
            is LinkClientException.Refused -> REFUSED
            is LinkClientException.Carrier, is IOException -> TRANSPORT
            is LinkClientException.BadWire -> INVALID_RESPONSE
            else -> INTERNAL
        }
    }
}

/** Immutable, model-lifetime observations contain no subscription address or frame content. */
data class ConnectionSnapshot(
    val state: ConnectionState,
    val attempts: Long,
    val interruptions: Long,
    val lastFailure: ConnectionFailure?,
) {
    val countsSaturated: Boolean get() = attempts == Long.MAX_VALUE || interruptions == Long.MAX_VALUE
}

/** Each existing model supplies its own snapshot; absent owners remain explicitly unavailable. */
data class ConnectionSnapshots(
    val sessionFollow: ConnectionSnapshot?,
    val interactions: ConnectionSnapshot?,
    val workspaces: ConnectionSnapshot?,
    val pushes: ConnectionSnapshot?,
) {
    companion object {
        val unavailable = ConnectionSnapshots(null, null, null, null)
    }

    internal fun toJson(): JsonObject = buildJsonObject {
        put("sessionFollow", section("SessionModel", sessionFollow))
        put("interactions", section("InteractionModel", interactions))
        put("workspaces", section("FilesModel", workspaces))
        put("pushes", section("PushModel", pushes))
    }

    private fun section(producer: String, snapshot: ConnectionSnapshot?): JsonObject = buildJsonObject {
        put("producer", producer)
        put("observation", if (snapshot == null) "unavailable" else "current")
        put("activityScope", "model-lifetime")
        snapshot?.let {
            put("snapshot", buildJsonObject {
                put("state", it.state.wire)
                put("attempts", it.attempts)
                put("interruptions", it.interruptions)
                put("countsSaturated", it.countsSaturated)
                it.lastFailure?.let { failure -> put("lastFailure", failure.wire) }
            })
        }
    }
}
