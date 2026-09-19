package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkRequestSnapshot
import ai.deepseek.dsh.link.LinkDiagnosticSnapshot
import ai.deepseek.dsh.link.LinkDescriptionState
import ai.deepseek.dsh.link.LinkDescriptionFailure
import ai.deepseek.dsh.link.LinkDeviceRole
import ai.deepseek.dsh.link.LinkProtocolObservation
import ai.deepseek.dsh.link.LinkObservedRuntimeClass
import ai.deepseek.dsh.link.LinkCapabilities
import ai.deepseek.dsh.link.LinkSessionCapabilities
import ai.deepseek.dsh.link.LinkWorkspaceCapabilities
import ai.deepseek.dsh.link.LinkInteractionCapabilities
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SupportExportTest {
    private val identity = SupportScannerIdentity("8.30.1", "a".repeat(64), "b".repeat(40), "c".repeat(64))
    private val applicationSource = SupportApplicationSource("d".repeat(40), "e".repeat(40))
    private val product = SupportProductIdentity("0.1.2-alpha.1", 1, "dev")
    private val protocol = LinkProtocolObservation(1.0, 1.0, 0.0, LinkObservedRuntimeClass.FULL, false,
        LinkCapabilities(LinkSessionCapabilities(true, true, true, true, true), LinkWorkspaceCapabilities(true), LinkInteractionCapabilities(false, true)))
    private val link = LinkDiagnosticSnapshot(LinkRequestSnapshot(false, 2, 5, 3), LinkDeviceRole.CONTROLLER,
        LinkDescriptionState.AVAILABLE, null, protocol)
    private val snapshot = SupportLocalSnapshot(true, link, ConnectionSnapshots.unavailable, SessionDiagnostics.Unavailable, ProcessExitDiagnostics.Unavailable, applicationSource)
    private val policy = SupportExportPolicy(1024 * 1024, 10_000)

    @Test fun projectsLocalFactsWithoutClaimingHealthOrAuthorization() {
        val bytes = encodeSupportDocument(product, snapshot, identity, policy.maximumBytes)
        val expected = requireNotNull(javaClass.getResourceAsStream("/support-export.json")).use { it.readBytes() }
        assertContentEquals(expected, bytes)
        val value = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
        assertEquals("false", value["complete"].toString())
        assertEquals(applicationSource.toJson(), value["applicationSource"])
        assertEquals("2", value["transport"]!!.jsonObject["pendingRequests"].toString())
        assertEquals("true", value["localIdentity"]!!.jsonObject["restored"].toString())
        assertFalse(value["uncollected"].toString().contains("role"))
        assertEquals("\"last-known\"", value["role"]!!.jsonObject["observation"].toString())
        assertEquals("\"last-known\"", value["protocol"]!!.jsonObject["observation"].toString())
        assertFalse(bytes.decodeToString().contains("hostId"))
        assertTrue(bytes.last() == 10.toByte())
        val absent = Json.parseToJsonElement(encodeSupportDocument(product, SupportLocalSnapshot(false, null, ConnectionSnapshots.unavailable, SessionDiagnostics.Unavailable, ProcessExitDiagnostics.Unavailable, null), identity, policy.maximumBytes).decodeToString()).jsonObject
        assertEquals("\"unavailable\"", absent["transport"]!!.jsonObject["observation"].toString())
        assertEquals("\"unavailable\"", absent["role"]!!.jsonObject["observation"].toString())
        assertEquals("\"unavailable\"", absent["capabilities"]!!.jsonObject["observation"].toString())
        assertEquals(SessionDiagnostics.Unavailable.toJson(), absent["session"])
        assertTrue(absent["uncollected"].toString().contains("session-diagnostics"))
        assertTrue(absent["uncollected"].toString().contains("application-source"))
        assertFalse(absent.containsKey("applicationSource"))
    }

    @Test fun failedDescriptionDoesNotRetainCapabilityOrProtocolValues() {
        val unavailable = snapshot.copy(link = link.copy(descriptionState = LinkDescriptionState.FAILED,
            descriptionFailure = LinkDescriptionFailure.REFUSED, description = null))
        val value = Json.parseToJsonElement(encodeSupportDocument(product, unavailable, identity, policy.maximumBytes).decodeToString()).jsonObject
        assertEquals("\"failed\"", value["protocol"]!!.jsonObject["observation"].toString())
        assertEquals("\"refused\"", value["protocol"]!!.jsonObject["failure"].toString())
        assertFalse(value["protocol"]!!.jsonObject.containsKey("linkProtocolVersion"))
        assertFalse(value["capabilities"]!!.jsonObject.containsKey("session"))
        assertEquals("\"last-known\"", value["role"]!!.jsonObject["observation"].toString())
    }

    @Test fun rejectsInvalidProductMetadataAndScannerIdentity() {
        for (version in listOf("01.2.3", "1.2", "1.2.3\nsecret", "1.2.3-01", "1.2.3+private", "1.2.3-")) {
            assertEquals(SupportExportFailure.INVALID_IDENTITY,
                assertFailsWith<SupportExportException> { SupportProductIdentity(version, 1, "dev") }.failure)
        }
        for (channel in listOf("stable", "other")) {
            assertFailsWith<SupportExportException> { SupportProductIdentity("1.2.3-alpha", 1, channel) }
        }
        assertFailsWith<SupportExportException> { SupportProductIdentity("1.2.3", 1, "beta") }
        assertFailsWith<SupportExportException> { SupportExportPolicy(0, 1) }
        assertFailsWith<SupportExportException> { encodeSupportDocument(product, snapshot, identity.copy(sourceSha = "payload"), policy.maximumBytes) }
    }

    private fun scanner(result: (ByteArray) -> SupportScanResult, cancel: () -> Unit = {}): SupportDocumentScanner =
        object : SupportDocumentScanner {
            override fun identity() = this@SupportExportTest.identity
            override fun open(document: ByteArray, policy: SupportExportPolicy): SupportScanOperation {
                val copy = document.copyOf()
                return object : SupportScanOperation {
                    override fun run() = result(copy)
                    override fun cancelAndJoin() = cancel()
                }
            }
        }

    @Test fun admitsOnlyExactBytesAndReturnsIndependentCopies() = runBlocking {
        var joined = false
        val exporter = SupportDocumentExporter(scanner({ SupportScanResult("approved", it, supportSha256(it)) }, { joined = true }), policy)
        val document = exporter.prepare(product, snapshot)
        assertTrue(joined)
        val expected = encodeSupportDocument(product, snapshot, identity, policy.maximumBytes)
        val copy = document.copyBytes(); copy[0] = 0
        assertContentEquals(expected, document.copyBytes())
        assertEquals(supportSha256(expected), document.digest)
    }

    @Test fun exportRetainsCapturedModelObservationsWithoutStartingSubscriptions() = runTest {
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, ai.deepseek.dsh.link.WireValue>): ai.deepseek.dsh.link.WireValue =
                error("export must not send requests")
            override fun stream(endpoint: String, payload: Map<String, ai.deepseek.dsh.link.WireValue>): kotlinx.coroutines.flow.Flow<ai.deepseek.dsh.link.WireValue> =
                error("export must not subscribe")
        }
        val session = SessionModel(wire, backgroundScope)
        val interactions = InteractionModel(wire, backgroundScope)
        val files = FilesModel(wire, backgroundScope)
        val pushes = PushModel(wire, backgroundScope)
        val exits = ProcessExitHistory(product, applicationSource.sourceSha, 32, object : ProcessExitAccess {
            override fun register(summary: ByteArray) {}
            override fun read(maximumRecords: Int): List<ProcessExitRecord> = emptyList()
        }).capture()
        val captured = snapshot.copy(identityRestored = false, link = null, connections = ConnectionSnapshots(session.connectionSnapshot,
            interactions.connectionSnapshot, files.connectionSnapshot, pushes.connectionSnapshot), session = session.sessionDiagnostics, nativeExits = exits)
        session.closeAndAwait(); interactions.stopWatchingAndAwait(); files.stopAndAwait(); pushes.stopWatchingAndAwait()
        assertEquals(ConnectionState.STOPPED, session.connectionSnapshot.state)
        val exporter = SupportDocumentExporter(scanner({ SupportScanResult("approved", it, supportSha256(it)) }), policy)
        val bytes = exporter.prepare(product, captured).copyBytes()
        val expected = requireNotNull(javaClass.getResourceAsStream("/support-unpaired-app.json")).use { it.readBytes() }
        assertContentEquals(expected, bytes)
        val value = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
        val connections = value["connections"]!!.jsonObject
        val owners = mapOf("sessionFollow" to "SessionModel", "interactions" to "InteractionModel", "workspaces" to "FilesModel", "pushes" to "PushModel")
        assertEquals(owners.keys, connections.keys)
        for ((key, owner) in owners) {
            assertEquals(Json.parseToJsonElement("""{"producer":"$owner","observation":"current","activityScope":"model-lifetime","snapshot":{"state":"idle","attempts":0,"interruptions":0,"countsSaturated":false}}"""), connections[key])
        }
        assertFalse(value["uncollected"].toString().contains("connection"))
        assertEquals(SessionDiagnostics.Unselected.toJson(), value["session"])
        assertFalse(value["uncollected"].toString().contains("session-diagnostics"))
        assertFalse(value["uncollected"].toString().contains("native-crashes"))
        assertEquals("false", value["complete"].toString())
    }

    @Test fun nativeHistoryIsImmutableDuringScanningAndFailedCollectionStaysExplicit() = runBlocking {
        val exits = ProcessExitHistory(product, applicationSource.sourceSha, 32, object : ProcessExitAccess {
            override fun register(summary: ByteArray) {}
            override fun read(maximumRecords: Int) = listOf(ProcessExitRecord(
                ProcessExitBuildMarker(product, applicationSource.sourceSha).copyBytes(), ProcessExitReason.ANR))
        }).capture()
        val exporter = SupportDocumentExporter(scanner({ SupportScanResult("approved", it, supportSha256(it)) }), policy)
        val captured = snapshot.copy(nativeExits = exits)
        val admitted = Json.parseToJsonElement(exporter.prepare(product, captured).copyBytes().decodeToString()).jsonObject
        assertEquals(exits.toJson(), admitted["nativeExits"])
        assertFalse(admitted["uncollected"].toString().contains("native-crashes"))
        val failed = captured.copy(nativeExits = ProcessExitDiagnostics.Failed(ExitMarkerRegistration.REGISTERED, ExitHistoryFailure.QUERY_FAILED))
        val document = Json.parseToJsonElement(exporter.prepare(product, failed).copyBytes().decodeToString()).jsonObject
        assertEquals(failed.nativeExits.toJson(), document["nativeExits"])
        assertTrue(document["uncollected"].toString().contains("native-crashes"))
        assertEquals(exits.toJson(), admitted["nativeExits"])
    }

    @Test fun refusesFindingsUnknownResultsAndMismatchedAdmissionBytes() = runBlocking {
        for (status in listOf("secrets-detected", "timed-out", "cancelled", "already-run", "unexpected")) {
            val exporter = SupportDocumentExporter(scanner({ SupportScanResult(status, it, supportSha256(it)) }), policy)
            assertFailsWith<SupportExportException> { exporter.prepare(product, snapshot) }
        }
        for (changed in listOf(false, true)) {
            val exporter = SupportDocumentExporter(scanner({ SupportScanResult("approved", if (changed) byteArrayOf(0) else it, "d".repeat(64)) }), policy)
            assertEquals(SupportExportFailure.INVALID_SCANNER, assertFailsWith<SupportExportException> { exporter.prepare(product, snapshot) }.failure)
        }
        val exporter = SupportDocumentExporter(scanner({ error("must not scan oversized input") }), SupportExportPolicy(1, 10_000))
        assertEquals(SupportExportFailure.OVERSIZED, assertFailsWith<SupportExportException> { exporter.prepare(product, snapshot) }.failure)
    }

    @Test fun cancellationWaitsForNativeCompletionAndCannotDeliverBytes() = runBlocking {
        val started = CountDownLatch(1); val cancelling = CountDownLatch(1); val release = CountDownLatch(1); val stopped = CountDownLatch(1)
        val adapter = scanner({ input ->
            started.countDown()
            try { check(release.await(10, TimeUnit.SECONDS)) } finally { stopped.countDown() }
            SupportScanResult("approved", input, supportSha256(input))
        }, {
            cancelling.countDown()
            check(stopped.await(10, TimeUnit.SECONDS))
        })
        val result = async { SupportDocumentExporter(adapter, policy).prepare(product, snapshot) }
        try {
            assertTrue(withContext(Dispatchers.IO) { started.await(5, TimeUnit.SECONDS) })
            result.cancel()
            assertTrue(withContext(Dispatchers.IO) { cancelling.await(5, TimeUnit.SECONDS) })
            assertFalse(result.isCompleted)
        } finally {
            release.countDown()
            result.cancelAndJoin()
        }
        assertEquals(0L, stopped.count)
        assertTrue(result.isCancelled)
    }
}
