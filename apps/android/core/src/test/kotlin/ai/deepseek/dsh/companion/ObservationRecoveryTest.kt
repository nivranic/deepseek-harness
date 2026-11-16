package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import java.io.IOException
import java.security.cert.CertificateException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.*
import kotlin.test.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ObservationRecoveryTest {
    private class Source(val failure: Exception, val recover: Boolean = false) : WireDriving {
        var attempts = 0
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("observations must not mutate")
        override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
            attempts++
            if (!recover || attempts == 1) throw failure
            awaitCancellation()
        }
    }

    @Test fun `Session and Workspace observations stop on permanent refusals`() = runTest {
        for (session in listOf(true, false)) {
            val wire = Source(LinkClientException.Refused("device/already-revoked", "revoked"))
            val sessions = SessionModel(wire, backgroundScope, 1000)
            val files = FilesModel(wire, backgroundScope, 1000)
            if (session) sessions.openSession("session") else files.start()
            runCurrent(); advanceTimeBy(5000); runCurrent()
            assertEquals(1, wire.attempts)
            assertEquals(ConnectionState.ENDED, if (session) sessions.connectionSnapshot.state else files.connectionSnapshot.state)
            if (session) sessions.closeAndAwait() else files.stopAndAwait()
        }
    }

    @Test fun `transport failure recovers Session and Workspace observers without a mutation`() = runTest {
        for (session in listOf(true, false)) {
            val wire = Source(IOException("socket interrupted"), recover = true)
            val sessions = SessionModel(wire, backgroundScope, 1000)
            val files = FilesModel(wire, backgroundScope, 1000)
            if (session) sessions.openSession("session") else files.start()
            runCurrent(); advanceTimeBy(1000); runCurrent()
            assertEquals(2, wire.attempts)
            if (session) sessions.closeAndAwait() else files.stopAndAwait()
            advanceTimeBy(5000); runCurrent()
            assertEquals(2, wire.attempts)
        }
    }

    @Test fun `unpaired internal malformed and certificate failures wait for manual recovery`() = runTest {
        for (failure in listOf(LinkClientException.Unpaired(), IllegalStateException("invalid owner"),
            LinkClientException.BadWire("invalid frame"),
            LinkClientException.Carrier(0, "TLS rejected").apply { initCause(CertificateException("pin mismatch")) })) {
            val wire = Source(failure)
            val model = InteractionModel(wire, backgroundScope, 1000)
            model.startWatching(); runCurrent(); advanceTimeBy(5000); runCurrent()
            assertEquals(1, wire.attempts)
            assertNotNull(model.streamFailure.value)
            model.stopWatchingAndAwait()
        }
    }
}
