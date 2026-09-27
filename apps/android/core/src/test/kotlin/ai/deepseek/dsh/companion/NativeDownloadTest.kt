package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.CredentialsCipher
import ai.deepseek.dsh.link.WireValue
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NativeDownloadTest {
    private val roots = mutableListOf<File>()
    private val principal = CompanionInputPrincipal("host", "a".repeat(64), "device")
    private val target = NativeResourceTarget("session", "秘密.bin")
    private val descriptor = NativeFileDescriptor("/workspace/秘密.bin", "v1", 6)
    private val limits = NativeDownloadLimits(4, 32)
    private fun directory() = Files.createTempDirectory("native-download-").toFile().also(roots::add)
    @AfterTest fun cleanup() { roots.forEach { it.deleteRecursively() } }
    private class TestCipher : CredentialsCipher {
        private val key = SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES")
        var seals = 0
        var failAt = -1
        var largestPlain = 0
        override fun seal(plain: ByteArray): ByteArray {
            seals++
            if (seals == failAt) throw IOException("storage unavailable")
            largestPlain = maxOf(largestPlain, plain.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            return cipher.iv + cipher.doFinal(plain)
        }
        override fun open(sealed: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            return cipher.doFinal(sealed.copyOfRange(12, sealed.size))
        }
    }
    private fun store(folder: File, cipher: TestCipher = TestCipher()) = FileNativeDownloadStore(folder, principal, target, cipher, limits)
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun stat(size: Int? = 6, version: String = "v1") =
        """"absolutePath":"/workspace/秘密.bin","version":"$version"${if (size == null) "" else ",\"bytes\":$size"}"""
    private fun page(offset: Int, bytes: ByteArray, size: Int? = 6, eof: Boolean = false, version: String = "v1") = value(
        """{${stat(size, version)},"offset":$offset,"data":"${Base64.getEncoder().encodeToString(bytes)}","eof":$eof}""")
    private fun wire() = FakeWire().also { it.stub("workspaceFiles/stat") { value("{${stat()}}") } }
    private fun offsets(wire: FakeWire) = wire.calls.filter { it.first == "workspaceFiles/readBytes" }.map {
        WireShape.number(it.second.getValue("range"), "offset")!!.toInt()
    }

    @Test fun `reopening a partial store restores encrypted bytes without granting network continuation`() = runTest {
        val folder = directory()
        store(folder).use {
            val start = it.begin(descriptor)
            it.append(start, NativeResourceWindow(byteArrayOf(1, 2, 3, 4), false))
        }
        val wire = wire()
        wire.stub("workspaceFiles/readBytes") { page(4, byteArrayOf(5, 6), eof = true) }
        val disk = store(folder)
        val owner = NativeDownloadController(wire, disk, backgroundScope, StandardTestDispatcher(testScheduler))
        runCurrent()
        assertEquals(NativeDownloadPhase.PAUSED, owner.state.value.phase)
        assertEquals(4, owner.state.value.checkpoint!!.receivedBytes)
        assertTrue(wire.calls.isEmpty())
        assertTrue(owner.resume()); assertFalse(owner.resume()); runCurrent()
        assertEquals(NativeDownloadPhase.COMPLETE, owner.state.value.phase)
        assertEquals(listOf(4), offsets(wire))
        assertTrue(wire.calls.all { it.second["workspaceFileScopeId"] == WireValue.StringValue(target.sessionId) })
        val copied = ByteArrayOutputStream()
        disk.copyComplete(copied::write)
        assertContentEquals(byteArrayOf(1, 2, 3, 4, 5, 6), copied.toByteArray())
        assertFalse(owner.resume())
        owner.closeAndAwait()
        val restoredWire = wire()
        val restored = NativeDownloadController(restoredWire, store(folder), backgroundScope, StandardTestDispatcher(testScheduler))
        runCurrent()
        assertEquals(NativeDownloadPhase.COMPLETE, restored.state.value.phase)
        assertTrue(restoredWire.calls.isEmpty())
        restored.closeAndAwait()
        assertTrue(folder.walkTopDown().filter { it.isFile }.none { it.readBytes().toString(Charsets.UTF_8).contains("秘密") })
    }

    @Test fun `failed checkpoint replacement retains the old prefix and retry removes the uncommitted tail`() {
        val folder = directory(); val cipher = TestCipher()
        store(folder, cipher).use {
            val start = it.begin(descriptor)
            val accepted = it.append(start, NativeResourceWindow(byteArrayOf(1, 2, 3, 4), false))
            cipher.failAt = cipher.seals + 2
            assertFailsWith<IOException> { it.append(accepted, NativeResourceWindow(byteArrayOf(99, 99), true)) }
            assertEquals(accepted, it.load())
            assertFailsWith<IllegalStateException> { it.copyComplete { fail("partial bytes exported") } }
        }
        store(folder).use {
            it.append(it.load()!!, NativeResourceWindow(byteArrayOf(5, 6), true))
            val output = ByteArrayOutputStream(); it.copyComplete(output::write)
            assertContentEquals(byteArrayOf(1, 2, 3, 4, 5, 6), output.toByteArray())
        }
    }

    @Test fun `principal grant and Session target isolate checkpoints and reject transplanted ciphertext`() {
        val folder = directory()
        store(folder).use { it.begin(descriptor) }
        val original = folder.walkTopDown().single { it.name == "checkpoint.enc" }
        val variants = listOf(
            principal.copy(hostId = "other") to target, principal.copy(fingerprint = "b".repeat(64)) to target,
            principal.copy(deviceId = "other") to target, principal to target.copy(sessionId = "other"),
            principal to target.copy(path = "other.bin"),
        )
        for ((identity, resource) in variants) {
            val previous = folder.walkTopDown().filter { it.name == "checkpoint.enc" }.toSet()
            FileNativeDownloadStore(folder, identity, resource, TestCipher(), limits).use {
                assertNull(it.load()); it.begin(descriptor)
                val destination = (folder.walkTopDown().filter { it.name == "checkpoint.enc" }.toSet() - previous).single()
                destination.writeBytes(original.readBytes())
                val before = destination.readBytes()
                assertFailsWith<IllegalArgumentException> { it.load() }
                assertContentEquals(before, destination.readBytes())
            }
        }
    }

    @Test fun `corrupt or truncated committed data is preserved and cannot trigger network work`() = runTest {
        for (truncate in listOf(false, true)) {
            val folder = directory()
            store(folder).use { it.append(it.begin(descriptor), NativeResourceWindow(byteArrayOf(1, 2, 3, 4), false)) }
            val file = folder.walkTopDown().single { it.name == "frames.enc" }
            val bytes = file.readBytes()
            file.writeBytes(if (truncate) bytes.copyOf(bytes.size - 1) else bytes.also { it[it.lastIndex] = (it.last() + 1).toByte() })
            val corrupt = file.readBytes(); val wire = wire()
            val owner = NativeDownloadController(wire, store(folder), backgroundScope, StandardTestDispatcher(testScheduler))
            runCurrent()
            assertEquals(NativeDownloadPhase.UNAVAILABLE, owner.state.value.phase)
            assertFalse(owner.resume()); assertTrue(wire.calls.isEmpty())
            owner.closeAndAwait()
            assertContentEquals(corrupt, file.readBytes())
        }
    }

    @Test fun `an independent transfer cannot replace authenticated frames even with the same principal and file`() {
        val first = directory(); val second = directory()
        for (folder in listOf(first, second)) store(folder).use {
            it.append(it.begin(descriptor), NativeResourceWindow(byteArrayOf(1, 2, 3, 4), false))
        }
        first.walkTopDown().single { it.name == "frames.enc" }.writeBytes(second.walkTopDown().single { it.name == "frames.enc" }.readBytes())
        store(first).use { assertFailsWith<IllegalArgumentException> { it.load() } }
    }

    @Test fun `only one writer owns a transfer and retirement releases its lease`() {
        val folder = directory(); val first = store(folder)
        assertFailsWith<java.nio.channels.OverlappingFileLockException> { store(folder) }
        first.close(); first.close()
        store(folder).use { assertNull(it.load()) }
        assertFailsWith<IllegalStateException> { first.load() }
    }

    @Test fun `changed stat or midstream descriptor never appends to the old version`() = runTest {
        for (onStat in listOf(true, false)) {
            val folder = directory()
            store(folder).use { it.append(it.begin(descriptor), NativeResourceWindow(byteArrayOf(1, 2, 3, 4), false)) }
            val wire = wire()
            if (onStat) wire.stub("workspaceFiles/stat") { value("{${stat(version = "v2")}}") }
            else wire.stub("workspaceFiles/readBytes") { page(4, byteArrayOf(5, 6), eof = true, version = "v2") }
            val disk = store(folder)
            val owner = NativeDownloadController(wire, disk, backgroundScope, StandardTestDispatcher(testScheduler))
            runCurrent(); owner.resume(); runCurrent()
            assertEquals(NativeDownloadPhase.CHANGED, owner.state.value.phase)
            assertEquals(4, disk.load()!!.receivedBytes)
            assertFalse(owner.resume())
            assertEquals(if (onStat) emptyList() else listOf(4), offsets(wire))
            owner.closeAndAwait()
        }
    }

    @Test fun `network retry revalidates the descriptor and reads only the missing suffix`() = runTest {
        val wire = wire()
        wire.stubSequence("workspaceFiles/readBytes", listOf(
            { page(0, byteArrayOf(1, 2, 3, 4)) }, { throw IOException("offline") }, { page(4, byteArrayOf(5, 6), eof = true) },
        ))
        val owner = NativeDownloadController(wire, store(directory()), backgroundScope, StandardTestDispatcher(testScheduler))
        runCurrent(); owner.resume(); runCurrent()
        assertEquals(NativeDownloadPhase.FAILED, owner.state.value.phase)
        assertEquals(4, owner.state.value.checkpoint!!.receivedBytes)
        owner.resume(); runCurrent()
        assertEquals(NativeDownloadPhase.COMPLETE, owner.state.value.phase)
        assertEquals(listOf(0, 4, 4), offsets(wire))
        assertEquals(2, wire.calls.count { it.first == "workspaceFiles/stat" })
        owner.closeAndAwait()
    }

    @Test fun `retirement awaits cancellation resistant reads and late bytes never reach disk`() = runTest {
        val release = CompletableDeferred<Unit>(); val wire = wire(); val folder = directory()
        wire.stub("workspaceFiles/readBytes") { withContext(NonCancellable) { release.await() }; page(0, byteArrayOf(1, 2, 3, 4)) }
        val owner = NativeDownloadController(wire, store(folder), backgroundScope, StandardTestDispatcher(testScheduler))
        runCurrent(); owner.resume(); runCurrent()
        val closing = async { owner.closeAndAwait() }; runCurrent()
        assertFalse(closing.isCompleted); assertFalse(owner.resume())
        assertFailsWith<java.nio.channels.OverlappingFileLockException> { store(folder) }
        release.complete(Unit); closing.await()
        assertEquals(NativeDownloadPhase.CLOSED, owner.state.value.phase)
        store(folder).use { assertEquals(0, it.load()!!.receivedBytes) }
    }

    @Test fun `empty and unknown-size files require accepted EOF and preserve bounded windows`() = runTest {
        for (size in listOf(0, null)) {
            val wire = wire()
            wire.stub("workspaceFiles/stat") { value("{${stat(size)}}") }
            wire.stub("workspaceFiles/readBytes") { page(0, if (size == 0) byteArrayOf() else byteArrayOf(7, 8), size, true) }
            val disk = store(directory())
            val owner = NativeDownloadController(wire, disk, backgroundScope, StandardTestDispatcher(testScheduler))
            runCurrent(); owner.resume(); runCurrent()
            assertEquals(NativeDownloadPhase.COMPLETE, owner.state.value.phase)
            val output = ByteArrayOutputStream(); disk.copyComplete(output::write)
            assertContentEquals(if (size == 0) byteArrayOf() else byteArrayOf(7, 8), output.toByteArray())
            owner.closeAndAwait()
        }
    }

    @Test fun `unknown-size download stops at its configured disk budget without claiming completion`() = runTest {
        val wire = wire()
        wire.stub("workspaceFiles/stat") { value("{${stat(null)}}") }
        wire.stub("workspaceFiles/readBytes") {
            val args = wire.calls.last().second
            val offset = WireShape.number(args.getValue("range"), "offset")!!.toInt()
            page(offset, ByteArray(4), null)
        }
        val disk = store(directory())
        val owner = NativeDownloadController(wire, disk, backgroundScope, StandardTestDispatcher(testScheduler))
        runCurrent(); owner.resume(); runCurrent()
        assertEquals(NativeDownloadPhase.FAILED, owner.state.value.phase)
        assertEquals(32, disk.load()!!.receivedBytes)
        assertFalse(disk.load()!!.complete)
        assertEquals((0..28 step 4).toList(), offsets(wire))
        owner.closeAndAwait()
    }

    @Test fun `invalid byte responses never advance a committed prefix`() = runTest {
        val invalid = listOf(page(3, byteArrayOf(5, 6), eof = true), page(4, byteArrayOf(), eof = false),
            page(4, byteArrayOf(5, 6), eof = false), value("""{${stat()},"offset":4,"data":"!!!!","eof":true}"""))
        for (response in invalid) {
            val folder = directory()
            store(folder).use { it.append(it.begin(descriptor), NativeResourceWindow(byteArrayOf(1, 2, 3, 4), false)) }
            val wire = wire(); wire.stub("workspaceFiles/readBytes") { response }
            val disk = store(folder)
            val owner = NativeDownloadController(wire, disk, backgroundScope, StandardTestDispatcher(testScheduler))
            runCurrent(); owner.resume(); runCurrent()
            assertEquals(ConnectionFailure.INVALID_RESPONSE, owner.state.value.failure)
            assertEquals(4, disk.load()!!.receivedBytes)
            owner.closeAndAwait()
        }
    }

    @Test fun `abrupt process death releases the lease and recovery ignores the synced uncommitted tail`() {
        val folder = directory()
        val classpath = listOf(NativeDownloadCrashFixture::class.java, FileNativeDownloadStore::class.java, Unit::class.java)
            .map { File(it.protectionDomain.codeSource.location.toURI()).absolutePath }.distinct().joinToString(File.pathSeparator)
        val executable = File(System.getProperty("java.home"), "bin/java").absolutePath
        val log = File(directory(), "child.log")
        val child = ProcessBuilder(executable, "-cp", classpath, NativeDownloadCrashFixture::class.java.name, folder.absolutePath)
            .redirectErrorStream(true).redirectOutput(log).start()
        try {
            assertTrue(child.waitFor(30, java.util.concurrent.TimeUnit.SECONDS), "child did not exit")
            assertEquals(23, child.exitValue(), log.readText())
        } finally {
            if (child.isAlive) { child.destroyForcibly(); child.waitFor(10, java.util.concurrent.TimeUnit.SECONDS) }
        }
        FileNativeDownloadStore(folder, principal, target, ai.deepseek.dsh.link.PlainCredentialsCipher, limits).use {
            val restored = it.load()!!
            assertEquals(4, restored.receivedBytes)
            assertFalse(restored.complete)
            it.append(restored, NativeResourceWindow(byteArrayOf(5, 6), true))
            val bytes = ByteArrayOutputStream(); it.copyComplete(bytes::write)
            assertContentEquals(byteArrayOf(1, 2, 3, 4, 5, 6), bytes.toByteArray())
        }
    }

    @Test fun `pausing a request retains its checkpoint and explicit resume completes the file`() = runTest {
        val wire = wire(); val started = CompletableDeferred<Unit>()
        wire.stubSequence("workspaceFiles/readBytes", listOf(
            { page(0, byteArrayOf(1, 2, 3, 4)) },
            { started.complete(Unit); awaitCancellation() },
            { page(4, byteArrayOf(5, 6), eof = true) },
        ))
        val disk = store(directory())
        val owner = NativeDownloadController(wire, disk, backgroundScope, StandardTestDispatcher(testScheduler))
        owner.pauseAndAwait()
        assertEquals(NativeDownloadPhase.PAUSED, owner.state.value.phase)
        owner.resume(); started.await(); owner.pauseAndAwait()
        assertEquals(NativeDownloadPhase.PAUSED, owner.state.value.phase)
        assertEquals(4, disk.load()!!.receivedBytes)
        owner.resume(); runCurrent()
        assertEquals(NativeDownloadPhase.COMPLETE, owner.state.value.phase)
        assertEquals(listOf(0, 4, 4), offsets(wire))
        owner.closeAndAwait()
    }

    @Test fun `large complete content encrypts and copies in individual windows`() {
        val folder = directory(); val cipher = TestCipher(); val size = 2_097_152
        FileNativeDownloadStore(folder, principal, target, cipher, NativeDownloadLimits(65_536, size.toLong())).use {
            var checkpoint = it.begin(descriptor.copy(bytes = size.toLong()))
            repeat(size / 65_536) { index ->
                checkpoint = it.append(checkpoint, NativeResourceWindow(ByteArray(65_536) { index.toByte() }, index == size / 65_536 - 1))
            }
            assertTrue(cipher.largestPlain < 66_000)
            var count = 0
            it.copyComplete { chunk ->
                assertEquals(65_536, chunk.size)
                assertTrue(chunk.all { byte -> byte == (count / 65_536).toByte() })
                count += chunk.size
            }
            assertEquals(size, count)
        }
    }
}
