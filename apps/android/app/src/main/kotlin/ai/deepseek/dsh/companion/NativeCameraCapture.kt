package ai.deepseek.dsh.companion

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.util.UUID

/** The external camera writes a full JPEG to one temporary, explicitly granted content URI. */
internal class NativeCameraPicture : ActivityResultContracts.TakePicture() {
    override fun createIntent(context: Context, input: Uri): Intent = super.createIntent(context, input).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        clipData = ClipData.newRawUri("camera-output", input)
    }
}

/** Only UUID-named files in the private capture directory are eligible for camera cleanup. */
internal class NativeCameraFiles private constructor(private val context: Context) {
    val directory: File = File(context.cacheDir, "native-camera/captures")
    private val leased = mutableMapOf<String, Any>()
    var orphanCleanupFailed = false
        private set

    @Synchronized fun create(): NativeCameraOutput {
        checkDirectory()
        Files.createDirectories(directory.toPath())
        val name = "capture-${UUID.randomUUID()}.jpg"
        val file = resolve(name)
        check(file.createNewFile())
        val token = Any()
        leased[name] = token
        return try { NativeCameraOutput(this, name, token, uri(name)) }
        catch (failure: Exception) { leased.remove(name); Files.deleteIfExists(file.toPath()); throw failure }
    }

    @Synchronized fun ownedNames(): List<String> {
        checkDirectory()
        return directory.listFiles().orEmpty().filter { validName(it.name) && !Files.isSymbolicLink(it.toPath()) }.map { it.name }
    }

    /** Cold-process cleanup skips live captures in this process and never traverses a symbolic link. */
    @Synchronized fun cleanupOrphans(): Boolean {
        var complete = true
        val names = try { ownedNames() } catch (_: Exception) { orphanCleanupFailed = true; return false }
        for (name in names) if (name !in leased) {
            try { clean(name) }
            catch (_: Exception) { complete = false }
        }
        orphanCleanupFailed = !complete
        return complete
    }

    /** Restored metadata grants cleanup only; it cannot open or adopt a current process's live capture. */
    @Synchronized fun cleanupRestored(name: String) {
        check(name !in leased)
        clean(name)
    }

    @Synchronized internal fun open(name: String, token: Any): InputStream {
        check(leased[name] === token)
        return Files.newInputStream(resolve(name).toPath())
    }

    @Synchronized internal fun release(name: String, token: Any) {
        if (leased[name] !== token) return
        try { clean(name) } finally { leased.remove(name) }
    }

    private fun clean(name: String) {
        val file = resolve(name)
        context.revokeUriPermission(uri(name), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        Files.deleteIfExists(file.toPath())
    }

    private fun uri(name: String): Uri = FileProvider.getUriForFile(context, "${context.packageName}.native-camera", resolve(name))

    private fun resolve(name: String): File {
        require(validName(name))
        checkDirectory()
        val file = File(directory, name)
        check(!Files.isSymbolicLink(file.toPath()) && file.canonicalFile.parentFile == directory.canonicalFile)
        return file
    }

    private fun checkDirectory() {
        check(!Files.isSymbolicLink(directory.toPath()) &&
            directory.canonicalFile == File(context.cacheDir.canonicalFile, "native-camera/captures").absoluteFile)
    }

    private fun validName(name: String) = name.matches(Regex("capture-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.jpg"))

    companion object {
        @Volatile private var instance: NativeCameraFiles? = null
        fun get(context: Context): NativeCameraFiles = instance ?: synchronized(this) {
            instance ?: NativeCameraFiles(context.applicationContext).also { files ->
                files.cleanupOrphans()
                instance = files
            }
        }
    }
}

/** The token permits reading and exact cleanup of this application's output, never an arbitrary provider document. */
internal class NativeCameraOutput(private val files: NativeCameraFiles, val name: String, private val token: Any, val uri: Uri) : NativeFileAttachmentSource {
    override fun name(): String = name
    override fun mediaType(): String = "image/jpeg"
    override fun open(): InputStream = files.open(name, token)
    fun close() = files.release(name, token)
}

/** Creation and finalization serialize so cancellation cannot miss a file being allocated. */
internal class NativeCameraReservation {
    private var closed = false
    private var output: NativeCameraOutput? = null
    @Synchronized fun create(files: NativeCameraFiles): NativeCameraOutput {
        check(!closed && output == null)
        return files.create().also { output = it }
    }
    @Synchronized fun close() {
        if (closed) return
        closed = true
        output?.close()
    }
}
