package ai.deepseek.dsh.companion

import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.assertEquals

/** The rendezvous skeleton's forwarding semantics (chapters 68/69). */
class RelayRendezvousTest {
    @Test
    fun registersDevicesAndForwardsReferencesToEveryDevice() {
        val relay = RelayRendezvous()
        val phone = relay.register(RelayDevice("acct", "phone", "android"))
        val pad = relay.register(RelayDevice("acct", "pad", "ios", pushToken = "apns-token"))
        assertEquals(2, relay.devices("acct").size)

        val delivered = relay.publish("acct", RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1"))
        assertEquals(2, delivered)

        assertEquals(
            listOf(RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1")),
            relay.poll(phone),
        )
        // Draining retires the queue.
        assertTrue(relay.poll(phone).isEmpty())
        assertEquals(listOf(RelayEnvelope("approval-waiting", "s1", "e1")), relay.poll(pad))
    }

    @Test
    fun accountsAreIsolatedAndUnknownTokensDrainNothing() {
        val relay = RelayRendezvous()
        val mine = relay.register(RelayDevice("mine", "phone", "android"))
        relay.register(RelayDevice("other", "phone", "android"))
        // The envelope reaches only the other account's device.
        assertEquals(1, relay.publish("other", RelayEnvelope(kind = "task-completed", sessionId = "s9", turn = 1)))
        assertTrue(relay.poll(mine).isEmpty())
        assertTrue(relay.poll("rt-unknown").isEmpty())
    }

    @Test
    fun forwardedEnvelopesBridgeOntoThePushVocabulary() {
        val relay = RelayRendezvous()
        val token = relay.register(RelayDevice("acct", "phone", "android"))
        relay.publish("acct", RelayEnvelope(kind = "approval-waiting", sessionId = "s1", eventId = "e1"))
        relay.publish("acct", RelayEnvelope(kind = "question-waiting", sessionId = "s1", eventId = "e2"))
        relay.publish("acct", RelayEnvelope(kind = "task-completed", sessionId = "s1", turn = 3))
        relay.publish("acct", RelayEnvelope(kind = "unknown", sessionId = "s1"))

        assertEquals(
            listOf(
                CompanionPush.ApprovalWaiting(sessionId = "s1", eventId = "e1"),
                CompanionPush.QuestionWaiting(sessionId = "s1", eventId = "e2"),
                CompanionPush.TaskCompleted(sessionId = "s1", turn = 3),
                null,
            ),
            relay.poll(token).map { it.asPush() },
        )
    }
}
