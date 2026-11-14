package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlin.test.*

class NativeHttpRequestBudgetTest {
    private fun budget(value: WireValue) = WireValue.ObjectValue(mapOf("maxRequestBodyBytes" to value))

    @Test fun `positive safe integers accept extension fields without truncation`() {
        for (maximum in listOf(1L, 2048L, 9_007_199_254_740_991L)) {
            val value = WireValue.ObjectValue(mapOf(
                "maxRequestBodyBytes" to WireValue.NumberValue(maximum.toDouble()),
                "future" to WireValue.ObjectValue(mapOf("unit" to WireValue.StringValue("bytes"))),
            ))
            assertEquals(maximum, NativeHttpRequestBudget.parse(value).maxRequestBodyBytes)
        }
    }

    @Test fun `missing nonnumeric fractional nonfinite and unsafe limits reject without fallback`() {
        val invalid = listOf(
            WireValue.NullValue, WireValue.StringValue("2048"), WireValue.BoolValue(true),
            WireValue.ArrayValue(emptyList()), WireValue.ObjectValue(emptyMap()),
            budget(WireValue.NullValue), budget(WireValue.StringValue("2048")), budget(WireValue.BoolValue(true)),
            budget(WireValue.NumberValue(0.0)), budget(WireValue.NumberValue(-1.0)),
            budget(WireValue.NumberValue(1.5)), budget(WireValue.NumberValue(Double.NaN)),
            budget(WireValue.NumberValue(Double.POSITIVE_INFINITY)), budget(WireValue.NumberValue(Double.NEGATIVE_INFINITY)),
            budget(WireValue.NumberValue(9_007_199_254_740_992.0)),
        )
        for (value in invalid) assertFailsWith<LinkClientException.BadWire> { NativeHttpRequestBudget.parse(value) }
    }

    @Test fun `inclusive limit measures UTF-8 bytes and reports the local overflow counts`() {
        val body = "界🙂\"\\\n".toByteArray(Charsets.UTF_8)
        assertTrue(body.size > "界🙂\"\\\n".length)
        NativeHttpRequestBudget.parse(budget(WireValue.NumberValue(body.size.toDouble()))).requireFits(body)
        val failure = assertFailsWith<NativeHttpRequestTooLarge> {
            NativeHttpRequestBudget.parse(budget(WireValue.NumberValue(body.size - 1.0))).requireFits(body)
        }
        assertEquals(body.size.toLong(), failure.actualBodyBytes)
        assertEquals(body.size - 1L, failure.maxRequestBodyBytes)
    }
}
