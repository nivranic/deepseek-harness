package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LiteToolSchemas
import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolRisk
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

private fun entries(json: String): List<JsonObject> =
    Json.parseToJsonElement(json).jsonObject.let { obj ->
        ((obj["choices"] as? kotlinx.serialization.json.JsonArray)
            ?.firstOrNull() as? JsonObject
            )?.get("delta")?.let { delta ->
            (delta as JsonObject)["tool_calls"] as? kotlinx.serialization.json.JsonArray
        }?.filterIsInstance<JsonObject>() ?: emptyList()
    }

/** The pure line parser and fragment assembler. */
class LiteStreamParsingTest {
    @Test
    fun parsesSseAndBareNdjsonDeltas() {
        assertEquals(LiteStreamPiece.Reasoning("想"), LiteStreamLineParser.parsePiece("""data: {"choices":[{"delta":{"reasoning_content":"想"}}]}"""))
        assertEquals(LiteStreamPiece.Text("你好"), LiteStreamLineParser.parsePiece("""data: {"choices":[{"delta":{"content":"你好"}}]}"""))
        // A bare NDJSON line carries the same payload without the prefix.
        assertEquals(LiteStreamPiece.Text("世界"), LiteStreamLineParser.parsePiece("""{"choices":[{"delta":{"content":"世界"}}]}"""))
    }

    @Test
    fun skipsNonPayloadLines() {
        assertNull(LiteStreamLineParser.parsePiece(""))
        assertNull(LiteStreamLineParser.parsePiece("   "))
        assertNull(LiteStreamLineParser.parsePiece(": keep-alive"))
        assertNull(LiteStreamLineParser.parsePiece("data: [DONE]"))
        assertNull(LiteStreamLineParser.parsePiece("event: message"))
        assertNull(LiteStreamLineParser.parsePiece("not json"))
        assertNull(LiteStreamLineParser.parsePiece("""{"no":"choices"}"""))
        assertNull(LiteStreamLineParser.parsePiece("""{"choices":[{"delta":{"role":"assistant"}}]}"""))
    }

    @Test
    fun readsTheFinishReasonFromTheChoiceBeforeRequiringADelta() {
        // The terminal chunk carries finish_reason on the choice over an
        // empty or absent delta; the reason must survive the parse instead
        // of being dropped with the delta-less line.
        assertEquals(LiteStreamPiece.Finish("stop"), LiteStreamLineParser.parsePiece("""data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"""))
        assertEquals(LiteStreamPiece.Finish("tool_calls"), LiteStreamLineParser.parsePiece("""{"choices":[{"finish_reason":"tool_calls"}]}"""))
        assertNull(LiteStreamLineParser.parsePiece("""data: {"choices":[{"delta":{},"finish_reason":null}]}"""))
    }

    @Test
    fun assemblesFragmentsByIndexAndFlushesInOrder() {
        val assembler = LiteToolCallAssembler()
        assembler.ingest(entries("""{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"url_fetch","arguments":"{\"url\""}}]}}]}""")[0])
        assembler.ingest(entries("""{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"web_search","arguments":"{\"q\""}}]}}]}""")[0])
        assembler.ingest(entries("""{"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":":\"doc\"}"}}]}}]}""")[0])
        assembler.ingest(entries("""{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"lite\"}"}}]}}]}""")[0])

        assertEquals(
            listOf(
                LiteStreamChunk.ToolCall(id = "c1", name = "web_search", arguments = """{"q":"lite"}"""),
                LiteStreamChunk.ToolCall(id = "c2", name = "url_fetch", arguments = """{"url":"doc"}"""),
            ),
            assembler.finish(),
        )
        // Flushing retires the slots.
        assertTrue(assembler.finish().isEmpty())
    }

    @Test
    fun aNamelessSlotDefaultsItsIdAndIsDroppedUnnamed() {
        val assembler = LiteToolCallAssembler()
        // No id on the wire: the slot synthesizes one from its index.
        assembler.ingest(entries("""{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}""")[0])
        assertTrue(assembler.finish().isEmpty(), "a slot that never received a name is dropped")

        val named = LiteToolCallAssembler()
        named.ingest(entries("""{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"calculator","arguments":"1+"}}]}}]}""")[0])
        named.ingest(entries("""{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1"}}]}}]}""")[0])
        assertEquals(listOf(LiteStreamChunk.ToolCall(id = "tool-0", name = "calculator", arguments = "1+1")), named.finish())
    }

