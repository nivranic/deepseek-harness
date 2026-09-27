package ai.deepseek.dsh.companion

import org.junit.Assert.*
import org.junit.Test

/** Controller admission uses an injected system query; these cases do not grant Android permission. */
class NotificationGrantControllerNativeTest {
    @Test fun claimsTheMissingGrantBeforeTheFirstAnswerAndRejectsAnotherClaim() {
        val controller = NotificationGrantController { false }
        assertEquals(NotificationGrantState(systemEnabled = false), controller.state.value)

        assertTrue(controller.claimRequest())
        assertEquals(NotificationGrantState(systemEnabled = false, requested = true), controller.state.value)
        assertFalse(controller.claimRequest())
        assertNull(controller.state.value.lastAnswer)
    }

    @Test fun anEnabledSystemDoesNotConsumeTheProcessRequestBudget() {
        var enabled = true
        val controller = NotificationGrantController { enabled }
        assertFalse(controller.claimRequest())
        assertFalse(controller.state.value.requested)

        enabled = false
        controller.refresh()
        assertTrue(controller.claimRequest())
        assertFalse(controller.claimRequest())
    }

    @Test fun aPositiveAnswerCannotOverrideTheDisabledSystem() {
        val controller = NotificationGrantController { false }
        assertTrue(controller.claimRequest())

        controller.onUserAnswer(true)

        assertEquals(NotificationGrantState(systemEnabled = false, requested = true, lastAnswer = true), controller.state.value)
        assertFalse(controller.state.value.canPresent)
        assertFalse(controller.claimRequest())
    }

    @Test fun aNegativeAnswerCannotOverrideTheEnabledSystem() {
        var enabled = false
        val controller = NotificationGrantController { enabled }
        assertTrue(controller.claimRequest())
        enabled = true

        controller.onUserAnswer(false)

        assertEquals(NotificationGrantState(systemEnabled = true, requested = true, lastAnswer = false), controller.state.value)
        assertTrue(controller.state.value.canPresent)
        assertFalse(controller.claimRequest())
    }

    @Test fun laterSystemChangesPreserveTheAnswerAndConsumedRequestBudget() {
        var enabled = false
        val controller = NotificationGrantController { enabled }
        assertTrue(controller.claimRequest())
        controller.onUserAnswer(false)

        enabled = true
        controller.refresh()
        assertEquals(NotificationGrantState(systemEnabled = true, requested = true, lastAnswer = false), controller.state.value)

        enabled = false
        controller.refresh()
        assertEquals(NotificationGrantState(systemEnabled = false, requested = true, lastAnswer = false), controller.state.value)
        assertFalse(controller.claimRequest())
    }
}
