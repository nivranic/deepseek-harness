package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.link.DeviceAdmission
import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.LinkCredentials
import ai.deepseek.dsh.link.LinkResponseEnvelope
import ai.deepseek.dsh.link.WireValue
import kotlinx.serialization.json.*

/** Host facts negotiated independently of its product and on-disk Session versions. */
data class NativeHostDescription(
    val hostId: String,
    val displayName: String,
    val productVersion: String,
    val sessionFormatVersion: Long,
    val capabilities: Set<String>,
) {
    companion object {
        internal fun parse(value: WireValue, expectedHostId: String): NativeHostDescription {
            val obj = value.toJsonElement() as? JsonObject ?: badNativeWire("invalid Host description")
            if (obj.text("hostId") != expectedHostId) badNativeWire("Host identity differs from pairing")
            if (obj.integer("apiProtocolVersion") != 2L || obj.text("runtimeMode") != "full") {
                badNativeWire("Host did not negotiate API protocol 2 and full runtime")
            }
            val capabilities = obj["capabilities"] as? JsonArray ?: badNativeWire("invalid Host capabilities")
            val ids = capabilities.map { (it as? JsonPrimitive)?.takeIf { item -> item.isString }
                ?.content?.takeIf(String::isNotEmpty) ?: badNativeWire("invalid Host capability") }
            if (ids.toSet().size != ids.size) badNativeWire("duplicate Host capability")
            return NativeHostDescription(obj.text("hostId"), obj.text("displayName"), obj.text("productVersion"),
                obj.integer("sessionFormatVersion"), ids.toSet())
        }
    }
}

/** Connection unary and Gateway mux codecs. Device admission is generated for each dispatch. */
internal object NativeGatewayProtocol {
    const val credentialFormat = "native-gateway-v1"

    fun payload(endpoint: String, args: Map<String, WireValue>, identity: LinkCredentials?): JsonObject {
        val admission = identity?.let {
            val key = it.signingKeyRaw?.takeIf { bytes -> bytes.size == 32 }
                ?: badNativeWire("invalid stored signing key")
            DeviceAdmission.create(it.deviceId, key).toWireValue().toJsonElement()
        }
        if (endpoint != "deviceTrust/redeemPairing" && admission == null) throw LinkClientException.Unpaired()
        return buildJsonObject {
            put("apiProtocolVersion", 2)
            put("args", buildJsonObject {
                args.forEach { (key, value) -> put(key, value.toJsonElement()) }
                if (endpoint == "\$events" && admission != null) put("device", admission)
            })
            if (endpoint != "\$events" && admission != null) put("device", admission)
        }
    }

    fun request(id: String, method: String, args: Map<String, WireValue>, identity: LinkCredentials?): String =
        buildJsonObject {
            put("type", "client-request")
            put("rpcId", id)
            put("method", method)
            put("payload", payload(method, args, identity))
        }.toString()

    fun response(text: String, id: String): WireValue {
        val envelope = LinkResponseEnvelope.fromJsonElement(parse(text))
        if (envelope.rpcId != id) badNativeWire("RPC correlation mismatch")
        val result = envelope.result
        if (!result.ok) throw LinkClientException.Refused(result.errorCode!!, result.errorMessage!!, result.errorDetails)
        return result.value ?: WireValue.NullValue
    }

    fun open(id: String, endpoint: String, args: Map<String, WireValue>, identity: LinkCredentials): String =
        buildJsonObject {
            put("type", "open")
            put("streamId", id)
            put("endpoint", endpoint)
            put("payload", payload(endpoint, args, identity))
        }.toString()

    fun cancel(id: String): String = buildJsonObject { put("type", "cancel"); put("streamId", id) }.toString()

    fun parse(text: String): JsonObject = try {
        Json.parseToJsonElement(text) as? JsonObject ?: badNativeWire("expected a JSON object")
    } catch (_: IllegalArgumentException) { badNativeWire("invalid response JSON") }

    fun frame(text: String): NativeStreamFrame {
        val obj = parse(text)
        val id = obj.text("streamId")
        return when (obj.text("type")) {
            "item" -> {
                if (obj.keys != setOf("type", "streamId") && obj.keys != setOf("type", "streamId", "value")) {
                    badNativeWire("invalid stream item")
                }
                NativeStreamFrame.Item(id, obj["value"]?.let(WireValue::fromJsonElement) ?: WireValue.NullValue)
            }
            "end" -> {
                if (obj.keys != setOf("type", "streamId")) badNativeWire("invalid stream end")
                NativeStreamFrame.End(id)
            }
            "error" -> {
                if (obj.keys != setOf("type", "streamId", "error")) badNativeWire("invalid stream error")
                val error = obj["error"] as? JsonObject ?: badNativeWire("invalid stream error")
                if (error.keys != setOf("code", "message", "details")) badNativeWire("invalid stream error")
                val details = error["details"] as? JsonObject ?: badNativeWire("invalid stream error details")
                val message = (error["message"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                    ?: badNativeWire("invalid stream error message")
                NativeStreamFrame.Failure(id, LinkClientException.Refused(error.text("code"), message,
                    WireValue.fromJsonElement(details)))
            }
            else -> badNativeWire("unknown mux frame")
        }
    }
}

internal sealed class NativeStreamFrame(val id: String) {
    class Item(id: String, val value: WireValue) : NativeStreamFrame(id)
    class End(id: String) : NativeStreamFrame(id)
    class Failure(id: String, val error: LinkClientException.Refused) : NativeStreamFrame(id)
}
