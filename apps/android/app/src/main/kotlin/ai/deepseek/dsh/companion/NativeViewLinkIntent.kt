package ai.deepseek.dsh.companion

import android.content.Intent

internal sealed interface NativeViewLinkParseResult {
    data object Ignored : NativeViewLinkParseResult
    data object Invalid : NativeViewLinkParseResult
    data class Accepted(val location: NativeViewLocation) : NativeViewLinkParseResult
}

/** External navigation uses the exact deep-link grammar; nested actions carry no navigation authority. */
internal fun parseNativeViewLinkIntent(intent: Intent): NativeViewLinkParseResult {
    if (intent.action != Intent.ACTION_VIEW) return NativeViewLinkParseResult.Ignored
    return try {
        require(intent.selector == null && !intent.hasExtra(Intent.EXTRA_INTENT) && intent.clipData == null)
        NativeViewLinkParseResult.Accepted(NativeViewLocations.decodeDeepLink(requireNotNull(intent.dataString)))
    } catch (_: RuntimeException) {
        // Malformed Parcelable extras and URI/JSON validation failures all reject untrusted delivery.
        NativeViewLinkParseResult.Invalid
    }
}

/** Dispatch synchronously so a second external source cannot replace another source's outstanding work. */
internal fun routeNativeIncomingIntent(intent: Intent, ownPackage: String, share: NativeShareIntake,
                                       link: NativeViewLinkIntake, admission: NativeViewLinkAdmission) {
    when (intent.action) {
        Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> if (link.occupied) link.rejectIncoming() else share.receive(intent, ownPackage)
        Intent.ACTION_VIEW -> link.receive(intent, if (share.occupied) NativeViewLinkAdmission(issue = NativeViewLinkIssue.BUSY) else admission)
    }
}
