package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.flow.Flow

/** The wire surface the companion models drive — the Kotlin mirror of the
 * Swift `CompanionWireDriving`; tests drive a fake, the app a LinkClient. */
interface WireDriving {
    suspend fun call(method: String, args: Map<String, WireValue> = emptyMap()): WireValue

    fun stream(endpoint: String, payload: Map<String, WireValue> = emptyMap()): Flow<WireValue>
}

/** The wire over one paired [ai.deepseek.dsh.link.LinkClient]. */
class LinkWireDriving(private val client: ai.deepseek.dsh.link.LinkClient) : WireDriving {
    override suspend fun call(method: String, args: Map<String, WireValue>): WireValue =
        client.call(method, args)

    override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> =
        client.stream(endpoint, payload)
}

/** Wire-shaped field access shared by the models: one level deep, absent or
 * mistyped fields read as null. */
object WireShape {
    fun string(value: WireValue, field: String): String? =
        ((value as? WireValue.ObjectValue)?.entries?.get(field) as? WireValue.StringValue)?.value

    fun number(value: WireValue, field: String): Double? =
        ((value as? WireValue.ObjectValue)?.entries?.get(field) as? WireValue.NumberValue)?.value

    fun array(value: WireValue, field: String): List<WireValue>? =
        ((value as? WireValue.ObjectValue)?.entries?.get(field) as? WireValue.ArrayValue)?.items

    fun objectValue(value: WireValue, field: String): WireValue? =
        (value as? WireValue.ObjectValue)?.entries?.get(field)?.takeIf { it is WireValue.ObjectValue }
}
