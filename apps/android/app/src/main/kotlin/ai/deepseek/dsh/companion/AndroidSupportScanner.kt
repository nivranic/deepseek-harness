package ai.deepseek.dsh.companion

import ai.deepseek.dsh.scanner.supportscanner.Supportscanner
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject
import java.security.MessageDigest
import java.util.zip.ZipFile

/** Verifies the installed JNI bytes before invoking the bundled scanner; all refusal messages are fixed. */
class AndroidSupportScanner(context: Context) : SupportDocumentScanner {
    private val context = context.applicationContext
    private val verified by lazy { inspectInstalledLibrary() }

    override fun identity(): SupportScannerIdentity = verified

    override fun open(document: ByteArray, policy: SupportExportPolicy): SupportScanOperation = try {
        identity()
        val operation = Supportscanner.newOperation(document, policy.maximumBytes.toLong(), policy.scanMilliseconds)
        object : SupportScanOperation {
            override fun run(): SupportScanResult {
                val result = operation.run()
                return SupportScanResult(result.status(), result.data(), result.digest())
            }
            override fun cancelAndJoin() = operation.cancel()
        }
    } catch (failure: SupportExportException) {
        throw failure
    } catch (_: LinkageError) {
        throw SupportExportException(SupportExportFailure.UNAVAILABLE)
    } catch (_: Exception) {
        throw SupportExportException(SupportExportFailure.SCAN_FAILED)
    }

    private fun inspectInstalledLibrary(): SupportScannerIdentity = try {
        val content = context.assets.open("dsh-support-scanner/manifest.json").use { it.readNBytes(1024 * 1024 + 1) }
        require(content.size <= 1024 * 1024)
        val manifest = JSONObject(String(content, Charsets.UTF_8))
        val sourceSha = manifest.getJSONObject("source").getString("sourceSha")
        val application = context.packageManager.getApplicationInfo(context.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
        require(Regex("[a-f0-9]{40}").matches(sourceSha) && sourceSha == application.metaData?.getString("ai.deepseek.dsh.scannerSource"))
        val libraries = manifest.getJSONArray("libraries")
        val supported = (0 until libraries.length()).map { libraries.getJSONObject(it) }
        require(supported.size == 2 && supported.map { it.getString("abi") }.toSet() == setOf("arm64-v8a", "x86_64"))
        val selected = Build.SUPPORTED_ABIS.firstNotNullOfOrNull { abi -> supported.singleOrNull { it.getString("abi") == abi } }
            ?: throw SupportExportException(SupportExportFailure.UNAVAILABLE)
        val name = "lib/${selected.getString("abi")}/libgojni.so"
        val expectedDigest = selected.getString("sha256")
        require(Regex("[a-f0-9]{64}").matches(expectedDigest))
        val paths = listOf(context.applicationInfo.sourceDir) + context.applicationInfo.splitSourceDirs.orEmpty().toList()
        var matches = 0
        for (path in paths) ZipFile(path).use { archive ->
            val entries = archive.entries().asSequence().filter { it.name == name }.toList()
            for (entry in entries) {
                require(!entry.isDirectory && entry.size == selected.getLong("bytes") && entry.size in 1..64 * 1024 * 1024)
                val digest = MessageDigest.getInstance("SHA-256")
                var size = 0L
                archive.getInputStream(entry).use { input ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        size += count
                        require(size <= entry.size)
                        digest.update(buffer, 0, count)
                    }
                }
                require(size == entry.size && digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) } == expectedDigest)
                matches++
            }
        }
        require(matches == 1)
        SupportScannerIdentity(Supportscanner.Version, Supportscanner.rulesDigest(), sourceSha, expectedDigest)
    } catch (failure: SupportExportException) {
        throw failure
    } catch (_: LinkageError) {
        throw SupportExportException(SupportExportFailure.UNAVAILABLE)
    } catch (_: Exception) {
        throw SupportExportException(SupportExportFailure.INVALID_SCANNER)
    }
}
