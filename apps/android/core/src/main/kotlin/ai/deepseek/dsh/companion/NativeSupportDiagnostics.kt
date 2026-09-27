package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeDescriptionState
import ai.deepseek.dsh.gateway.NativeGatewayDiagnosticSnapshot
import ai.deepseek.dsh.gateway.NativeObservedCapability
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Explicit safe projection; capabilities outside this client's allowlist are never serialized. */
internal fun JsonObjectBuilder.putNativeDiagnostics(snapshot: NativeGatewayDiagnosticSnapshot) {
    put("transport", buildJsonObject {
        put("producer", "NativeGatewayClient"); put("observation", "current")
        put("activityScope", "client-generation")
        put("closed", snapshot.closed); put("pendingHttpCallbacks", snapshot.pendingHttpCallbacks)
        put("startedHttpCalls", snapshot.startedHttpCalls); put("finishedHttpCalls", snapshot.finishedHttpCalls)
        put("countsSaturated", snapshot.startedHttpCalls == Long.MAX_VALUE || snapshot.finishedHttpCalls == Long.MAX_VALUE)
        put("registeredMuxStreams", snapshot.registeredMuxStreams); put("retiringMuxes", snapshot.retiringMuxes)
    })
    put("role", buildJsonObject {
        put("producer", "NativeGatewayClient.pairing")
        put("observation", if (snapshot.lastKnownRole == null) "unavailable" else "last-known")
        snapshot.lastKnownRole?.let { put("value", it.wire) }
    })
    val observation = when {
        snapshot.description != null -> "last-known"
        snapshot.descriptionState == NativeDescriptionState.FAILED -> "failed"
        else -> "unavailable"
    }
    put("protocol", buildJsonObject {
        put("producer", "NativeGatewayClient.describe"); put("observation", observation)
        put("queryState", snapshot.descriptionState.wire)
        snapshot.descriptionFailure?.let { put("failure", it.wire) }
        snapshot.description?.let {
            put("apiProtocolVersion", 2); put("runtimeMode", "full")
            put("sessionFormatVersion", it.sessionFormatVersion)
        }
    })
    put("capabilities", buildJsonObject {
        put("producer", "NativeGatewayClient.describe"); put("observation", observation)
        put("coverage", "client-allowlist")
        snapshot.description?.let { description ->
            put("supported", buildJsonObject {
                NativeObservedCapability.entries.forEach { put(it.wire, it in description.capabilities) }
            })
        }
    })
}
