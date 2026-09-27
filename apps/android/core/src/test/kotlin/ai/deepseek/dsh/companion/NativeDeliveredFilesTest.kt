package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeDeliveredFilesTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun event(seq: Int, data: String) = """{"type":"event","event":{"seq":$seq,"type":"deliverables/presented","data":$data}}"""

    @Test fun `delivery references retain durable coordinates exact paths and descriptions`() {
        val data = """{"turn":1,"callId":"call","files":[{"path":"报告.txt","description":"说明"},{"path":" "},{"path":"other.bin"}]}"""
        assertEquals(listOf(NativeDeliveredFile(3, 0, "报告.txt", "说明"), NativeDeliveredFile(3, 2, "other.bin", null)),
            nativeDeliveredFiles(listOf(value(event(3, data)))))
        assertTrue(nativeDeliveredFiles(listOf(value(event(3, data).replace("deliverables/presented", "artifact/created")))).isEmpty())
    }

    @Test fun `incomplete declarations never become usable file references`() {
        for (data in listOf("{}", """{"turn":0,"callId":"call","files":[{"path":"a"}]}""",
            """{"turn":1,"callId":"","files":[{"path":"a"}]}""",
            """{"turn":1,"callId":"call","files":[{"path":"a","description":2}]}""")) {
            assertTrue(nativeDeliveredFiles(listOf(value(event(0, data)))).isEmpty())
        }
    }

    @Test fun `snapshot live and Session replacement expose only current loaded delivery records`() = runTest {
        val wire = FakeWire()
        val model = SessionModel(wire, backgroundScope)
        val data = """{"turn":1,"callId":"call","files":[{"path":"report.txt"}]}"""
        model.openSession("session"); runCurrent()
        wire.emit(value("""{"type":"snapshot","header":{"id":"session"},"cursor":0,"hasMore":false,"records":[${event(0, data)}]}""")); runCurrent()
        wire.emit(value(event(1, data))); runCurrent()
        assertEquals(listOf(0L, 1L), model.deliveredFiles.value.map { it.seq })
        wire.clearFrames(); model.openSession("other"); runCurrent()
        assertTrue(model.deliveredFiles.value.isEmpty())
        model.closeAndAwait()
        assertTrue(wire.calls.isEmpty())
    }

    @Test fun `inert classification preserves unknown bytes and rejects malformed UTF8 as text`() {
        assertEquals("image/png", nativeResourceMedia(byteArrayOf(0x89.toByte(), 80, 78, 71, 13, 10, 26, 10)))
        assertEquals("application/zip", nativeResourceMedia(byteArrayOf(80, 75, 3, 4)))
        assertNull(nativeResourceMedia(byteArrayOf(80, 75)))
        assertEquals("报告", nativeResourceText("报告".toByteArray()))
        assertEquals("", nativeResourceText(byteArrayOf()))
        assertNull(nativeResourceText(byteArrayOf(0xff.toByte())))
        assertNull(nativeResourceText(byteArrayOf(0)))
        assertEquals("00000000  00 ff", nativeResourceHex(byteArrayOf(0, 0xff.toByte())))
    }
}
