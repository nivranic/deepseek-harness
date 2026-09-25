package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.link.*
import ai.deepseek.dsh.companion.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
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
        val modelScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        var interactions: InteractionModel? = null
        val streams = mutableMapOf<String, Job>()
        suspend fun stopModels() { interactions?.stopWatchingAndAwait(); interactions = null }
        fun output(id: String, type: String, value: JsonElement = JsonNull) = synchronized(System.out) {
            println(buildJsonObject { put("id", id); put("type", type); put("value", value) })
        }
        fun failure(id: String, error: Throwable) = output(id, "error", buildJsonObject {
            put("code", (error as? LinkClientException.Refused)?.code ?: error.javaClass.simpleName)
            interactions?.connectionSnapshot?.let {
                put("interactionState", it.state.wire)
                put("interactionFailure", it.lastFailure?.wire ?: "none")
            }
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
                            stopModels()
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
                            stopModels()
                            client?.closeAndAwait()
                            client = NativeGatewayClient.restore(store, config)
                            check(client != null)
                            output(id, "ok")
                        }
                        "close" -> {
                            stopModels()
                            client?.closeAndAwait()
                            streams.values.forEach { it.join() }
                            streams.clear()
                            output(id, "ok")
                        }
                        "watchInteractions" -> {
                            stopModels()
                            val model = InteractionModel(client!!, modelScope)
                            interactions = model
                            model.startWatching()
                            withTimeout(15000) { model.clientId.first { it.isNotEmpty() } }
                            output(id, "ok")
                        }
                        "answerQuestion" -> {
                            val model = checkNotNull(interactions)
                            val pending = withTimeout(15000) { model.inbox.first { it.isNotEmpty() }.single() }
                            check(pending.kind == PendingInteraction.Kind.QUESTION && pending.questions.size == 1)
                            val selected = command["selected"]!!.jsonArray.map { it.jsonPrimitive.content }
                            val custom = command["custom"]?.jsonPrimitive?.content
                            model.answerQuestions(pending, listOf(CompanionQuestionAnswer(pending.questions.single().id, selected, custom)))
                            val refused = model.lastRefusal.value
                            if (refused != null) {
                                val code = Regex("^refused ([^: ]+):").find(refused)?.groupValues?.get(1)
                                    ?: when (refused) {
                                        "Remote Event stream is not ready." -> "driver/not-ready"
                                        "Interaction is no longer pending." -> "driver/not-pending"
                                        "invalid Remote method" -> "driver/invalid-method"
                                        else -> "driver/local-refusal"
                                    }
                                throw LinkClientException.Refused(code, "model reply failed")
                            }
                            check(model.inbox.value.isEmpty())
                            output(id, "ok")
                        }
                        "readModelFile" -> {
                            val model = FilesModel(client!!, modelScope)
                            model.selectSession(command.text("sessionId"))
                            model.readFile(command.text("path"))
                            if (model.openFileError.value != null) {
                                output(id, "error", buildJsonObject { put("code", "driver/file-read-failed") })
                                continue
                            }
                            withTimeout(15000) {
                                while (checkNotNull(model.openFile.value).hasMore) {
                                    model.loadMore()
                                    check(model.openFileError.value == null)
                                }
                            }
                            val file = checkNotNull(model.openFile.value)
                            output(id, "ok", buildJsonObject {
                                put("lines", file.loadedLines)
                                put("digest", LinkSigning.sha256Hex(file.text.toByteArray(Charsets.UTF_8)))
                            })
                        }
                        "observeSession" -> {
                            val model = SessionModel(client!!, modelScope)
                            try {
                                model.openSession(command.text("sessionId"))
                                val opened = withTimeout(15000) { model.open.first { current ->
                                    current?.state?.items?.any { it.text.contains("DONE") } == true
                                } }!!
                                output(id, "ok", buildJsonObject { put("rows", opened.state.items.size); put("done", true) })
                            } finally { model.closeAndAwait() }
                        }
                        else -> error("unknown driver operation")
                    }
                } catch (error: Exception) { failure(id, error) }
            }
        } finally {
            withContext(NonCancellable) {
                stopModels()
                client?.closeAndAwait()
                streams.values.forEach { it.cancelAndJoin() }
                modelScope.cancel()
            }
        }
    }
}
