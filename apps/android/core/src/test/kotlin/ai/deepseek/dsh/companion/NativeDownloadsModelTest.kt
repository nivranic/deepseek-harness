package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.PlainCredentialsCipher
import ai.deepseek.dsh.link.WireValue
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.CountDownLatch
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeDownloadsModelTest {
    private val roots = mutableListOf<File>()
    private val target = NativeResourceTarget("session", "folder/file.bin")
    private val principal = CompanionInputPrincipal("host", "pin", "device")
    private val descriptor = NativeFileDescriptor("/folder/file.bin", "v1", 6)
    private fun directory() = Files.createTempDirectory("native-download-adoption-").toFile().also(roots::add)
    @AfterTest fun cleanup() { roots.forEach { it.deleteRecursively() } }
    private fun files(folder: File = directory(), identity: CompanionInputPrincipal = principal) = NativeDownloadFiles(
        folder, identity, PlainCredentialsCipher, NativeDownloadLimits(4, 32), NativeDownloadQuota(folder, 1_048_576, 8))
    private fun complete(files: NativeDownloadFiles) {
        files.open(target).use {
            val first = it.append(it.begin(descriptor), NativeResourceWindow(byteArrayOf(1, 2, 3, 4), false))
            it.append(first, NativeResourceWindow(byteArrayOf(5, 6), true))
        }
    }
    private fun value(text: String) = WireValue.fromJsonElement(Json.parseToJsonElement(text))
    private fun wire() = FakeWire().also { wire ->
        wire.stub("workspaceFiles/stat") { value("""{"absolutePath":"/folder/file.bin","version":"v1","bytes":6}""") }
        wire.stub("workspaceFiles/readBytes") {
            val offset = WireShape.number(wire.calls.last().second.getValue("range"), "offset")!!.toInt()
            val data = if (offset == 0) byteArrayOf(1, 2, 3, 4) else byteArrayOf(5, 6)
            value("""{"absolutePath":"/folder/file.bin","version":"v1","bytes":6,"offset":$offset,"data":"${Base64.getEncoder().encodeToString(data)}","eof":${offset == 4}}""")
        }
    }
    private open class Destination : NativeResourceSaveDestination {
        val output = ByteArrayOutputStream()
        var discarded = false
        val windows = mutableListOf<Int>()
        override fun write(content: NativeResourceContent) { content.copyTo { windows.add(it.size); output.write(it) } }
        override fun discard() { discarded = true; output.reset() }
    }

    @Test fun `resource restoration is local and complete export copies bounded windows without Host requests`() = runTest {
        val files = files(); complete(files)
        val wire = wire()
        val model = NativeDownloadsModel(wire, files, backgroundScope, StandardTestDispatcher(testScheduler))
        model.select(target); runCurrent()
        assertEquals(NativeDownloadPhase.COMPLETE, model.state.value.controller!!.state.value.phase)
        val (request, saver) = model.prepareSave(target)!!
        val destination = Destination()
        assertEquals(NativeResourceSavePhase.SAVED, saver.save(request, destination))
        assertEquals(listOf(4, 2), destination.windows)
        assertContentEquals(byteArrayOf(1, 2, 3, 4, 5, 6), destination.output.toByteArray())
        assertTrue(wire.calls.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `resource invalidation immediately expires picker authority before selection cleanup starts`() = runTest {
        val files = files(); complete(files)
        var selected: NativeResourceTarget? = target
        val model = NativeDownloadsModel(wire(), files, backgroundScope, StandardTestDispatcher(testScheduler), selected = { it == selected })
        model.select(target); runCurrent()
        val (request, saver) = model.prepareSave(target)!!
        selected = null
        assertNull(model.prepareSave(target))
        val destination = Destination()
        assertEquals(NativeResourceSavePhase.EXPIRED, saver.save(request, destination))
        assertTrue(destination.discarded)
        assertTrue(destination.windows.isEmpty())
        model.closeAndAwait()
    }

    @Test fun `explicit download persists completion and removal leaves the Host and another principal untouched`() = runTest {
        val folder = directory(); val files = files(folder); val other = files(folder, principal.copy(deviceId = "other"))
        complete(other)
        val wire = wire()
        val model = NativeDownloadsModel(wire, files, backgroundScope, StandardTestDispatcher(testScheduler))
        model.select(target); runCurrent()
        assertFalse(files.exists(target))
        assertTrue(wire.calls.isEmpty())
        model.resume(target); runCurrent()
        assertEquals(NativeDownloadPhase.COMPLETE, model.state.value.controller!!.state.value.phase)
        val before = wire.calls.toList()
        model.discard(target)
        assertNull(model.state.value.controller)
        assertFalse(files.exists(target))
        assertEquals(before, wire.calls)
        other.open(target).use { assertTrue(it.load()!!.complete) }
        model.closeAndAwait()
    }

    @Test fun `resource replacement pauses network reads and waits for the old store lease`() = runTest {
        val files = files(); val wire = wire(); val release = CompletableDeferred<Unit>()
        wire.stub("workspaceFiles/readBytes") { withContext(NonCancellable) { release.await() }; error("retired read") }
        val model = NativeDownloadsModel(wire, files, backgroundScope, StandardTestDispatcher(testScheduler))
        model.select(target); model.resume(target); runCurrent()
        val switch = async { model.select(target.copy(path = "other")) }; runCurrent()
        assertFalse(switch.isCompleted)
        assertFailsWith<java.nio.channels.OverlappingFileLockException> { files.open(target) }
        release.complete(Unit); switch.await()
        files.open(target).use { assertEquals(0, it.load()!!.receivedBytes) }
        assertNull(model.state.value.controller)
        model.closeAndAwait()
    }

    @Test fun `model retirement cancels an active stream copy and awaits destination cleanup before releasing the lease`() = runTest {
        val files = files(); complete(files)
        val model = NativeDownloadsModel(wire(), files, backgroundScope, StandardTestDispatcher(testScheduler))
        model.select(target); runCurrent()
        val (request, saver) = model.prepareSave(target)!!
        val entered = CompletableDeferred<Unit>(); val release = CountDownLatch(1)
        val destination = object : Destination() {
            override fun write(content: NativeResourceContent) {
                content.copyTo { output.write(it); entered.complete(Unit); release.await() }
            }
        }
        val saving = async { runCatching { saver.save(request, destination) } }
        try {
            entered.await()
            val closing = async { model.closeAndAwait() }; runCurrent()
            assertFalse(closing.isCompleted)
            assertFailsWith<java.nio.channels.OverlappingFileLockException> { files.open(target) }
            release.countDown(); closing.await(); saving.await()
            assertTrue(destination.discarded)
            assertEquals(NativeResourceSavePhase.CANCELLED, request.result)
            files.open(target).use { assertTrue(it.load()!!.complete) }
        } finally { release.countDown(); model.closeAndAwait() }
    }

    @Test fun `stream output failure discards the destination while retaining complete encrypted source data`() = runTest {
        val files = files(); complete(files)
        val model = NativeDownloadsModel(wire(), files, backgroundScope, StandardTestDispatcher(testScheduler))
        model.select(target); runCurrent()
        val (request, saver) = model.prepareSave(target)!!
        val destination = object : Destination() {
            override fun write(content: NativeResourceContent) { content.copyTo { output.write(it); throw IOException("full") } }
        }
        assertEquals(NativeResourceSavePhase.FAILED, saver.save(request, destination))
        assertTrue(destination.discarded)
        assertEquals(NativeDownloadPhase.COMPLETE, model.state.value.controller!!.state.value.phase)
        model.closeAndAwait()
    }

    @Test fun `corrupt local metadata offers explicit removal without decrypting or contacting the Host`() = runTest {
        val folder = directory(); val files = files(folder); complete(files)
        folder.walkTopDown().single { it.name == "checkpoint.enc" }.writeBytes(byteArrayOf(0))
        val wire = wire()
        val model = NativeDownloadsModel(wire, files, backgroundScope, StandardTestDispatcher(testScheduler))
        model.select(target); runCurrent()
        assertEquals(NativeDownloadPhase.UNAVAILABLE, model.state.value.controller!!.state.value.phase)
        model.discard(target)
        assertFalse(files.exists(target)); assertTrue(wire.calls.isEmpty())
        model.resume(target); runCurrent()
        assertEquals(NativeDownloadPhase.COMPLETE, model.state.value.controller!!.state.value.phase)
        model.closeAndAwait()
    }

    private class QueuedDisk : CoroutineDispatcher() {
        private val pending = java.util.concurrent.ConcurrentLinkedQueue<Runnable>()
        override fun dispatch(context: kotlin.coroutines.CoroutineContext, block: Runnable) { pending.add(block) }
        fun step(): Boolean = pending.poll()?.let { it.run(); true } ?: false
    }

    @Test fun `cancelling a screen command after store adoption clears busy and retains awaited lease ownership`() = runTest {
        val files = files(); val disk = QueuedDisk()
        val model = NativeDownloadsModel(wire(), files, backgroundScope, disk)
        val selecting = async { model.select(target) }; runCurrent()
        assertTrue(disk.step()); runCurrent(); selecting.await()
        val starting = async { model.resume(target) }; runCurrent()
        assertTrue(disk.step()); runCurrent()
        starting.cancel(); runCurrent()
        repeat(8) { while (disk.step()) { }; runCurrent() }
        starting.join()
        assertFalse(model.state.value.busy)
        assertNotNull(model.state.value.controller)
        val closing = async { model.closeAndAwait() }; runCurrent()
        repeat(8) { while (disk.step()) { }; runCurrent() }
        closing.await()
        files.open(target).close()
    }

    @Test fun `confirmed removal reaches a usable terminal state after its screen command is cancelled`() = runTest {
        val files = files(); complete(files); val disk = QueuedDisk()
        val model = NativeDownloadsModel(wire(), files, backgroundScope, disk)
        val selecting = async { model.select(target) }; runCurrent()
        repeat(8) { while (disk.step()) { }; runCurrent() }
        selecting.await()
        val removing = async { model.discard(target) }; runCurrent()
        assertEquals(NativeDownloadPhase.RESTORING, model.state.value.controller!!.state.value.phase)
        removing.cancel(); runCurrent()
        repeat(8) { while (disk.step()) { }; runCurrent() }
        removing.join()
        assertFalse(model.state.value.busy)
        assertTrue(model.state.value.controller?.state?.value?.phase != NativeDownloadPhase.RESTORING)
        assertFalse(files.exists(target))
        val closing = async { model.closeAndAwait() }; runCurrent()
        repeat(8) { while (disk.step()) { }; runCurrent() }
        closing.await()
        files.open(target).close()
    }

    @Test fun `cache byte and entry quotas reject writes without advancing progress and removal releases capacity`() {
        val folder = directory()
        val quota = NativeDownloadQuota(folder, 200_000, 1)
        val limits = NativeDownloadLimits(65_536, 262_144)
        FileNativeDownloadStore(folder, principal, target, PlainCredentialsCipher, limits, quota).use { first ->
            var checkpoint = first.begin(descriptor.copy(bytes = 262_144))
            repeat(2) { checkpoint = first.append(checkpoint, NativeResourceWindow(ByteArray(65_536), false)) }
            assertFailsWith<IllegalStateException> { first.append(checkpoint, NativeResourceWindow(ByteArray(65_536), false)) }
            assertEquals(131_072, first.load()!!.receivedBytes)
            FileNativeDownloadStore(folder, principal, target.copy(path = "other"), PlainCredentialsCipher, limits, quota).use { second ->
                assertFailsWith<IllegalStateException> { second.begin(descriptor) }
                first.discard()
                assertNull(first.load())
                second.begin(descriptor)
            }
        }
    }
}
