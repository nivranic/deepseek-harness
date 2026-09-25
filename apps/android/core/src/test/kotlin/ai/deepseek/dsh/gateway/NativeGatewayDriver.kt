package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.link.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** Private-pipe driver for the production Kotlin transport against the real Host.
 * Output contains results selected by the test; credentials and pairing payloads are never emitted.
 */
object NativeGatewayDriver {
    @JvmStatic fun main(args: Array<String>) = runBlocking {
        require(args.isEmpty())
        val config = NativeGatewayConfig(LinkTransportConfig(5000, 5000, 5000, 10000, 0, 0), 32)
        val store = MemoryLinkCredentialsStore()
        var client: NativeGatewayClient? = null
        val streams = mutableMapOf<String, Job>()
        fun output(id: String, type: String, value: JsonElement = JsonNull) = synchronized(System.out) {
            println(buildJsonObject { put("id", id); put("type", type); put("value", value) })
        }
        fun failure(id: String, error: Throwable) = output(id, "error", buildJsonObject {
            put("code", (error as? LinkClientException.Refused)?.code ?: error.javaClass.simpleName)
        })
        try {
            while (true) {
                val line = withContext(Dispatchers.IO) { readlnOrNull() } ?: break
                val command = Json.parseToJsonElement(line).jsonObject
                val id = command.text("id")
                try {
                    when (command.text("op")) {
                        "pair" -> {
                            val next = NativeGatewayClient.pair(NativePairing.parse(command["payload"].toString()),
                                "Kotlin native test", store, config)
                            client?.closeAndAwait()
                            client = next
                            output(id, "ok")
                        }
                        "call" -> output(id, "ok", client!!.call(command.text("method"),
                            command["args"]!!.jsonObject.mapValues { WireValue.fromJsonElement(it.value) }).toJsonElement())
                        "open" -> {
                            check(!streams.containsKey(id))
                            streams[id] = launch {
                                try {
                                    client!!.stream(command.text("endpoint"), command["args"]!!.jsonObject.mapValues {
                                        WireValue.fromJsonElement(it.value)
                                    }).collect { output(id, "item", it.toJsonElement()) }
                                    output(id, "end")
                                } catch (error: CancellationException) { throw error }
                                catch (error: Exception) { failure(id, error) }
                            }
                        }
                        "cancel" -> { streams.remove(command.text("streamId"))?.cancelAndJoin(); output(id, "ok") }
                        "restore" -> {
                            client?.closeAndAwait()
                            client = NativeGatewayClient.restore(store, config)
                            check(client != null)
                            output(id, "ok")
                        }
                        "close" -> {
                            client?.closeAndAwait()
                            streams.values.forEach { it.join() }
                            streams.clear()
                            output(id, "ok")
                        }
                        else -> error("unknown driver operation")
                    }
                } catch (error: Exception) { failure(id, error) }
            }
        } finally {
            withContext(NonCancellable) {
                client?.closeAndAwait()
                streams.values.forEach { it.cancelAndJoin() }
            }
        }
    }
}
