package ai.deepseek.dsh.link

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.serializer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** The wire envelopes: encode the request exactly as the gateway expects,
 * decode results and stream frames exactly as the host sends them. */
class LinkWireTest {
    @Test
    fun requestEnvelopeCarriesTheGatewayWireForm() {
        val element = LinkRequestEnvelope(
            rpcId = "rpc-session/list",
            method = "session/list",
            args = mapOf("_request" to WireValue.ObjectValue(emptyMap())),
        ).toJsonElement()
        val obj = Json.parseToJsonElement(Json.encodeToString(JsonElement.serializer(), element)).let { it as kotlinx.serialization.json.JsonObject }
        assertEquals("client-request", obj["type"]!!.jsonPrimitiveText())
        assertEquals("rpc-session/list", obj["rpcId"]!!.jsonPrimitiveText())
        assertEquals("session/list", obj["method"]!!.jsonPrimitiveText())
        val payload = obj["payload"] as kotlinx.serialization.json.JsonObject
        assertEquals("{}", payload["_request"].toString())
    }

    @Test
    fun wireValueRoundTripsThroughJson() {
        val original = WireValue.ObjectValue(
            mapOf(
                "text" to WireValue.StringValue("你好"),
                "count" to WireValue.NumberValue(3.0),
                "flag" to WireValue.BoolValue(true),
                "none" to WireValue.NullValue,
                "list" to WireValue.ArrayValue(listOf(WireValue.StringValue("a"), WireValue.NumberValue(1.5))),
            ),
        )
        val encoded = Json.encodeToString(JsonElement.serializer(), original.toJsonElement())
        assertEquals(original, WireValue.fromJsonElement(Json.parseToJsonElement(encoded)))
    }

    @Test
    fun resultsDecodeOkAndRefused() {
        val ok = LinkResult.fromJsonElement(Json.parseToJsonElement("""{"ok":true,"value":{"items":[]}}"""))
        assertTrue(ok.ok)
        assertEquals(WireValue.ObjectValue(mapOf("items" to WireValue.ArrayValue(emptyList()))), ok.value)

        val refused = LinkResponseEnvelope.fromJsonElement(
            Json.parseToJsonElement("""{"type":"server-response","result":{"ok":false,"error":{"code":"link-disabled","message":"off"}}}"""),
        )
        assertEquals("server-response", refused.type)
        assertEquals("link-disabled", refused.result.errorCode)
        assertEquals("off", refused.result.errorMessage)
    }

    @Test
    fun streamFramesDecodeValueAndFailure() {
        val value = LinkStreamFrame.fromJsonElement(Json.parseToJsonElement("""{"k":"v","v":{"seq":1}}"""))
        assertEquals(false, value.isFailure)
        assertEquals(WireValue.ObjectValue(mapOf("seq" to WireValue.NumberValue(1.0))), value.value)

        val failure = LinkStreamFrame.fromJsonElement(Json.parseToJsonElement("""{"k":"e","c":"role","m":"denied"}"""))
        assertTrue(failure.isFailure)
        assertEquals("role", failure.code)
        assertEquals("denied", failure.message)
    }
}

private fun kotlinx.serialization.json.JsonElement.jsonPrimitiveText(): String =
    (this as kotlinx.serialization.json.JsonPrimitive).content
