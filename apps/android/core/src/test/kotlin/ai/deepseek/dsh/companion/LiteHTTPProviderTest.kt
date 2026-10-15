package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LiteToolSchemas
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.net.http.HttpTimeoutException
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
        assertEquals(LiteTransportError.Network("timeout"), classifyTransportFailure(HttpTimeoutException("timed out")))
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
        val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/chat/completions") { exchange ->
            seenPath = exchange.requestURI.path
            seenBody = exchange.requestBody.readBytes().decodeToString()
            seenAuth = exchange.requestHeaders.getFirst("authorization") ?: ""
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
                ),
                chunks,
            )
            assertEquals("/v1/chat/completions", seenPath)
            assertEquals("Bearer sk-test", seenAuth)
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
