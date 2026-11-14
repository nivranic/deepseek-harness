package ai.deepseek.dsh.companion

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/**
 * The §54 network matrix's in-harness face: real-socket rounds over the
 * production [LiteHTTPProvider] transport. The pure failure classification,
 * the refused-connection round, the truncation refusal and the loop's
 * stub-provider error surfacing ride [LiteHTTPProviderTest] and
 * [LiteChatViewModelTest]; this file adds the rounds only a real transport
 * can prove — a slow first byte surviving the disabled read timeout, a
 * mid-stream reset reading as a dropped transport, and the loop surfacing a
 * real transport failure into its journal. The physical rig rows of the
 * matrix (LAN changes, cellular handoffs, VPN, host sleep and restart) stay
 * on the external acceptance ledger.
 */
class LiteNetworkMatrixTest {
    @Test
    fun aSlowFirstByteStillCompletesTheRound() = runTest {
        // The Link stream-transport shape keeps the read timeout disabled so an
        // idle long-lived stream outlives any fixed bound; a delayed first byte
        // is the matrix's latency row in its honest in-harness form.
        val server = com.sun.net.httpserver.HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/chat/completions") { exchange ->
            exchange.requestBody.readBytes()
            Thread.sleep(1_500)
            val bytes = listOf(
                """data: {"choices":[{"delta":{"content":"慢"}}]}""",
                """data: {"choices":[{"delta":{"content":"而"}}]}""",
                "data: [DONE]",
            ).joinToString("\n").encodeToByteArray()
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
            val chunks = provider.stream("问候").toList()
            assertEquals(
                listOf(LiteStreamChunk.Text("慢"), LiteStreamChunk.Text("而"), LiteStreamChunk.Finish(null)),
                chunks,
            )
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun aMidStreamResetIsADroppedTransport() = runTest {
        // The matrix's packet-loss row: a raw listener answers the request,
        // streams a partial body, then aborts the socket with a linger-zero
        // close so the client reads a reset rather than a clean end — the
        // dropped-transport path the pure classifier pins only on its own.
        val server = ServerSocket()
        server.bind(InetSocketAddress("127.0.0.1", 0))
        val accepted = java.util.concurrent.CompletableFuture<Unit>()
        val listener = Thread {
            try {
                val socket = server.accept()
                accepted.complete(Unit)
                // Read exactly the request the client owes: the headers to the
                // blank line, then Content-Length body bytes — the client keeps
                // its write side open awaiting the response, so reading to EOF
                // would deadlock the round.
                val input = socket.getInputStream()
                var contentLength = 0
                while (true) {
                    val line = buildString {
                        while (true) {
                            val byte = input.read()
                            if (byte == '\n'.code || byte < 0) break
                            append(byte.toChar())
                        }
                    }.trim()
                    if (line.isEmpty()) break
                    if (line.startsWith("content-length:", ignoreCase = true)) contentLength = line.substringAfter(':').trim().toInt()
                }
                val body = ByteArray(contentLength)
                var read = 0
                while (read < contentLength) {
                    val count = input.read(body, read, contentLength - read)
                    if (count < 0) break
                    read += count
                }
                socket.getOutputStream().apply {
                    write(
                        ("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: 64\r\n\r\n" +
                            """data: {"choices":[{"delta":{"content":"半"}}]}""").encodeToByteArray(),
                    )
                    flush()
                    Thread.sleep(200)
                }
                socket.setSoLinger(true, 0)
                socket.close()
            } catch (_: IOException) {
                // The client may abort its read first; the reset already left.
            }
        }
        listener.isDaemon = true
        listener.start()
        try {
            val provider = LiteHTTPProvider(
                endpoint = "http://127.0.0.1:${server.localPort}/v1/chat/completions",
                apiKey = "sk-test",
                model = "deepseek-chat",
            )
            try {
                provider.stream("继续").toList()
                fail("a mid-stream reset must throw")
            } catch (dropped: LiteTransportError.Network) {
                assertEquals("dropped", dropped.kind)
            }
        } finally {
            accepted.join()
            server.close()
            listener.join(5_000)
        }
    }

    @Test
    fun theLoopSurfacesARealTransportFailure() = runTest {
        // The loop-level surfacing round against the real transport: a refused
        // endpoint drives the production provider, and the folded state carries
        // the network failure with the measured kind — the stub-provider round
        // in LiteChatViewModelTest pins the shape; this round proves the seam
        // over a real socket.
        val probe = ServerSocket(0)
        val port = probe.localPort
        probe.close()
        val provider = LiteHTTPProvider(
            endpoint = "http://127.0.0.1:$port/v1/chat/completions",
            apiKey = "sk-test",
            model = "deepseek-chat",
        )
        val driver = LiteLoopDriver(
            scope = CoroutineScope(UnconfinedTestDispatcher(testScheduler)),
            provider = provider,
            execute = { _, _, _ -> fail("the refused round never reaches tool execution") },
        )
        driver.submit("触网").join()
        assertEquals(
            listOf(LiteFailure(kind = "network", code = "unreachable", message = "unreachable")),
            driver.fold.state.errors,
        )
    }
}
