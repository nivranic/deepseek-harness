package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.IOException
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import kotlin.test.*

private fun catalogWire(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
private fun childRow(id: String) = """{"kind":"child","id":"$id","mode":"one-shot","activity":"inactive","hasChildren":false}"""
private fun catalog(vararg ids: String) = catalogWire("""{"parentAvailable":false,"entries":[${ids.joinToString(",", transform = ::childRow)}]}""")

/** Held transport cleanup makes replacement ordering observable without sleeps. */
private class ChildWire : WireDriving {
    data class Observation(val child: String, val address: WireValue, val stopping: CompletableDeferred<Unit> = CompletableDeferred(),
                           val release: CompletableDeferred<Unit> = CompletableDeferred())
    val observations = mutableListOf<Observation>()
    val pageEntered = CompletableDeferred<Unit>()
    val pageStopping = CompletableDeferred<Unit>()
    val pageRelease = CompletableDeferred<Unit>()
    var holdPage = false
    var active = 0
    var maxActive = 0
    val calls = mutableListOf<String>()
    override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
        calls += method
        if (method == "subagents/list") return catalog("first", "second")
        check(method == "session/page")
        pageEntered.complete(Unit)
        try { awaitCancellation() } finally {
            pageStopping.complete(Unit)
            withContext(NonCancellable) { if (holdPage) pageRelease.await() }
        }
    }
    override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
        check(endpoint == "session/follow")
        val request = payload.getValue("request") as WireValue.ObjectValue
        val address = request.entries.getValue("address") as WireValue.ObjectValue
        val child = (address.entries.getValue("childSessionId") as WireValue.StringValue).value
        val observation = Observation(child, address)
        observations += observation
        active++
        maxActive = maxOf(maxActive, active)
        try {
            emit(catalogWire("""{"type":"snapshot","header":{"id":"$child"},"cursor":1,"hasMore":true,"records":[{"type":"event","event":{"seq":1,"time":1,"type":"user/message","data":{"id":"m1","role":"user","content":[{"type":"text","text":"saved $child"}],"source":{"kind":"user"}}}}]}"""))
            awaitCancellation()
        } finally {
            observation.stopping.complete(Unit)
            withContext(NonCancellable) { observation.release.await(); active-- }
        }
    }
    fun release() { observations.forEach { it.release.complete(Unit) }; pageRelease.complete(Unit) }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SubagentsModelTest {
    @Test fun parentSwitchRejectsLateCatalogAndAwaitsItsRetirement() = runTest {
        val wire = FakeWire()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        wire.stub("subagents/list") { entered.complete(Unit); withContext(NonCancellable) { release.await(); catalog("old") } }
        val model = SubagentsModel(wire, backgroundScope)
        model.selectParent("old-parent")
        val old = async { model.refresh() }
        entered.await()
        val switch = async { model.selectParent("new-parent") }
        runCurrent()
        assertEquals(SubagentListing("new-parent"), model.listing.value)
        assertFalse(switch.isCompleted)
        wire.stub("subagents/list") { catalog("new") }
        model.refresh()
        release.complete(Unit)
        switch.await(); old.join()
        assertTrue(old.isCancelled)
        assertEquals(listOf("new"), model.listing.value.rows.map { it.id })
        assertEquals("new-parent", model.listing.value.parentSessionId)
        model.closeAndAwait()
    }

    @Test fun supersededRefreshCannotOverwriteNewRows() = runTest {
        val wire = FakeWire()
        val release = CompletableDeferred<Unit>()
        wire.stub("subagents/list") { withContext(NonCancellable) { release.await(); catalog("old") } }
        val model = SubagentsModel(wire, backgroundScope)
        model.selectParent("parent")
        val old = async { model.refresh() }
        runCurrent()
        wire.stub("subagents/list") { catalog("new") }
        model.refresh()
        release.complete(Unit); old.join()
        assertEquals(listOf("new"), model.listing.value.rows.map { it.id })
        assertEquals(SubagentListState.Ready, model.listing.value.state)
        model.closeAndAwait()
    }

    @Test fun failedRefreshRetainsOnlyTheSelectedParentsRows() = runTest {
        val wire = FakeWire()
        wire.stub("subagents/list") { catalog("saved") }
        val model = SubagentsModel(wire, backgroundScope)
        model.selectParent("parent"); model.refresh()
        wire.stub("subagents/list") { throw IOException("offline") }
        model.refresh()
        assertIs<SubagentListState.Failed>(model.listing.value.state)
        assertEquals(listOf("saved"), model.listing.value.rows.map { it.id })
        model.selectParent("other"); model.refresh()
        assertIs<SubagentListState.Failed>(model.listing.value.state)
        assertTrue(model.listing.value.rows.isEmpty())
        model.closeAndAwait()
    }

    @Test fun malformedCatalogCannotPublishOpenableRows() = runTest {
        val invalid = listOf(
            """{"entries":[]}""",
            """{"parentAvailable":false,"entries":[${childRow("same")},${childRow("same")}]}""",
            """{"parentAvailable":false,"entries":[{"kind":"child","id":"x","mode":"future","activity":"inactive"}]}""",
            """{"parentAvailable":false,"entries":[{"kind":"child","id":"x","mode":"continuable","activity":"inactive"}]}""",
            """{"parentAvailable":false,"entries":[{"kind":"child","id":"x","mode":"one-shot","activity":"future"}]}""",
            """{"parentAvailable":false,"entries":[{"kind":"diagnostic","id":"x","reason":"future"}]}""",
            """{"parentAvailable":false,"entries":[{"kind":"future","id":"x"}]}""",
            """{"parentAvailable":false,"entries":[{"kind":"child","id":"","mode":"one-shot","activity":"inactive"}]}""",
        )
        for (json in invalid) {
            val wire = FakeWire()
            wire.stub("subagents/list") { catalogWire(json) }
            val model = SubagentsModel(wire, backgroundScope)
            model.selectParent("parent"); model.refresh()
            assertIs<SubagentListState.Failed>(model.listing.value.state, json)
            assertTrue(model.listing.value.rows.isEmpty())
            assertFalse(model.openChild("parent", "x"))
            model.closeAndAwait()
        }
    }

    @Test fun coldHistoryOpensByParentAddressAndRetiredViewCannotRestart() = runTest {
        val wire = ChildWire()
        val model = SubagentsModel(wire, backgroundScope)
        try {
            model.selectParent("parent"); model.refresh()
            assertEquals(false, model.listing.value.parentAvailable)
            assertFalse(model.openChild("stale-parent", "first"))
            assertFalse(model.openChild("parent", "missing"))
            assertTrue(wire.observations.isEmpty())
            assertTrue(model.openChild("parent", "first")); runCurrent()
            val view = assertNotNull(model.childTimeline.value)
            assertEquals("saved first", view.open.value?.state?.items?.single()?.text)
            val address = wire.observations.single().address as WireValue.ObjectValue
            assertEquals(WireValue.StringValue("parent"), address.entries["parentSessionId"])
            assertEquals(WireValue.StringValue("subagent"), address.entries["kind"])
            wire.release(); model.closeChildAndAwait()
            assertFailsWith<CancellationException> { view.reconnect() }
            assertFailsWith<CancellationException> { view.loadOlderHistory() }
            assertEquals(1, wire.observations.size)
            assertEquals(listOf("subagents/list"), wire.calls)
        } finally { wire.release(); model.closeAndAwait() }
    }

    @Test fun replacementWaitsForBothFollowAndPageCleanup() = runTest {
        val wire = ChildWire().also { it.holdPage = true }
        val model = SubagentsModel(wire, backgroundScope)
        try {
            model.selectParent("parent"); model.refresh(); model.openChild("parent", "first"); runCurrent()
            val old = assertNotNull(model.childTimeline.value)
            val paging = async { old.loadOlderHistory() }
            wire.pageEntered.await()
            val replacement = async { model.openChild("parent", "second") }
            runCurrent()
            assertTrue(wire.observations.single().stopping.isCompleted)
            assertTrue(wire.pageStopping.isCompleted)
            assertFalse(replacement.isCompleted)
            wire.observations.single().release.complete(Unit); runCurrent()
            assertFalse(replacement.isCompleted)
            wire.pageRelease.complete(Unit)
            assertTrue(replacement.await()); paging.join(); runCurrent()
            assertEquals(listOf("first", "second"), wire.observations.map { it.child })
            assertEquals(1, wire.maxActive)
            assertEquals("second", model.childTimeline.value?.row?.id)
        } finally { wire.release(); model.closeAndAwait() }
        assertEquals(0, wire.active)
    }

    @Test fun closeInvalidatesAReplacementHeldOnOldCleanup() = runTest {
        val wire = ChildWire()
        val model = SubagentsModel(wire, backgroundScope)
        try {
            model.selectParent("parent"); model.refresh(); model.openChild("parent", "first"); runCurrent()
            val replacing = async { model.openChild("parent", "second") }; runCurrent()
            model.close()
            val closing = async { model.closeAndAwait() }; runCurrent()
            assertFalse(closing.isCompleted)
            wire.release()
            assertFalse(replacing.await()); closing.await()
            assertNull(model.childTimeline.value)
            assertEquals(listOf("first"), wire.observations.map { it.child })
            assertEquals(0, wire.active)
            assertFalse(model.openChild("parent", "second"))
        } finally { wire.release(); model.closeAndAwait() }
    }

    @Test fun parentSwitchRetiresChildBeforeAcceptingAnotherOpen() = runTest {
        val wire = ChildWire()
        val model = SubagentsModel(wire, backgroundScope)
        try {
            model.selectParent("parent"); model.refresh(); model.openChild("parent", "first"); runCurrent()
            val switching = async { model.selectParent("other") }; runCurrent()
            assertEquals("other", model.listing.value.parentSessionId)
            assertNull(model.childTimeline.value)
            assertFalse(switching.isCompleted)
            wire.release(); switching.await()
            assertFalse(model.openChild("parent", "first"))
            assertEquals(0, wire.active)
        } finally { wire.release(); model.closeAndAwait() }
    }
}
