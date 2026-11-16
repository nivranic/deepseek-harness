package ai.deepseek.dsh.companion

/**
 * The chapter-70 runtime grant projection: Android 13+ asks for
 * POST_NOTIFICATIONS at runtime, so the push chain exposes the system's
 * enablement, whether this process has asked, and the user's last answer —
 * presenting proceeds on system enablement, and the ask fires once per
 * process while the grant is missing (a denial sticks until the user
 * changes it in system settings, which the system-enablement read observes).
 */
data class NotificationGrantState(
    val systemEnabled: Boolean,
    val requested: Boolean = false,
    val lastAnswer: Boolean? = null,
) {
    /** Presenting proceeds whenever the system allows it. */
    val canPresent: Boolean get() = systemEnabled

    /** The ask fires once per process while the grant is missing. */
    val shouldRequest: Boolean get() = !systemEnabled && !requested
}
