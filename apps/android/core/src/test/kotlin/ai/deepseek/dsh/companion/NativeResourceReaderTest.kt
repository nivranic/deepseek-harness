package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.IOException
import java.util.Base64
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeResourceReaderTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun stat(size: Int?, version: String = "v1") =
        """"absolutePath":"/workspace/报告.bin","version":"$version"${if (size == null) "" else ",\"bytes\":$size"}"""
    private fun page(offset: Int, bytes: ByteArray, size: Int?, eof: Boolean, version: String = "v1") = value(
        """{${stat(size, version)},"offset":$offset,"data":"${Base64.getEncoder().encodeToString(bytes)}","eof":$eof}""")
    private fun offsets(wire: FakeWire) = wire.calls.filter { it.first == "workspaceFiles/readBytes" }.map {
        WireShape.number(it.second.getValue("range"), "offset")!!.toInt()
    }

    @Test fun `empty and Unicode-named files use the selected Session scope and complete with zero bytes`() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/stat") { value("{${stat(0)}}") }
        wire.stub("workspaceFiles/readBytes") { page(0, byteArrayOf(), 0, true) }
        val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
        reader.open("selected", "报告.bin"); runCurrent()
        val state = reader.state.value!!
        assertEquals(NativeResourcePhase.READY, state.phase)
        assertEquals(0, state.receivedBytes)
        assertContentEquals(byteArrayOf(), state.content)
        assertTrue(wire.calls.all { it.second["workspaceFileScopeId"] == WireValue.StringValue("selected") })
        assertTrue(wire.calls.all { it.second["path"] == WireValue.StringValue("报告.bin") })
    }

    @Test fun `interrupted reads retain same-version bytes and retry only the missing suffix`() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/stat") { value("{${stat(6)}}") }
        wire.stubSequence("workspaceFiles/readBytes", listOf(
            { page(0, byteArrayOf(0, 1, 2, 3), 6, false) },
            { throw IOException("offline") },
            { page(4, byteArrayOf(4, 5), 6, true) },
        ))
        val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
        reader.open("session", "报告.bin"); runCurrent()
        assertEquals(NativeResourcePhase.FAILED, reader.state.value!!.phase)
        assertEquals(4, reader.state.value!!.receivedBytes)
        assertContentEquals(byteArrayOf(0, 1), reader.state.value!!.prefix)
        reader.retry(); runCurrent()
        assertEquals(listOf(0, 4, 4), offsets(wire))
        assertContentEquals(byteArrayOf(0, 1, 2, 3, 4, 5), reader.state.value!!.content)
        assertEquals(2, wire.calls.count { it.first == "workspaceFiles/stat" })
    }

    @Test fun `changed versions discard the prefix and require a fresh open before further reads`() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/stat") { value("{${stat(6)}}") }
        wire.stubSequence("workspaceFiles/readBytes", listOf(
            { page(0, byteArrayOf(1, 2, 3, 4), 6, false) },
            { throw IOException("offline") },
        ))
        val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
        reader.open("session", "报告.bin"); runCurrent()
        wire.stub("workspaceFiles/stat") { value("{${stat(2, "v2")}}") }
        reader.retry(); runCurrent()
        assertEquals(NativeResourcePhase.CHANGED, reader.state.value!!.phase)
        assertEquals(0, reader.state.value!!.receivedBytes)
        assertTrue(reader.state.value!!.prefix.isEmpty())
        reader.retry(); runCurrent()
        assertEquals(2, offsets(wire).size)
        wire.stub("workspaceFiles/readBytes") { page(0, byteArrayOf(9, 8), 2, true, "v2") }
        reader.open("session", "报告.bin"); runCurrent()
        assertContentEquals(byteArrayOf(9, 8), reader.state.value!!.content)
    }

    @Test fun `invalid windows preserve the accepted prefix without publishing corrupt content`() = runTest {
        val bad = listOf(
            page(3, byteArrayOf(4, 5), 6, true),
            page(4, byteArrayOf(), 6, false),
            page(4, byteArrayOf(4, 5), 6, false),
            page(4, byteArrayOf(4), 6, true),
            value("""{${stat(6)},"offset":4,"data":"!!!!","eof":true}"""),
            page(4, byteArrayOf(4, 5, 6, 7, 8), 6, true),
        )
        for (result in bad) {
            val wire = FakeWire()
            wire.stub("workspaceFiles/stat") { value("{${stat(6)}}") }
            wire.stubSequence("workspaceFiles/readBytes", listOf(
                { page(0, byteArrayOf(0, 1, 2, 3), 6, false) }, { result },
            ))
            val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
            reader.open("session", "报告.bin"); runCurrent()
            assertEquals(NativeResourcePhase.FAILED, reader.state.value!!.phase)
            assertEquals(ConnectionFailure.INVALID_RESPONSE, reader.state.value!!.failure)
            assertEquals(4, reader.state.value!!.receivedBytes)
            assertNull(reader.state.value!!.content)
            reader.closeAndAwait()
        }
    }

    @Test fun `large known files request only a bounded preview and never claim a complete download`() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/stat") { value("{${stat(1000)}}") }
        wire.stub("workspaceFiles/readBytes") { page(0, byteArrayOf(0, 1), 1000, false) }
        val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
        reader.open("session", "报告.bin"); runCurrent()
        assertEquals(NativeResourcePhase.PREVIEW, reader.state.value!!.phase)
        assertEquals(2.0, WireShape.number(wire.calls.last().second.getValue("range"), "length"))
        assertEquals(listOf(0), offsets(wire))
        assertNull(reader.state.value!!.content)
    }

    @Test fun `unknown-size files stop at the retention budget while each window remains bounded`() = runTest {
        val wire = FakeWire()
        wire.stub("workspaceFiles/stat") { value("{${stat(null)}}") }
        wire.stubSequence("workspaceFiles/readBytes", listOf(
            { page(0, byteArrayOf(0, 1, 2, 3), null, false) }, { page(4, byteArrayOf(4, 5, 6, 7), null, false) },
        ))
        val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
        reader.open("session", "报告.bin"); runCurrent()
        assertEquals(NativeResourcePhase.PREVIEW, reader.state.value!!.phase)
        assertEquals(8, reader.state.value!!.receivedBytes)
        assertContentEquals(byteArrayOf(0, 1), reader.state.value!!.prefix)
        assertNull(reader.state.value!!.content)
        assertEquals(listOf(0, 4), offsets(wire))
    }

    @Test fun `replacement rejects late bytes and close awaits cancellation cleanup`() = runTest {
        val wire = FakeWire()
        val release = CompletableDeferred<Unit>()
        wire.stub("workspaceFiles/stat") { value("{${stat(2)}}") }
        wire.stubSequence("workspaceFiles/readBytes", listOf(
            { withContext(NonCancellable) { release.await() }; page(0, byteArrayOf(1, 2), 2, true) },
            { page(0, byteArrayOf(3, 4), 2, true) },
        ))
        val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
        reader.open("old", "报告.bin"); runCurrent()
        reader.open("new", "报告.bin"); runCurrent()
        assertContentEquals(byteArrayOf(3, 4), reader.state.value!!.content)
        val closing = async { reader.closeAndAwait() }; runCurrent()
        assertFalse(closing.isCompleted)
        release.complete(Unit); closing.await()
        assertNull(reader.state.value)
    }

    @Test fun `each window must retain the descriptor version and complete-file size`() = runTest {
        for (result in listOf(page(0, byteArrayOf(1), 1, true, "v2"), page(0, byteArrayOf(1), 2, false))) {
            val wire = FakeWire()
            wire.stub("workspaceFiles/stat") { value("{${stat(1)}}") }
            wire.stub("workspaceFiles/readBytes") { result }
            val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
            reader.open("session", "报告.bin"); runCurrent()
            assertEquals(NativeResourcePhase.CHANGED, reader.state.value!!.phase)
            assertEquals(0, reader.state.value!!.receivedBytes)
            assertNull(reader.state.value!!.content)
        }
    }

    @Test fun `Session replacement clears its resource and model retirement awaits the cancelled request`() = runTest {
        val wire = FakeWire()
        val release = CompletableDeferred<Unit>()
        wire.stub("workspaceFiles/stat") { value("{${stat(1)}}") }
        wire.stub("workspaceFiles/readBytes") {
            withContext(NonCancellable) { release.await() }
            page(0, byteArrayOf(1), 1, true)
        }
        val models = CompanionModelSet(wire, backgroundScope)
        models.session.openSession("old"); runCurrent()
        models.files.previewPath("old", "报告.bin"); runCurrent()
        assertEquals(NativeResourcePhase.LOADING, models.files.resource.state.value!!.phase)
        models.session.openSession("new"); runCurrent()
        assertNull(models.files.resource.state.value)
        val closing = async { models.closeAndAwait() }; runCurrent()
        assertFalse(closing.isCompleted)
        release.complete(Unit); closing.await()
        assertNull(models.files.resource.state.value)
    }

    @Test fun `invalid descriptor metadata never starts a byte request`() = runTest {
        for (invalid in listOf("{}", """{"absolutePath":"/file","version":""}""",
            """{"absolutePath":"/file","version":"v","bytes":-1}""",
            """{"absolutePath":"/file","version":"v","bytes":1.5}""",
            """{"absolutePath":"/file","version":"v","bytes":9007199254740992}""")) {
            val wire = FakeWire()
            wire.stub("workspaceFiles/stat") { value(invalid) }
            val reader = NativeResourceReader(wire, backgroundScope, NativeResourceLimits(4, 8, 2))
            reader.open("session", "file"); runCurrent()
            assertEquals(NativeResourcePhase.FAILED, reader.state.value!!.phase)
            assertEquals(ConnectionFailure.INVALID_RESPONSE, reader.state.value!!.failure)
            assertTrue(offsets(wire).isEmpty())
        }
    }
}
