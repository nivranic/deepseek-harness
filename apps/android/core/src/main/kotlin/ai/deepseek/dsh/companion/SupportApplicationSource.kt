package ai.deepseek.dsh.companion

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Application commit and tree are independent of the scanner library's build metadata. */
data class SupportApplicationSource(val sourceSha: String, val treeSha: String) {
    init {
        if (listOf(sourceSha, treeSha).any { !Regex("[a-f0-9]{40}").matches(it) }) {
            throw SupportExportException(SupportExportFailure.INVALID_IDENTITY)
        }
    }

    companion object {
        /** Unstamped builds have neither field; partial, mistyped or unresolved metadata is invalid. */
        fun fromMetadata(source: Any?, tree: Any?): SupportApplicationSource? {
            if (source == null && tree == null || source == "" && tree == "") return null
            if (source !is String || tree !is String) throw SupportExportException(SupportExportFailure.INVALID_IDENTITY)
            return SupportApplicationSource(source, tree)
        }
    }

    internal fun toJson() = buildJsonObject {
        put("producer", "application-build")
        put("observation", "current")
        put("sourceSha", sourceSha)
        put("treeSha", treeSha)
    }
}
