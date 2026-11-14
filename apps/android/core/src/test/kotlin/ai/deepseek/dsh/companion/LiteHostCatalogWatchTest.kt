package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolRisk
import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The retain-last-success watch behind the paired tool-catalog observation
 * (§32): a served declaration reaches the assembled union, a null answer is
 * the normal no-capability path that keeps the BUNDLED union, and a
 * schema-violating reply keeps the last successful catalog while staying
 * observable.
 */
class LiteHostCatalogWatchTest {

    private class ScriptedWire(var answer: suspend () -> List<ToolDescriptor>?) : WireDriving {
        override suspend fun toolDescriptors(): List<ToolDescriptor>? = answer()
        override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected RPC")
        override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = error("unexpected stream")
    }

    private fun declared(id: String, supportsLite: Boolean = true): ToolDescriptor =
        ToolDescriptor(id, 1, ToolRisk.LOW, emptyList(), supportsLite, true)

    @Test
    fun aServedCatalogUnionsWithTheDeviceDeclarationsAsHostDeclared() = runTest {
        val wire = ScriptedWire { listOf(declared("web_search"), declared("run_tests", supportsLite = false)) }
        val watch = LiteHostCatalogWatch()

        val observation = watch.refresh(wire)
        assertFalse(observation.badWire)
        // The fetched declaration unions with the app-owned device document
        // exactly as the paired shell assembles it.
        val catalog = LiteToolCatalog.fromDeviceAndLiveHostDeclarations(
            listOf(declared("calculator")), checkNotNull(observation.descriptors),
        )
        assertEquals(LiteToolSource.HOST_DECLARED, catalog.source)
        assertNull(catalog.handoffCapability("calculator"))
        assertNull(catalog.handoffCapability("web_search"))
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, catalog.handoffCapability("run_tests"))
    }

    @Test
    fun aNullAnswerServesNoLiveDeclarationAndKeepsTheBundledUnion() = runTest {
        val wire = ScriptedWire { null }
        val watch = LiteHostCatalogWatch()

        val observation = watch.refresh(wire)
        assertNull(observation.descriptors)
        assertFalse(observation.badWire)
        // No live declaration reaches the assembly, so it keeps the
        // APK-frozen BUNDLED union as before.
        val catalog = LiteToolCatalog.fromBundledDocuments(listOf(declared("calculator")), listOf(declared("web_search")))
        assertEquals(LiteToolSource.BUNDLED, catalog.source)
    }

    @Test
    fun aBadWireKeepsTheLastCatalogAndStaysObservable() = runTest {
        val served = listOf(declared("web_search"))
        val wire = ScriptedWire { served }
        val watch = LiteHostCatalogWatch()
        assertEquals(served, watch.refresh(wire).descriptors)

        wire.answer = { throw LinkClientException.BadWire("invalid tool catalog: version") }
        val failed = watch.refresh(wire)
        assertEquals(served, failed.descriptors, "the last successful catalog stays in force")
        assertTrue(failed.badWire, "the schema violation stays observable")
    }

    @Test
    fun aTransportFailureKeepsTheLastCatalogWithoutTheBadWireFlag() = runTest {
        val served = listOf(declared("web_search"))
        val wire = ScriptedWire { served }
        val watch = LiteHostCatalogWatch()
        watch.refresh(wire)

        wire.answer = { throw LinkClientException.Carrier(0, "offline") }
        val failed = watch.refresh(wire)
        assertEquals(served, failed.descriptors)
        assertFalse(failed.badWire)
    }

    @Test
    fun aLaterNullAnswerKeepsTheEarlierServedCatalog() = runTest {
        val served = listOf(declared("web_search"))
        val wire = ScriptedWire { served }
        val watch = LiteHostCatalogWatch()
        watch.refresh(wire)

        wire.answer = { null }
        assertEquals(served, watch.refresh(wire).descriptors)
    }

    @Test
    fun aCancelledFetchPropagatesInsteadOfBecomingAnObservation() = runTest {
        val served = listOf(declared("web_search"))
        val wire = ScriptedWire { served }
        val watch = LiteHostCatalogWatch()
        watch.refresh(wire)

        wire.answer = { throw CancellationException("refresh abandoned") }
        val failure = assertFailsWith<CancellationException> { watch.refresh(wire) }
        assertEquals("refresh abandoned", failure.message)
        // The abandoned attempt stays no observation: a later fetch still reads the wire.
        wire.answer = { null }
        assertEquals(served, watch.refresh(wire).descriptors)
    }

    @Test
    fun aStatelessWireServesNoLiveDeclarationByDefault() = runTest {
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("unexpected RPC")
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = error("unexpected stream")
        }
        assertNull(wire.toolDescriptors())
        // The default null answer is the no-capability path the watch observes.
        val observation = LiteHostCatalogWatch().refresh(wire)
        assertNull(observation.descriptors)
        assertFalse(observation.badWire)
    }

    @Test
    fun aSwitchedWireFetchesThroughTheCurrentDelegateOnly() = runTest {
        val served = listOf(declared("web_search"))
        val handle = SwitchableWireDriving(ScriptedWire { served })
        assertEquals(served, handle.toolDescriptors())

        handle.replace(ScriptedWire { null })
        assertNull(handle.toolDescriptors())
        handle.close()
    }
}
