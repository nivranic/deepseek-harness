package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.CredentialsCipher
import java.io.*
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.UUID

/** Bounds each plaintext window and the total accepted file, independent of preview retention. */
data class NativeDownloadLimits(val windowBytes: Int, val maxBytes: Long) {
    init { require(windowBytes in 1..1_048_576 && maxBytes in windowBytes.toLong()..9_007_199_254_740_991L) }
}

/** The committed prefix; complete requires an accepted EOF, including for an empty file. */
data class NativeDownloadCheckpoint(
    val descriptor: NativeFileDescriptor,
    val receivedBytes: Long,
    val complete: Boolean,
)

/** One exclusively leased transfer in application-private storage. The cipher must authenticate ciphertext.
 * Frames bind a random transfer identity, sequence and offset; the encrypted checkpoint binds the principal
 * and Session target. A synced frame precedes atomic checkpoint replacement. Uncommitted tails are ignored
 * on restore and truncated only on explicit append. Corrupt committed bytes are preserved and rejected.
 * Memory is bounded by one frame, even when validating or copying a complete file. Process interruption
 * is recoverable; filesystem power-loss durability and rollback-resistant storage are not promised.
 */
class FileNativeDownloadStore(
    directory: File,
    principal: CompanionInputPrincipal,
    val target: NativeResourceTarget,
    private val cipher: CredentialsCipher,
    val limits: NativeDownloadLimits,
    private val quota: NativeDownloadQuota? = null,
) : AutoCloseable {
    private val identity = downloadIdentity(principal, target)
    private val folder = downloadFolder(directory, principal, target)
    private val checkpointFile = File(folder, "checkpoint.enc")
    private val frames = File(folder, "frames.enc")
    private val leaseChannel: FileChannel
    private val lease: java.nio.channels.FileLock
    private var closed = false
    private data class Record(val id: String, val checkpoint: NativeDownloadCheckpoint, val count: Long, val end: Long)

    init {
        Files.createDirectories(folder.toPath())
        leaseChannel = FileChannel.open(File(folder, "owner.lock").toPath(), StandardOpenOption.CREATE, StandardOpenOption.WRITE)
        try { lease = checkNotNull(leaseChannel.tryLock()) { "download already has an owner" } }
        catch (failure: Exception) { leaseChannel.close(); throw failure }
    }

    /** Local-only recovery validates every committed frame; it never approves network continuation. */
    @Synchronized fun load(checkActive: () -> Unit = {}): NativeDownloadCheckpoint? {
        check(!closed)
        val record = readRecord() ?: return null
        visit(record) { checkActive() }
        return record.checkpoint
    }

    /** Create only an absent transfer after the caller has obtained a descriptor from its trusted Host. */
    @Synchronized fun begin(descriptor: NativeFileDescriptor): NativeDownloadCheckpoint {
        check(!closed && readRecord() == null) { "download already exists or is closed" }
        require(descriptor.absolutePath.isNotBlank() && descriptor.version.isNotBlank())
        require(descriptor.bytes == null || descriptor.bytes in 0..limits.maxBytes) { "download exceeds its byte limit" }
        quota?.requireRoom(131_072, newEntry = !checkpointFile.exists() && !frames.exists())
        RandomAccessFile(frames, "rw").use { it.setLength(0); it.fd.sync() }
        val record = Record(UUID.randomUUID().toString(), NativeDownloadCheckpoint(descriptor, 0, false), 0, 0)
        commit(record)
        return record.checkpoint
    }

    /** Append accepted bytes only at the current checkpoint. A failed commit never advances the visible prefix. */
    @Synchronized internal fun append(expected: NativeDownloadCheckpoint, window: NativeResourceWindow): NativeDownloadCheckpoint {
        check(!closed)
        val record = checkNotNull(readRecord())
        check(record.checkpoint == expected && !expected.complete) { "download checkpoint differs" }
        val total = Math.addExact(expected.receivedBytes, window.bytes.size.toLong())
        require(window.bytes.size <= limits.windowBytes && (window.bytes.isNotEmpty() || window.eof) && total <= limits.maxBytes)
        require(expected.descriptor.bytes == null || (total <= expected.descriptor.bytes && window.eof == (total == expected.descriptor.bytes)))
        val plain = ByteArrayOutputStream().also { bytes -> DataOutputStream(bytes).use {
            it.writeUTF(record.id); it.writeLong(record.count); it.writeLong(expected.receivedBytes)
            it.writeBoolean(window.eof); it.writeInt(window.bytes.size); it.write(window.bytes)
        } }.toByteArray()
        val sealed = cipher.seal(plain)
        require(sealed.size in 1..frameLimit)
        quota?.requireRoom(sealed.size.toLong() + 4 + 65_536)
        val end = RandomAccessFile(frames, "rw").use {
            check(it.length() >= record.end) { "committed download data is missing" }
            it.setLength(record.end); it.seek(record.end)
            it.writeInt(sealed.size); it.write(sealed); it.fd.sync(); it.filePointer
        }
        val next = record.copy(checkpoint = expected.copy(receivedBytes = total, complete = window.eof), count = record.count + 1, end = end)
        commit(next)
        return next.checkpoint
    }

    /** Explicit removal works even with unreadable metadata or unavailable keys; the lease remains owned. */
    @Synchronized fun discard() {
        check(!closed)
        Files.deleteIfExists(checkpointFile.toPath())
        Files.deleteIfExists(frames.toPath())
        Files.newDirectoryStream(folder.toPath(), "checkpoint-*.tmp").use { paths -> paths.forEach { Files.delete(it) } }
    }

    /** Copy complete authenticated frames only. A consumer must discard its destination if any frame or write fails. */
    @Synchronized fun copyComplete(write: (ByteArray) -> Unit) {
        check(!closed)
        val record = checkNotNull(readRecord())
        check(record.checkpoint.complete) { "download is incomplete" }
        visit(record, write)
    }

    private val frameLimit get() = limits.windowBytes * 2 + 65_536

    private fun visit(record: Record, write: (ByteArray) -> Unit) {
        var received = 0L
        var eof = false
        RandomAccessFile(frames, "r").use { file ->
            require(file.length() >= record.end) { "committed download data is truncated" }
            repeatLong(record.count) { index ->
                require(!eof && record.end - file.filePointer >= 4) { "invalid download frame count" }
                val length = file.readInt()
                require(length in 1..frameLimit && length <= record.end - file.filePointer) { "invalid download frame size" }
                val sealed = ByteArray(length).also(file::readFully)
                val plain = cipher.open(sealed)
                require(plain.size <= frameLimit)
                DataInputStream(ByteArrayInputStream(plain)).use { input ->
                    require(input.readUTF() == record.id && input.readLong() == index && input.readLong() == received) { "download frame identity differs" }
                    eof = input.readBoolean()
                    val size = input.readInt()
                    require(size in 0..limits.windowBytes && (size > 0 || eof) && input.available() == size) { "invalid download frame bytes" }
                    val bytes = ByteArray(size).also(input::readFully)
                    received = Math.addExact(received, size.toLong())
                    require(received <= limits.maxBytes)
                    record.checkpoint.descriptor.bytes?.let { require(received <= it && eof == (received == it)) }
                    write(bytes)
                }
            }
            require(file.filePointer == record.end && received == record.checkpoint.receivedBytes && eof == record.checkpoint.complete) {
                "download frames differ from checkpoint"
            }
        }
    }

    private fun readRecord(): Record? {
        val stream = try { Files.newInputStream(checkpointFile.toPath()) }
        catch (_: java.nio.file.NoSuchFileException) { return null }
        val encrypted = stream.use { it.readNBytes(65_537) }
        require(encrypted.size <= 65_536) { "download checkpoint exceeds metadata limit" }
        val plain = cipher.open(encrypted)
        require(plain.size <= 65_536)
        return DataInputStream(ByteArrayInputStream(plain)).use {
            require(it.readInt() == 1) { "unsupported download checkpoint version" }
            val identitySize = it.readInt()
            require(identitySize == identity.size)
            require(ByteArray(identitySize).also(it::readFully).contentEquals(identity)) { "download belongs to another principal or target" }
            val id = it.readUTF()
            require(UUID.fromString(id).toString() == id)
            val path = it.readUTF(); val version = it.readUTF()
            val size = it.readLong()
            require(path.isNotBlank() && version.isNotBlank() && size in -1..limits.maxBytes)
            val received = it.readLong(); val complete = it.readBoolean(); val count = it.readLong(); val end = it.readLong()
            require(received in 0..limits.maxBytes && count >= 0 && count <= received + 1 && end >= 0)
            require((count == 0L) == (end == 0L) && (count != 0L || received == 0L && !complete))
            require(size == -1L || received <= size && (!complete || received == size))
            require(it.available() == 0) { "unexpected download checkpoint fields" }
            Record(id, NativeDownloadCheckpoint(NativeFileDescriptor(path, version, size.takeIf { it >= 0 }), received, complete), count, end)
        }
    }

    private fun commit(record: Record) {
        val plain = ByteArrayOutputStream().also { bytes -> DataOutputStream(bytes).use {
            it.writeInt(1); it.writeInt(identity.size); it.write(identity); it.writeUTF(record.id)
            it.writeUTF(record.checkpoint.descriptor.absolutePath); it.writeUTF(record.checkpoint.descriptor.version)
            it.writeLong(record.checkpoint.descriptor.bytes ?: -1)
            it.writeLong(record.checkpoint.receivedBytes); it.writeBoolean(record.checkpoint.complete)
            it.writeLong(record.count); it.writeLong(record.end)
        } }.toByteArray()
        require(plain.size <= 65_536)
        val encrypted = cipher.seal(plain)
        require(encrypted.size <= 65_536)
        val temporary = Files.createTempFile(folder.toPath(), "checkpoint-", ".tmp")
        try {
            FileOutputStream(temporary.toFile()).use { it.write(encrypted); it.fd.sync() }
            Files.move(temporary, checkpointFile.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally { Files.deleteIfExists(temporary) }
    }

    @Synchronized override fun close() {
        if (closed) return
        closed = true
        try { lease.release() } finally { leaseChannel.close() }
    }
}

private inline fun repeatLong(count: Long, action: (Long) -> Unit) {
    var index = 0L
    while (index < count) { action(index); index++ }
}

/** Cache limits include encrypted files and temporary checkpoint space. One application model owns writes at a time. */
class NativeDownloadQuota(private val directory: File, private val maxDiskBytes: Long, private val maxEntries: Int) {
    init { require(maxDiskBytes > 131_072 && maxEntries > 0) }
    fun requireRoom(additional: Long, newEntry: Boolean = false) {
        var size = 0L
        if (directory.exists()) Files.walk(directory.toPath()).use { paths ->
            paths.filter { Files.isRegularFile(it, java.nio.file.LinkOption.NOFOLLOW_LINKS) }.forEach {
                size = Math.addExact(size, Files.size(it))
            }
        }
        check(additional >= 0 && size <= maxDiskBytes - additional) { "download storage budget exhausted" }
        if (newEntry) {
            val entries = directory.listFiles()?.count { File(it, "checkpoint.enc").exists() || File(it, "frames.enc").exists() } ?: 0
            check(entries < maxEntries) { "download entry limit reached" }
        }
    }
}

/** Factory bound to the active verified principal. Existence checks do not decrypt, create a key, or start network work. */
class NativeDownloadFiles(private val directory: File, private val principal: CompanionInputPrincipal,
                          private val cipher: CredentialsCipher, private val limits: NativeDownloadLimits,
                          private val quota: NativeDownloadQuota) {
    fun exists(target: NativeResourceTarget): Boolean = downloadFolder(directory, principal, target).let {
        File(it, "checkpoint.enc").exists() || File(it, "frames.enc").exists()
    }
    fun open(target: NativeResourceTarget) = FileNativeDownloadStore(directory, principal, target, cipher, limits, quota)
}

private fun downloadIdentity(principal: CompanionInputPrincipal, target: NativeResourceTarget): ByteArray =
    ByteArrayOutputStream().also { bytes -> DataOutputStream(bytes).use {
        require(listOf(principal.hostId, principal.fingerprint, principal.deviceId, target.sessionId, target.path).all(String::isNotBlank))
        it.writeUTF(principal.hostId); it.writeUTF(principal.fingerprint); it.writeUTF(principal.deviceId)
        it.writeUTF(target.sessionId); it.writeUTF(target.path)
    } }.toByteArray()

private fun downloadFolder(directory: File, principal: CompanionInputPrincipal, target: NativeResourceTarget) =
    File(directory, MessageDigest.getInstance("SHA-256").digest(downloadIdentity(principal, target))
        .joinToString("") { "%02x".format(it.toInt() and 255) })
