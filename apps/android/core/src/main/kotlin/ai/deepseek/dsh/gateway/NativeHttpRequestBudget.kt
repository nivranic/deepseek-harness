package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.link.WireValue
import kotlinx.serialization.json.JsonObject

/** Local refusal before transport creation; byte counts cover the complete encoded HTTP body. */
class NativeHttpRequestTooLarge(val actualBodyBytes: Long, val maxRequestBodyBytes: Long) :
    Exception("native HTTP request body exceeds Host byte budget")

/** One listener's advertised inclusive body limit, valid only for the explicit upload that queried it. */
internal class NativeHttpRequestBudget private constructor(val maxRequestBodyBytes: Long) {
    fun requireFits(body: ByteArray) {
        if (body.size.toLong() > maxRequestBodyBytes) {
            throw NativeHttpRequestTooLarge(body.size.toLong(), maxRequestBodyBytes)
        }
    }

    companion object {
        fun parse(value: WireValue): NativeHttpRequestBudget {
            val fields = value.toJsonElement() as? JsonObject ?: badNativeWire("invalid native HTTP request budget")
            val maximum = fields.integer("maxRequestBodyBytes")
            if (maximum == 0L) badNativeWire("invalid native HTTP request budget")
            return NativeHttpRequestBudget(maximum)
        }
    }
}
