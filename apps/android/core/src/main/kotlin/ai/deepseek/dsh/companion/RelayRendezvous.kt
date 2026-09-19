package ai.deepseek.dsh.companion

/**
 * One device registered at the relay (chapter 69's rendezvous): identity
 * plus the push-token slot APNs/FCM delivery will fill — references only.
 */
data class RelayDevice(
    val accountId: String,
    val deviceId: String,
    val platform: String,
    val pushToken: String? = null,
)

/**
 * One forwarded envelope — the chapter-70 minimized push vocabulary:
 * references only, never source code, prompt, credential, or diff content.
 */
data class RelayEnvelope(
    val kind: String,
    val sessionId: String,
    val eventId: String? = null,
    val turn: Int? = null,
)

/**
 * The relay's rendezvous skeleton (chapters 68/69): an in-memory, single-
 * account forwarding service — devices register, publishers push reference
 * envelopes, devices drain them by poll. It holds no session data, no
 * workspace state, and no authority: every byte it keeps is a pending
 * envelope, and the Windows/macOS host keeps full session authority.
 */
class RelayRendezvous {
    private val devices = linkedMapOf<String, RelayDevice>()
    private val pending = linkedMapOf<String, MutableList<RelayEnvelope>>()

    /**
     * Register one device; re-registration under the same token refreshes
     * its record.
     * @param device the device identity and its push-token slot.
     * @return the opaque rendezvous token polling requires.
     */
    fun register(device: RelayDevice): String {
        val token = "rt-${device.accountId}-${device.deviceId}"
        devices[token] = device
        pending.getOrPut(token) { mutableListOf() }
        return token
    }

    /**
     * The devices registered under one account, in registration order —
     * the account's presence.
     */
    fun devices(accountId: String): List<RelayDevice> =
        devices.values.filter { it.accountId == accountId }

    /**
     * Forward one reference envelope to every device of the account.
     * @param accountId the account whose devices receive the envelope.
     * @param envelope the minimized, reference-only payload.
     * @return how many devices the envelope queued for.
     */
    fun publish(accountId: String, envelope: RelayEnvelope): Int {
        var delivered = 0
        for ((token, device) in devices) {
            if (device.accountId == accountId) {
                pending.getValue(token).add(envelope)
                delivered += 1
            }
        }
        return delivered
    }

    /**
     * Drain one device's pending envelopes in arrival order; an unknown
     * token drains nothing.
     * @param token the rendezvous token from registration.
     * @return the forwarded envelopes, oldest first.
     */
    fun poll(token: String): List<RelayEnvelope> {
        val queue = pending[token] ?: return emptyList()
        val drained = queue.toList()
        queue.clear()
        return drained
    }
}

/**
 * Bridge a forwarded envelope onto the chapter-70 push vocabulary — the
 * dependency link APNs/FCM delivery will ride.
 * @return the minimized push, or null for a non-push kind.
 */
fun RelayEnvelope.asPush(): CompanionPush? = when (kind) {
    "approval-waiting" -> eventId?.let { CompanionPush.ApprovalWaiting(sessionId = sessionId, eventId = it) }
    "question-waiting" -> eventId?.let { CompanionPush.QuestionWaiting(sessionId = sessionId, eventId = it) }
    "task-completed" -> turn?.let { CompanionPush.TaskCompleted(sessionId = sessionId, turn = it) }
    else -> null
}
