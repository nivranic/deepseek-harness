package ai.deepseek.dsh.companion

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The chapter-70 runtime grant projection. */
class NotificationGrantTest {
    @Test
    fun anEnabledSystemPresentsWithoutAsking() {
        val state = NotificationGrantState(systemEnabled = true)
        assertTrue(state.canPresent)
        assertFalse(state.shouldRequest, "no ask when the system already allows notifications")
    }

    @Test
    fun aMissingGrantAsksOncePerProcess() {
        val fresh = NotificationGrantState(systemEnabled = false)
        assertFalse(fresh.canPresent)
        assertTrue(fresh.shouldRequest, "the first missing grant triggers the ask")
        assertNull(fresh.lastAnswer)

        val denied = NotificationGrantState(systemEnabled = false, requested = true, lastAnswer = false)
        assertFalse(denied.canPresent)
        assertFalse(denied.shouldRequest, "a denial sticks for this process; system settings are the recovery path")
        assertEquals(false, denied.lastAnswer)
    }

    @Test
    fun aGrantedAnswerFlipsTheSystemRead() {
        val granted = NotificationGrantState(systemEnabled = true, requested = true, lastAnswer = true)
        assertTrue(granted.canPresent)
        assertFalse(granted.shouldRequest)
        assertEquals(true, granted.lastAnswer)
    }
}
