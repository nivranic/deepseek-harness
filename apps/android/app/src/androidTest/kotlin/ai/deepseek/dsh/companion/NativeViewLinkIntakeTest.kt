package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeDescriptionState
import ai.deepseek.dsh.gateway.NativeGatewayDiagnosticSnapshot
import ai.deepseek.dsh.gateway.NativeObservedCapability
import ai.deepseek.dsh.gateway.NativeObservedRole
import ai.deepseek.dsh.gateway.NativeProtocolObservation
import ai.deepseek.dsh.link.WireValue
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** External VIEW authority is consumed once and never inferred from a later Host or lifecycle change. */
class NativeViewLinkIntakeTest {
    private val location = NativeViewLocation("host", "target", 0)
    private fun delivery(value: NativeViewLocation = location) = Intent(Intent.ACTION_VIEW, Uri.parse(NativeViewLocations.encodeDeepLink(value)))
    private fun shared() = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "preserve shared text")

    @Test fun parserAcceptsOnlyTheExactWrapperAndRejectsNestedIntentAuthority() {
        assertEquals(NativeViewLinkParseResult.Accepted(location), parseNativeViewLinkIntent(delivery()))
        val raw = NativeViewLocations.encodeDeepLink(location)
        for (value in listOf(NativeViewLocations.encode(location), "$raw?query=x", "$raw#fragment", "$raw/extra", " $raw", raw.replace("dsh-companion", "DSH-COMPANION"), raw.replace("session-view/", "session-view/%"), "dsh-companion://session-view/${"a".repeat(4097)}")) {
            assertEquals(value, NativeViewLinkParseResult.Invalid, parseNativeViewLinkIntent(Intent(Intent.ACTION_VIEW, Uri.parse(value))))
        }
        assertEquals(NativeViewLinkParseResult.Invalid, parseNativeViewLinkIntent(Intent(Intent.ACTION_VIEW)))
        assertEquals(NativeViewLinkParseResult.Invalid, parseNativeViewLinkIntent(delivery().apply { selector = Intent(Intent.ACTION_MAIN) }))
        assertEquals(NativeViewLinkParseResult.Invalid, parseNativeViewLinkIntent(delivery().putExtra(Intent.EXTRA_INTENT, shared())))
        assertEquals(NativeViewLinkParseResult.Invalid, parseNativeViewLinkIntent(delivery().apply { clipData = ClipData.newIntent("nested", shared()) }))
        assertEquals(NativeViewLinkParseResult.Invalid, parseNativeViewLinkIntent(delivery().apply { clipData = ClipData.newRawUri("file", Uri.parse("content://source/file")) }))
        assertEquals(NativeViewLinkParseResult.Ignored, parseNativeViewLinkIntent(shared()))
    }

    private class Fixture {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val inputs = CompanionInputState.memory()
        val starts = AtomicInteger()
        val calls = mutableListOf<String>()
        var older = false
        var beforePage: suspend () -> Unit = {}
        private fun value(raw: String) = WireValue.fromJsonElement(Json.parseToJsonElement(raw))
        private fun record(seq: Int) = """{"type":"event","event":{"seq":$seq,"type":"user/message","data":{"content":[{"type":"text","text":"text-$seq"}]}}}"""
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
                check(method == "session/page") { "Navigation must not submit prompts or uploads" }
                calls.add(method); beforePage()
                return value("""{"hasMore":false,"records":[${record(0)},${record(1)}]}""")
            }
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
                check(endpoint == "session/follow")
                starts.incrementAndGet()
                val records = if (older) "${record(2)},${record(3)}" else record(0)
                emit(value("""{"type":"snapshot","header":{"id":"target"},"cursor":${if (older) 3 else 0},"hasMore":$older,"records":[$records]}"""))
                awaitCancellation()
            }
        }
        val session = SessionModel(wire, scope, inputs = inputs)
        val saved = SavedStateHandle()
        val owner = NativeViewLinkIntake(saved)
        val store = ViewModelStore().also { it.put("link", owner) }
        val host get() = NativeViewLinkHost(session, NativeHostKey("fixture"), 1, "host")
        var current: NativeViewLinkHost? = host
        val admission get() = NativeViewLinkAdmission(host)
        val openings = AtomicInteger()
        fun advance(capability: NativeViewLinkCapability = NativeViewLinkCapability.READY) =
            owner.advance(admission, capability, { current }) { openings.incrementAndGet() }
        suspend fun close() {
            store.clear()
            try { session.closeAndAwait(); inputs.retireAndAwait() } finally { scope.cancel() }
        }
    }

    private suspend fun withFixture(block: suspend (Fixture) -> Unit) = withContext(Dispatchers.Main) {
        val fixture = Fixture()
        try { withTimeout(10_000) { block(fixture) } }
        finally { withContext(NonCancellable) { fixture.close() } }
    }
    private suspend fun settled(owner: NativeViewLinkIntake) { while (owner.occupied) delay(10) }

    @Test fun coldDeliveryWaitsForItsHostAndFollowCapabilityThenNavigatesExactlyOnce() = runBlocking {
        withFixture { f ->
            f.inputs.update { it.copy(drafts = mapOf("old" to SessionDraft("keep draft", "intent"))) }
            f.owner.onActivityCreated(delivery(), false, NativeViewLinkAdmission())
            f.owner.advance(NativeViewLinkAdmission(), NativeViewLinkCapability.READY, { null }) { error("unresolved Host") }
            assertEquals(NativeViewLinkPhase.WAITING, f.owner.phase); assertEquals(0, f.starts.get())
            f.advance(NativeViewLinkCapability.WAITING)
            assertEquals(0, f.starts.get())
            val generation = f.session.selectionGeneration
            f.advance(); settled(f.owner)
            assertEquals(NativeViewLinkPhase.OPENED, f.owner.phase)
            assertEquals("target", f.session.open.value?.sessionId); assertEquals(0L, f.session.viewAnchor.value?.seq)
            assertTrue(f.session.selectionGeneration > generation)
            assertEquals("keep draft", f.inputs.state.value.drafts.getValue("old").text)
            assertEquals(1, f.starts.get()); assertEquals(1, f.openings.get()); assertTrue(f.calls.isEmpty())
            repeat(3) { f.advance() }
            assertEquals(1, f.starts.get())
            val firstAnchor = f.session.viewAnchor.value
            f.owner.receive(delivery(), f.admission); f.advance(); settled(f.owner)
            assertEquals(2L, f.owner.attempt); assertEquals(2L, f.owner.arrival)
            assertEquals(2, f.starts.get()); assertNotEquals(firstAnchor, f.session.viewAnchor.value)
        }
    }

    @Test fun rejectedAdmissionNeverReadsSessionsOrRetriesWhenReadinessChanges() = runBlocking {
        withFixture { f ->
            for (issue in listOf(NativeViewLinkIssue.UNPAIRED, NativeViewLinkIssue.HOST_UNAVAILABLE, NativeViewLinkIssue.BUSY)) {
                f.owner.receive(delivery(), NativeViewLinkAdmission(issue = issue))
                assertEquals(issue, f.owner.issue)
                f.advance(); f.owner.admit(f.admission)
                assertEquals(NativeViewLinkPhase.FAILED, f.owner.phase)
            }
            f.owner.receive(delivery(location.copy(hostId = "another-host")), f.admission)
            assertEquals(NativeViewLinkIssue.WRONG_HOST, f.owner.issue); f.advance()
            assertEquals(0, f.starts.get()); assertTrue(f.calls.isEmpty()); assertNull(f.session.open.value)
        }
    }

    @Test fun unavailableAndFailedCapabilitiesAreTerminalUntilExplicitRetry() = runBlocking {
        withFixture { f ->
            for ((capability, issue) in listOf(NativeViewLinkCapability.UNAVAILABLE to NativeViewLinkIssue.CAPABILITY_UNAVAILABLE,
                    NativeViewLinkCapability.FAILED to NativeViewLinkIssue.CAPABILITY_FAILED)) {
                f.owner.receive(delivery(), f.admission); f.advance(capability)
                assertEquals(issue, f.owner.issue); f.advance()
                assertEquals(NativeViewLinkPhase.FAILED, f.owner.phase); assertEquals(0, f.starts.get())
            }
            val prior = f.owner.attempt
            f.owner.retry(f.admission); f.advance(NativeViewLinkCapability.WAITING)
            assertEquals(prior + 1, f.owner.attempt); assertEquals(0, f.starts.get())
            f.advance(); settled(f.owner)
            assertEquals(NativeViewLinkPhase.OPENED, f.owner.phase); assertEquals(1, f.starts.get())
        }
    }

    @Test fun shareAndViewPreserveWhicheverSourceAlreadyOwnsPendingWork() = runBlocking {
        withFixture { f ->
            val share = NativeShareIntake()
            routeNativeIncomingIntent(shared(), "fixture.app", share, f.owner, f.admission)
            val payload = share.payload
            routeNativeIncomingIntent(delivery(), "fixture.app", share, f.owner, f.admission)
            assertSame(payload, share.payload); assertEquals(NativeViewLinkIssue.BUSY, f.owner.issue)
            assertEquals(0, f.starts.get())
            share.dismiss(); f.owner.receive(delivery(), NativeViewLinkAdmission())
            val pending = f.owner.location; val attempt = f.owner.attempt
            routeNativeIncomingIntent(shared(), "fixture.app", share, f.owner, f.admission)
            routeNativeIncomingIntent(delivery(location.copy(sessionId = "other")), "fixture.app", share, f.owner, f.admission)
            assertNull(share.payload); assertEquals(pending, f.owner.location)
            assertEquals(attempt, f.owner.attempt); assertTrue(f.owner.incomingRejected)
            f.owner.cancel(); assertEquals(NativeViewLinkIssue.CANCELLED, f.owner.issue)
            f.advance(); assertEquals(0, f.starts.get())
            routeNativeIncomingIntent(shared(), "fixture.app", share, f.owner, f.admission)
            assertEquals("preserve shared text", share.payload?.text); share.dismiss()
        }
    }

    @Test fun rotationRetainsWaitingOwnerWhileProcessRestoreAndWarmHistoryNeverReplay() = runBlocking {
        withFixture { f ->
            f.owner.onActivityCreated(delivery(), false, NativeViewLinkAdmission())
            assertTrue(f.owner.takeFocusReset()); assertFalse(f.owner.takeFocusReset())
            val retained = ViewModelProvider(f.store, ViewModelProvider.NewInstanceFactory()).get("link", NativeViewLinkIntake::class.java)
            assertSame(f.owner, retained)
            retained.onActivityCreated(delivery(), true, f.admission)
            assertFalse(retained.takeFocusReset())
            assertEquals(1L, retained.arrival); assertEquals(1L, retained.attempt)
            val saved = f.saved.keys().associateWith { f.saved.get<Any>(it) }
            assertEquals(mapOf("native-view-link-disposition" to "pending"), saved)
            val restored = NativeViewLinkIntake(SavedStateHandle(saved))
            restored.onActivityCreated(delivery(), true, f.admission)
            assertEquals(NativeViewLinkPhase.INTERRUPTED, restored.phase); assertNull(restored.location)
            restored.advance(f.admission, NativeViewLinkCapability.READY, { f.host }) { error("restored authority") }
            val history = delivery().addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)
            retained.receive(history, f.admission)
            assertFalse(retained.incomingRejected); assertEquals(1L, retained.attempt)
            val historical = NativeViewLinkIntake()
            historical.onActivityCreated(history, false, f.admission)
            historical.receive(history, f.admission)
            assertEquals(NativeViewLinkPhase.INTERRUPTED, historical.phase); assertEquals(0L, historical.arrival)
            restored.receive(delivery(), NativeViewLinkAdmission(issue = NativeViewLinkIssue.UNPAIRED))
            assertEquals(1L, restored.attempt); assertNotNull(restored.location)
            assertEquals(0, f.starts.get()); restored.dismiss(); historical.dismiss()
            f.advance(); settled(f.owner)
            assertEquals(NativeViewLinkPhase.OPENED, retained.phase)
            assertEquals(1L, retained.attempt); assertEquals(1, f.starts.get())
        }
    }

    @Test fun rotationDuringOpeningRetainsTheOriginalPageJobWithoutIssuingAnotherNavigation() = runBlocking {
        withFixture { f ->
            f.older = true
            val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            f.beforePage = { entered.complete(Unit); withContext(NonCancellable) { release.await() } }
            try {
                f.owner.onActivityCreated(delivery(), false, f.admission); f.advance(); entered.await()
                val retained = ViewModelProvider(f.store, ViewModelProvider.NewInstanceFactory()).get("link", NativeViewLinkIntake::class.java)
                retained.onActivityCreated(delivery(), true, f.admission)
                f.advance(NativeViewLinkCapability.WAITING); f.advance()
                assertSame(f.owner, retained); assertEquals(1L, retained.attempt); assertEquals(1L, retained.arrival)
                assertEquals(NativeViewLinkPhase.OPENING, retained.phase)
                assertEquals(1, f.starts.get()); assertEquals(listOf("session/page"), f.calls)
                release.complete(Unit); settled(retained)
                assertEquals(NativeViewLinkPhase.OPENED, retained.phase); assertEquals(0L, f.session.viewAnchor.value?.seq)
                assertEquals(1, f.openings.get())
            } finally { release.complete(Unit) }
        }
    }

    @Test fun hostReplacementStopsNavigationAndALateSharedPageCannotPublishItsAnchor() = runBlocking {
        withFixture { f ->
            f.older = true
            val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            f.beforePage = { entered.complete(Unit); withContext(NonCancellable) { release.await() } }
            try {
                f.owner.receive(delivery(), f.admission); f.advance(); entered.await()
                assertEquals(NativeViewLinkPhase.OPENING, f.owner.phase)
                f.owner.receive(delivery(location.copy(sessionId = "replacement")), f.admission)
                assertEquals("target", f.owner.location?.sessionId); assertTrue(f.owner.incomingRejected)
                f.current = f.host.copy(generation = 2)
                f.advance()
                settled(f.owner)
                assertEquals(NativeViewLinkIssue.HOST_CHANGED, f.owner.issue)
                assertFalse(release.isCompleted)
                assertEquals("target", f.session.open.value?.sessionId)
                assertEquals("target", f.inputs.state.value.lastSessionId); assertNull(f.session.viewAnchor.value)
                release.complete(Unit)
                while (f.session.history.value.loading) delay(10)
                assertEquals(NativeViewLinkPhase.FAILED, f.owner.phase); assertNull(f.session.viewAnchor.value)
                f.advance(); assertEquals(1, f.starts.get()); assertEquals(listOf("session/page"), f.calls)
            } finally { release.complete(Unit) }
        }
    }

    @Test fun cancellingBeforeLazyJobStartsReleasesItsOwnerWithoutOpeningASession() = runBlocking {
        withFixture { f ->
            f.owner.receive(delivery(), f.admission)
            f.owner.advance(f.admission, NativeViewLinkCapability.READY, { f.current }) { f.owner.cancel() }
            settled(f.owner)
            assertEquals(NativeViewLinkIssue.CANCELLED, f.owner.issue); assertFalse(f.owner.occupied)
            assertEquals(0, f.starts.get()); assertNull(f.session.open.value)
        }
    }

    @Test fun viewerWithOnlySessionFollowCanNavigateButRetainedFactsDoNotAuthorizeFailedQueries() {
        val snapshot = NativeGatewayDiagnosticSnapshot(false, 0, 0, 0, 0, 0, NativeObservedRole.VIEWER,
            NativeDescriptionState.AVAILABLE, null, NativeProtocolObservation(0, setOf(NativeObservedCapability.SESSION_FOLLOW)))
        assertEquals(NativeViewLinkCapability.READY, nativeViewLinkCapability(NativeHostObservation(false, snapshot, completed = true)))
        assertEquals(NativeViewLinkCapability.FAILED, nativeViewLinkCapability(NativeHostObservation(false, snapshot, completed = true, failed = true)))
        assertEquals(NativeViewLinkCapability.WAITING, nativeViewLinkCapability(NativeHostObservation(true, snapshot)))
        assertEquals(NativeViewLinkCapability.UNAVAILABLE, nativeViewLinkCapability(NativeHostObservation(false,
            snapshot.copy(description = NativeProtocolObservation(0, emptySet())), completed = true)))
    }
}
