package ai.deepseek.dsh.companion

import android.content.Intent
import android.net.Uri

/** Incoming URIs remain memory-only and are never opened by Intent parsing. */
internal data class NativeSharedUri(val uri: Uri, val requireImage: Boolean)
internal data class NativeSharePayload(val text: String, val items: List<NativeSharedUri>)
internal enum class NativeShareRejection { INVALID, EMPTY, TOO_MANY, TEXT_TOO_LARGE }
internal sealed interface NativeShareParseResult {
    data object Ignored : NativeShareParseResult
    data class Accepted(val payload: NativeSharePayload) : NativeShareParseResult
    data class Rejected(val issue: NativeShareRejection) : NativeShareParseResult
}

/** Parse only delivered values; provider metadata, URI grants and bytes are checked after explicit import. */
internal fun parseNativeShareIntent(intent: Intent, ownPackage: String): NativeShareParseResult {
    if (intent.action !in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return NativeShareParseResult.Ignored
    return try {
        require(intent.selector == null && !intent.hasExtra(Intent.EXTRA_INTENT))
        val clip = intent.clipData
        if (clip != null) {
            if (clip.itemCount > 8) return NativeShareParseResult.Rejected(NativeShareRejection.TOO_MANY)
            for (index in 0 until clip.itemCount) require(clip.getItemAt(index).intent == null)
        }
        val text = if (intent.hasExtra(Intent.EXTRA_TEXT)) checkNotNull(intent.getCharSequenceExtra(Intent.EXTRA_TEXT)).toString() else ""
        if (text.length > 65_536 || text.toByteArray(Charsets.UTF_8).size > 65_536) {
            return NativeShareParseResult.Rejected(NativeShareRejection.TEXT_TOO_LARGE)
        }
        val uris = if (intent.hasExtra(Intent.EXTRA_STREAM)) {
            if (intent.action == Intent.ACTION_SEND) listOf(checkNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)))
            else checkNotNull(intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)).let {
                if (it.size > 8) return NativeShareParseResult.Rejected(NativeShareRejection.TOO_MANY)
                it.toList()
            }
        } else if (clip == null) emptyList() else (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        if (uris.size > 8) return NativeShareParseResult.Rejected(NativeShareRejection.TOO_MANY)
        require(intent.action != Intent.ACTION_SEND || uris.size <= 1)
        val items = uris.map { uri ->
            require(uri.scheme == "content" && !uri.authority.isNullOrBlank() && uri.userInfo == null)
            require(uri.authority != "$ownPackage.native-camera")
            NativeSharedUri(uri, intent.type?.startsWith("image/", ignoreCase = true) == true)
        }
        if (text.isEmpty() && items.isEmpty()) NativeShareParseResult.Rejected(NativeShareRejection.EMPTY)
        else NativeShareParseResult.Accepted(NativeSharePayload(text, items))
    } catch (_: RuntimeException) {
        // Typed Parcelable, malformed extras and invalid URI values are all untrusted Intent input.
        NativeShareParseResult.Rejected(NativeShareRejection.INVALID)
    }
}
