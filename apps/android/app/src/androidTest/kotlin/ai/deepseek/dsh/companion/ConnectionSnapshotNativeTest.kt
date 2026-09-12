package ai.deepseek.dsh.companion

import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/** The production view model reads its own models and stops them without retiring the process wire. */
class ConnectionSnapshotNativeTest {
    @Test fun viewModelCapturesAllFourOwnersBeforePairingAndClearsTheirLifetimes() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val store = ViewModelStore()
            val model = CompanionViewModel()
            store.put("companion", model)
            val wire = CompanionRuntime.wire
            val captured = model.supportSnapshot()
            val idle = ConnectionSnapshot(ConnectionState.IDLE, 0, 0, null)
            assertEquals(ConnectionSnapshots(idle, idle, idle, idle), captured.connections)
            store.clear()
            val stopped = idle.copy(state = ConnectionState.STOPPED)
            assertEquals(ConnectionSnapshots(stopped, stopped, stopped, stopped), model.supportSnapshot().connections)
            assertEquals(ConnectionSnapshots(idle, idle, idle, idle), captured.connections)
            assertSame(wire, CompanionRuntime.wire)
        }
    }
}