    @Test
    fun transportFailuresMapToTheirKinds() {
        // OkHttp raises SocketTimeoutException for every timeout flavor.
        assertEquals(LiteTransportError.Network("timeout"), classifyTransportFailure(SocketTimeoutException("connect timed out")))
        assertEquals(LiteTransportError.Network("timeout"), classifyTransportFailure(SocketTimeoutException()))
        assertEquals(LiteTransportError.Network("unreachable"), classifyTransportFailure(UnknownHostException("api.invalid")))
        assertEquals(LiteTransportError.Network("unreachable"), classifyTransportFailure(ConnectException("refused")))
        assertEquals(LiteTransportError.Network("dropped"), classifyTransportFailure(IOException("reset")))
    }
}

/** The provider loop against a real local HTTP server. */
class LiteHTTPProviderTest {
    @Test
    fun streamsASseResponseWithAssembledToolCalls() = runTest {
        var seenPath = ""
        var seenBody = ""
        var seenAuth = ""
        var seenAccept = ""
        var seenUserAgent = ""
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/chat/completions") { exchange ->
            seenPath = exchange.requestURI.path
            seenBody = exchange.requestBody.readBytes().decodeToString()
            seenAuth = exchange.requestHeaders.getFirst("authorization") ?: ""
            seenAccept = exchange.requestHeaders.getFirst("accept") ?: ""
            seenUserAgent = exchange.requestHeaders.getFirst("user-agent") ?: ""
            val stream = listOf(
                """data: {"choices":[{"delta":{"reasoning_content":"想"}}]}""",
                "",
                ": keep-alive",
                """data: {"choices":[{"delta":{"content":"你"}}]}""",
                """{"choices":[{"delta":{"content":"好"}}]}""",
                """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"web_search","arguments":"{\"q\""}}]}}]}""",
                """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"lite\"}"}}]}}]}""",
                "data: [DONE]",
            ).joinToString("\n")
            val bytes = stream.encodeToByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
            exchange.close()
        }
        server.start()
        try {
            val port = server.address.port
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:$port/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            val chunks = provider.stream("问好").toList()
            assertEquals(
                listOf(
                    LiteStreamChunk.Reasoning("想"),
                    LiteStreamChunk.Text("你"),
                    LiteStreamChunk.Text("好"),
                    LiteStreamChunk.ToolCall(id = "c1", name = "web_search", arguments = """{"q":"lite"}"""),
                    // This stream never stated a finish_reason, so it closes
                    // with a null-reason Finish.
                    LiteStreamChunk.Finish(null),
                ),
                chunks,
            )
            assertEquals("/v1/chat/completions", seenPath)
            assertEquals("Bearer sk-test", seenAuth)
            // The host provider's streaming face carries the SSE accept header.
            assertEquals("text/event-stream", seenAccept)
            // The companion's static product attribution: a literal identity,
            // never a runtime version.
            assertEquals("dsh-lite-companion/1.0", seenUserAgent)
            val request = Json.parseToJsonElement(seenBody).jsonObject
            assertEquals("deepseek-chat", (request["model"] as kotlinx.serialization.json.JsonPrimitive).content)
            val messages = request["messages"] as kotlinx.serialization.json.JsonArray
            assertEquals("问好", (((messages[0] as JsonObject)["content"]) as kotlinx.serialization.json.JsonPrimitive).content)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun aSystemPromptRidesFirstAndBareTurnsStayIdentical() = runTest {
        val seenBodies = mutableListOf<String>()
        val server = recordingServer(seenBodies)
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            provider.stream("问好", "sample-system").toList()
            provider.stream("问好").toList()
            provider.stream("问好", "").toList()

            val requests = seenBodies.map { Json.parseToJsonElement(it).jsonObject }
            requests.forEach { request ->
                assertEquals(setOf("model", "stream", "messages"), request.keys)
            }

            // A system prompt rides first, ahead of the user row.
            val withSystem = requests[0]["messages"] as kotlinx.serialization.json.JsonArray
            assertEquals(2, withSystem.size)
            assertEquals("system", ((withSystem[0] as JsonObject)["role"] as kotlinx.serialization.json.JsonPrimitive).content)
            assertEquals("sample-system", ((withSystem[0] as JsonObject)["content"] as kotlinx.serialization.json.JsonPrimitive).content)
            assertEquals("user", ((withSystem[1] as JsonObject)["role"] as kotlinx.serialization.json.JsonPrimitive).content)
            assertEquals("问好", ((withSystem[1] as JsonObject)["content"] as kotlinx.serialization.json.JsonPrimitive).content)

            // Null and empty system prompts leave the messages byte-identical
            // to a bare turn.
            for (bare in listOf(requests[1]["messages"], requests[2]["messages"])) {
                assertEquals(kotlinx.serialization.json.JsonArray(listOf(withSystem[1])), bare)
            }
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun historyTurnsExpandIntoTheWireMessageOrder() = runTest {
        val seenBodies = mutableListOf<String>()
        val server = recordingServer(seenBodies)
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            val history = listOf(
                LiteTurnRecord(
                    userText = "算",
                    rounds = listOf(
                        LiteTurnRound(
                            assistantText = "十四",
                            toolCalls = listOf(LiteTurnToolCall(id = "c1", name = "calculator", arguments = """{"expression":"2 + 3 * 4"}""")),
                            toolResults = mapOf("c1" to "14"),
                        ),
                    ),
                ),
            )
            provider.stream("再算", "sample-system", history).toList()

            // The follow-up request replays the prior turn in the host
            // provider's wire order: system, the turn's user row, the
            // assistant row carrying its tool call, the call's tool row,
            // then the new user row.
            val messages = (Json.parseToJsonElement(seenBodies.single()).jsonObject["messages"] as JsonArray)
            assertEquals(5, messages.size)
            assertEquals("system", ((messages[0] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("sample-system", ((messages[0] as JsonObject)["content"] as JsonPrimitive).content)
            assertEquals("user", ((messages[1] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("算", ((messages[1] as JsonObject)["content"] as JsonPrimitive).content)
            val assistant = messages[2] as JsonObject
            assertEquals("assistant", (assistant["role"] as JsonPrimitive).content)
            assertEquals("十四", (assistant["content"] as JsonPrimitive).content)
            val calls = assistant["tool_calls"] as JsonArray
            assertEquals(1, calls.size)
            val call = calls[0] as JsonObject
            assertEquals("c1", (call["id"] as JsonPrimitive).content)
            assertEquals("function", (call["type"] as JsonPrimitive).content)
            val function = call["function"] as JsonObject
            assertEquals("calculator", (function["name"] as JsonPrimitive).content)
            assertEquals("""{"expression":"2 + 3 * 4"}""", (function["arguments"] as JsonPrimitive).content)
            val toolRow = messages[3] as JsonObject
            assertEquals("tool", (toolRow["role"] as JsonPrimitive).content)
            assertEquals("c1", (toolRow["tool_call_id"] as JsonPrimitive).content)
            assertEquals("14", (toolRow["content"] as JsonPrimitive).content)
            assertEquals("user", ((messages[4] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("再算", ((messages[4] as JsonObject)["content"] as JsonPrimitive).content)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun theFinishReasonRidesAfterTheAssembledCallsAndADoneWithoutOneFinishesNull() = runTest {
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/chat/completions") { exchange ->
            val stream = listOf(
                """data: {"choices":[{"delta":{"content":"查"}}]}""",
                """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"calculator","arguments":"{\"expression\":\"1\"}"}}]}}]}""",
                """data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}""",
                "data: [DONE]",
            ).joinToString("\n")
            val bytes = stream.encodeToByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
            exchange.close()
        }
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            // The host translate's delayed finish: the stated reason rides
            // last, after the assembled tool calls.
            assertEquals(
                listOf(
                    LiteStreamChunk.Text("查"),
                    LiteStreamChunk.ToolCall(id = "c1", name = "calculator", arguments = """{"expression":"1"}"""),
                    LiteStreamChunk.Finish("tool_calls"),
                ),
                provider.stream("算").toList(),
            )
        } finally {
            server.stop(0)
        }

        // A stream the wire never stated a reason for still finishes — with
        // a null reason rather than a guessed one.
        val bareBodies = mutableListOf<String>()
        val bare = recordingServer(bareBodies)
        bare.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${bare.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            assertEquals(listOf(LiteStreamChunk.Finish(null)), provider.stream("问好").toList())
        } finally {
            bare.stop(0)
        }
    }

    @Test
    fun multiRoundTurnsInterleaveAssistantAndToolRowsRoundByRound() = runTest {
        val seenBodies = mutableListOf<String>()
        val server = recordingServer(seenBodies)
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            val history = listOf(
                LiteTurnRecord(
                    userText = "算",
                    rounds = listOf(
                        LiteTurnRound(
                            assistantText = "先算",
                            toolCalls = listOf(LiteTurnToolCall(id = "c1", name = "calculator", arguments = """{"expression":"2 + 3 * 4"}""")),
                            toolResults = mapOf("c1" to "14"),
                        ),
                        LiteTurnRound(
                            assistantText = null,
                            toolCalls = listOf(LiteTurnToolCall(id = "c2", name = "artifact_create", arguments = """{"id":"spec","kind":"markdown"}""")),
                            toolResults = mapOf("c2" to "written"),
                        ),
                        LiteTurnRound(assistantText = "全部完成", toolCalls = emptyList(), toolResults = emptyMap()),
                    ),
                ),
            )
            provider.stream("继续", history = history).toList()

            // The host provider's serialize order for a continued turn:
            // the user row, then each round's assistant row followed by its
            // tool rows — assistant(calls1), tool(c1), assistant(calls2),
            // tool(c2), assistant(text3) — before the new user row.
            val messages = (Json.parseToJsonElement(seenBodies.single()).jsonObject["messages"] as JsonArray)
            assertEquals(7, messages.size)
            assertEquals("user", ((messages[0] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("算", ((messages[0] as JsonObject)["content"] as JsonPrimitive).content)
            val first = messages[1] as JsonObject
            assertEquals("assistant", (first["role"] as JsonPrimitive).content)
            assertEquals("先算", (first["content"] as JsonPrimitive).content)
            assertEquals("c1", (((first["tool_calls"] as JsonArray)[0] as JsonObject)["id"] as JsonPrimitive).content)
            assertEquals("tool", ((messages[2] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("c1", ((messages[2] as JsonObject)["tool_call_id"] as JsonPrimitive).content)
            assertEquals("14", ((messages[2] as JsonObject)["content"] as JsonPrimitive).content)
            val second = messages[3] as JsonObject
            assertEquals("assistant", (second["role"] as JsonPrimitive).content)
            assertEquals("", (second["content"] as JsonPrimitive).content)
            assertEquals("c2", (((second["tool_calls"] as JsonArray)[0] as JsonObject)["id"] as JsonPrimitive).content)
            assertEquals("tool", ((messages[4] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("c2", ((messages[4] as JsonObject)["tool_call_id"] as JsonPrimitive).content)
            assertEquals("written", ((messages[4] as JsonObject)["content"] as JsonPrimitive).content)
            val third = messages[5] as JsonObject
            assertEquals("assistant", (third["role"] as JsonPrimitive).content)
            assertEquals("全部完成", (third["content"] as JsonPrimitive).content)
            // The request's own user row lands after the replayed turn.
            assertEquals("user", ((messages[6] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("继续", ((messages[6] as JsonObject)["content"] as JsonPrimitive).content)
        } finally {
            server.stop(0)
        }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test
    fun theLoopDrivesARealContinuationRequestOverToolCalls() = runTest {
        val seenBodies = mutableListOf<String>()
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/chat/completions") { exchange ->
            seenBodies.add(exchange.requestBody.readBytes().decodeToString())
            val isFirst = seenBodies.size == 1
            val stream = (
                if (isFirst) listOf(
                    """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"calculator","arguments":"{\"expression\":\"2 + 3 * 4\"}"}}]}}]}""",
                    """data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}""",
                ) else listOf(
                    """data: {"choices":[{"delta":{"content":"结果是 14"}}]}""",
                    """data: {"choices":[{"delta":{},"finish_reason":"stop"}]}""",
                )
                ) + "data: [DONE]"
            val bytes = stream.joinToString("\n").encodeToByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
            exchange.close()
        }
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            val driver = LiteLoopDriver(
                CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
                provider,
                execute = { _, name, arguments ->
                    when (name) {
                        "calculator" -> LiteToolExecutors.calculator(arguments)
                        else -> LiteToolOutcome(ok = false, text = "no on-device executor mounted: $name")
                    }
                },
                toolCatalog = LiteToolCatalog.fromHostDescriptors(
                    listOf(
                        ToolDescriptor("calculator", 1, ToolRisk.LOW, emptyList(), supportsLite = true, supportsRemote = true),
                    ),
                ),
            )
            driver.submit("算").join()

            // One turn, two requests: the tool_calls finish continued the
            // turn, and the continuation's wire body replays the completed
            // round in the host's interleave — assistant(calls, ""),
            // tool(14) — ahead of the turn's own user row.
            assertEquals(2, seenBodies.size)
            assertEquals(
                listOf(LiteMessage(role = "user", text = "算"), LiteMessage(role = "assistant", text = ""), LiteMessage(role = "assistant", text = "结果是 14")),
                driver.fold.state.conversation,
            )
            assertEquals("completed", driver.fold.state.lastTurnEnd)
            val messages = (Json.parseToJsonElement(seenBodies[1]).jsonObject["messages"] as JsonArray)
            assertEquals(4, messages.size)
            assertEquals("user", ((messages[0] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("算", ((messages[0] as JsonObject)["content"] as JsonPrimitive).content)
            val assistant = messages[1] as JsonObject
            assertEquals("assistant", (assistant["role"] as JsonPrimitive).content)
            assertEquals("", (assistant["content"] as JsonPrimitive).content)
            val calls = assistant["tool_calls"] as JsonArray
            assertEquals(1, calls.size)
            val call = calls[0] as JsonObject
            assertEquals("c1", (call["id"] as JsonPrimitive).content)
            assertEquals("calculator", (((call["function"] as JsonObject)["name"]) as JsonPrimitive).content)
            assertEquals("""{"expression":"2 + 3 * 4"}""", (((call["function"] as JsonObject)["arguments"]) as JsonPrimitive).content)
            val toolRow = messages[2] as JsonObject
            assertEquals("tool", (toolRow["role"] as JsonPrimitive).content)
            assertEquals("c1", (toolRow["tool_call_id"] as JsonPrimitive).content)
            assertEquals("14", (toolRow["content"] as JsonPrimitive).content)
            // The continuation request's own user row closes the replay.
            assertEquals("user", ((messages[3] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("算", ((messages[3] as JsonObject)["content"] as JsonPrimitive).content)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun anEmptyTurnKeepsOnlyItsUserRowAndAnEmptyToolAnswerSaysNoOutput() = runTest {
        val seenBodies = mutableListOf<String>()
        val server = recordingServer(seenBodies)
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            val history = listOf(
                // A provider-error turn carries neither reply text nor
                // calls, so only its user row reaches the wire.
                LiteTurnRecord(userText = "失败了", rounds = emptyList()),
                LiteTurnRecord(
                    userText = "算",
                    rounds = listOf(
                        LiteTurnRound(
                            assistantText = null,
                            toolCalls = listOf(LiteTurnToolCall(id = "c1", name = "calculator", arguments = "{}")),
                            toolResults = mapOf("c1" to ""),
                        ),
                    ),
                ),
            )
            provider.stream("再来", history = history).toList()

            val messages = (Json.parseToJsonElement(seenBodies.single()).jsonObject["messages"] as JsonArray)
            assertEquals(5, messages.size)
            assertEquals("user", ((messages[0] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("失败了", ((messages[0] as JsonObject)["content"] as JsonPrimitive).content)
            assertEquals("user", ((messages[1] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("算", ((messages[1] as JsonObject)["content"] as JsonPrimitive).content)
            // A text-less tool-carrying reply rides "" content, the host's
            // never-null rule; an empty result text answers "(no output)".
            val assistant = messages[2] as JsonObject
            assertEquals("assistant", (assistant["role"] as JsonPrimitive).content)
            assertEquals("", (assistant["content"] as JsonPrimitive).content)
            assertEquals(1, (assistant["tool_calls"] as JsonArray).size)
            val toolRow = messages[3] as JsonObject
            assertEquals("tool", (toolRow["role"] as JsonPrimitive).content)
            assertEquals("c1", (toolRow["tool_call_id"] as JsonPrimitive).content)
            assertEquals("(no output)", (toolRow["content"] as JsonPrimitive).content)
            assertEquals("user", ((messages[4] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("再来", ((messages[4] as JsonObject)["content"] as JsonPrimitive).content)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun projectedToolSchemasRideTheToolsArray() = runTest {
        val fixture = javaClass.classLoader.getResource("fixtures/lite-tool-schemas.sample.json")!!
        val schemas = LiteToolSchemas.parseDocument(fixture.readText(Charsets.UTF_8))
        val seenBodies = mutableListOf<String>()
        val server = recordingServer(seenBodies)
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
                toolSchemas = schemas,
            )
            provider.stream("问好").toList()
            provider.stream("问好", "sample-system").toList()

            val requests = seenBodies.map { Json.parseToJsonElement(it).jsonObject }
            requests.forEach { request ->
                assertEquals(setOf("model", "stream", "messages", "tools"), request.keys)
            }

            // The fixture's two schemas pin the complete OpenAI
            // function-tools array; tools[0] is compared field by field.
            val expectedTools = JsonArray(schemas.map { schema -> buildJsonObject {
                put("type", "function")
                put("function", buildJsonObject {
                    put("name", schema.name)
                    put("description", schema.description)
                    put("parameters", schema.parameters)
                })
            } })
            requests.forEach { request -> assertEquals(expectedTools, request["tools"]) }
            val first = (requests[0]["tools"] as JsonArray)[0] as JsonObject
            assertEquals("function", (first["type"] as JsonPrimitive).content)
            val function = first["function"] as JsonObject
            assertEquals(schemas[0].name, (function["name"] as JsonPrimitive).content)
            assertEquals(schemas[0].description, (function["description"] as JsonPrimitive).content)
            assertEquals(schemas[0].parameters, function["parameters"])

            // A bare turn with tools keeps exactly the single user row; a
            // system turn still rides first inside messages.
            val bareMessages = requests[0]["messages"] as JsonArray
            assertEquals(1, bareMessages.size)
            assertEquals("user", ((bareMessages[0] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("问好", ((bareMessages[0] as JsonObject)["content"] as JsonPrimitive).content)
            val withSystem = requests[1]["messages"] as JsonArray
            assertEquals(2, withSystem.size)
            assertEquals("system", ((withSystem[0] as JsonObject)["role"] as JsonPrimitive).content)
            assertEquals("sample-system", ((withSystem[0] as JsonObject)["content"] as JsonPrimitive).content)
            assertEquals("user", ((withSystem[1] as JsonObject)["role"] as JsonPrimitive).content)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun aNonTwoHundredRefusalIsAProviderError() = runTest {
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/chat/completions") { exchange ->
            val bytes = "rate limited".encodeToByteArray()
            exchange.sendResponseHeaders(429, bytes.size.toLong())
            exchange.responseBody.write(bytes)
            exchange.close()
        }
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            try {
                provider.stream("继续").toList()
                fail("a refusal must throw")
            } catch (refused: LiteTransportError.Provider) {
                assertEquals("HTTP_429", refused.code)
            }
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun aStreamThatEndsBeforeDoneIsTruncation() = runTest {
        // EOF without the [DONE] terminator is the host's STREAM_CLOSED rule:
        // the delivered text chunks stand, but the truncated stream is not
        // trusted — the assembled tool call never flushes.
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/chat/completions") { exchange ->
            val stream = listOf(
                """data: {"choices":[{"delta":{"content":"半"}}]}""",
                """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"web_search","arguments":"{\"q\""}}]}}]}""",
            ).joinToString("\n")
            val bytes = stream.encodeToByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes)
            exchange.close()
        }
        server.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.address.port}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            val collected = mutableListOf<LiteStreamChunk>()
            try {
                provider.stream("继续").collect { collected.add(it) }
                fail("a truncated stream must throw")
            } catch (truncated: LiteTransportError.Provider) {
                assertEquals("STREAM_CLOSED", truncated.code)
            }
            assertEquals<List<LiteStreamChunk>>(listOf(LiteStreamChunk.Text("半")), collected)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun aRefusedConnectionIsANetworkError() = runTest {
        // Bind a raw socket and close it: unlike an unstarted HttpServer's
        // stop, ServerSocket.close() deterministically closes the listener,
        // so the connect below meets a refused port.
        val probe = java.net.ServerSocket(0)
        val port = probe.localPort
        probe.close()

        val provider = LiteHTTPProvider(
            endpoint = "http://127.0.0.1:$port/v1/chat/completions",
            apiKey = "sk-test",
            model = "deepseek-chat",
        )
        try {
            provider.stream("继续").toList()
            fail("a refused connection must throw")
        } catch (network: LiteTransportError.Network) {
            assertEquals("unreachable", network.kind)
        }
    }

    /** A local server that records each request body and answers with an empty SSE stream. */
    private fun recordingServer(bodies: MutableList<String>): com.sun.net.httpserver.HttpServer =
        com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/v1/chat/completions") { exchange ->
                bodies.add(exchange.requestBody.readBytes().decodeToString())
                val bytes = "data: [DONE]".encodeToByteArray()
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.write(bytes)
                exchange.close()
            }
        }
}
