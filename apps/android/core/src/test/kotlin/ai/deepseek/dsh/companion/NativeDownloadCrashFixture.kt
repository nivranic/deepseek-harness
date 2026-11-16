package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.CredentialsCipher
import java.io.File

/** Abrupt fixture death after synced data and before its checkpoint replacement; no finally runs. */
object NativeDownloadCrashFixture {
    @JvmStatic fun main(args: Array<String>) {
        var seals = 0
        val cipher = object : CredentialsCipher {
            override fun seal(plain: ByteArray): ByteArray {
                if (++seals == 5) Runtime.getRuntime().halt(23)
                return plain
            }
            override fun open(sealed: ByteArray) = sealed
        }
        val store = FileNativeDownloadStore(File(args.single()), CompanionInputPrincipal("host", "a".repeat(64), "device"),
            NativeResourceTarget("session", "秘密.bin"), cipher, NativeDownloadLimits(4, 32))
        val first = store.append(store.begin(NativeFileDescriptor("/workspace/秘密.bin", "v1", 6)),
            NativeResourceWindow(byteArrayOf(1, 2, 3, 4), false))
        store.append(first, NativeResourceWindow(byteArrayOf(99, 99), true))
        error("fixture did not halt")
    }
}
