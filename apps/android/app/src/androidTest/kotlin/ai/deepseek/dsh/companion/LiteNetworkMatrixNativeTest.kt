package ai.deepseek.dsh.companion

import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.nio.charset.StandardCharsets

/**
 * The §54 network matrix's device-side face: the production
 * [LiteHTTPProvider] transport driven over the Android process's own
 * network stack against a loopback listener inside the instrumentation
 * process — the latency row surviving the disabled read timeout, the
 * packet-loss row's mid-stream reset reading as a dropped transport, and
 * the refused-connection row surfacing as unreachable. Every listener is a
 * raw ServerSocket (the Android runtime carries no JDK HTTP server); the
 * debug overlay's network security config permits cleartext to loopback
 * only, and the physical rig rows of the matrix stay on the external
 * acceptance ledger.
 */
class LiteNetworkMatrixNativeTest {
    /** Read the request head through the blank line and exactly its Content-Length body; the client keeps its write side open, so reading to EOF would deadlock. */
    private fun readRequest(input: java.io.InputStream) {
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
    }

    @Test(timeout = 30_000)
    fun aSlowFirstByteStillCompletesTheRoundOnDevice() {
        val server = ServerSocket()
        server.bind(InetSocketAddress("127.0.0.1", 0))
        val listener = Thread {
            try {
                val socket = server.accept()
                readRequest(socket.getInputStream())
                Thread.sleep(1_500)
                socket.getOutputStream().apply {
                    write(
                        ("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: 91\r\n\r\n" +
                            """data: {"choices":[{"delta":{"content":"慢"}}]}""" + "\n" +
                            "data: [DONE]").toByteArray(StandardCharsets.UTF_8),
                    )
                    flush()
                }
                socket.close()
            } catch (_: IOException) {
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
            val chunks = runBlocking { provider.stream("问候").toList() }
            assertEquals(
                listOf(LiteStreamChunk.Text("慢"), LiteStreamChunk.Finish(null)),
                chunks,
            )
        } finally {
            server.close()
            listener.join(5_000)
        }
    }

    @Test(timeout = 30_000)
    fun aMidStreamResetIsADroppedTransportOnDevice() {
        val server = ServerSocket()
        server.bind(InetSocketAddress("127.0.0.1", 0))
        val listener = Thread {
            try {
                val socket = server.accept()
                readRequest(socket.getInputStream())
                socket.getOutputStream().apply {
                    write(
                        ("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: 64\r\n\r\n" +
                            """data: {"choices":[{"delta":{"content":"半"}}]}""").toByteArray(StandardCharsets.UTF_8),
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
                runBlocking { provider.stream("继续").toList() }
                fail("a mid-stream reset must throw")
            } catch (dropped: LiteTransportError.Network) {
                assertEquals("dropped", dropped.kind)
            }
        } finally {
            server.close()
            listener.join(5_000)
        }
    }

    @Test(timeout = 30_000)
    fun aRefusedConnectionIsUnreachableOnDevice() {
        val probe = ServerSocket(0)
        val port = probe.localPort
        probe.close()
        val provider = LiteHTTPProvider(
            endpoint = "http://127.0.0.1:$port/v1/chat/completions",
            apiKey = "sk-test",
            model = "deepseek-chat",
        )
        try {
            runBlocking { provider.stream("触网").toList() }
            fail("a refused connection must throw")
        } catch (network: LiteTransportError.Network) {
            assertEquals("unreachable", network.kind)
        }
    }
}
