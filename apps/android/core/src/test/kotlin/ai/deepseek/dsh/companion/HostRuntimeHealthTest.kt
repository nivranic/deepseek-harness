package ai.deepseek.dsh.companion

import ai.deepseek.dsh.gateway.NativeObservedCapability
import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class HostRuntimeHealthTest {
    private fun component(state: String, detail: String) = WireValue.ObjectValue(mapOf(
        "state" to WireValue.StringValue(state), "detail" to WireValue.StringValue(detail)))

    private fun healthValue(ready: WireValue = WireValue.BoolValue(true)) = WireValue.ObjectValue(mapOf(
        "ready" to ready,
        "process" to component("up", "pid 4242"),
        "runtime" to component("up", "node v22.19.0"),
        "sessionStore" to component("down", "sessionPersistence is not composed"),
        "pluginState" to component("degraded", "1 plugin fiber(s) failed"),
        "connection" to component("down", "webServer is not composed"),
        "modelProvider" to component("up", "llm is composed"),
    ))

    @Test fun `parses the complete vocabulary verbatim`() {
        val health = HostRuntimeHealth.parse(healthValue(ready = WireValue.BoolValue(false)))
        assertEquals(false, health.ready)
        assertEquals(HostHealthState.UP, health.process.state); assertEquals("pid 4242", health.process.detail)
        assertEquals(HostHealthState.UP, health.runtime.state)
        assertEquals(HostHealthState.DOWN, health.sessionStore.state)
        assertEquals(HostHealthState.DEGRADED, health.pluginState.state)
        assertEquals(HostHealthState.DOWN, health.connection.state)
        assertEquals(HostHealthState.UP, health.modelProvider.state)
    }

    @Test fun `rejects any deviating snapshot whole`() {
        val deviations = listOf(
            WireValue.ObjectValue(healthValue().entries - "sessionStore"),
            WireValue.ObjectValue(healthValue().entries - "ready"),
            healthValue(ready = WireValue.StringValue("true")),
            WireValue.ObjectValue(healthValue().entries + ("process" to component("paused", "pid 4242"))),
            WireValue.ObjectValue(healthValue().entries +
                ("runtime" to WireValue.ObjectValue(mapOf("state" to WireValue.StringValue("up"), "detail" to WireValue.BoolValue(true))))),
        )
        for (deviation in deviations) {
            assertFailsWith<IllegalArgumentException> { HostRuntimeHealth.parse(deviation) }
        }
        assertFailsWith<IllegalArgumentException> { HostRuntimeHealth.parse(WireValue.BoolValue(true)) }
    }

    @Test fun `fetch calls the health endpoint with empty args`() = runTest {
        var method: String? = null
        var args: Map<String, WireValue>? = null
        val wire = object : WireDriving {
            override suspend fun call(callMethod: String, callArgs: Map<String, WireValue>): WireValue {
                method = callMethod; args = callArgs; return healthValue()
            }
            override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> =
                error("health fetch never subscribes")
        }
        val health = wire.fetchHostRuntimeHealth()
        assertEquals("hostDiagnostics/health", method)
        assertEquals(emptyMap(), args)
        assertEquals(HostHealthState.DEGRADED, health?.pluginState?.state)
    }

    @Test fun `unpaired unadvertised or bad-shape answers collect to null`() = runTest {
        val refused = LinkClientException.Refused("host/capability-unavailable",
            "Host does not advertise the required capability",
            WireValue.ObjectValue(mapOf("capability" to WireValue.StringValue("host.diagnostics.v1"))))
        val wires = listOf(
            object : WireDriving {
                override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = error("not paired")
                override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> =
                    error("health fetch never subscribes")
            },
            object : WireDriving {
                override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = throw refused
                override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> =
                    error("health fetch never subscribes")
            },
            object : WireDriving {
                override suspend fun call(method: String, args: Map<String, WireValue>): WireValue = WireValue.StringValue("up")
                override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> =
                    error("health fetch never subscribes")
            },
        )
        for (wire in wires) {
            assertNull(wire.fetchHostRuntimeHealth())
        }
    }

    @Test fun `a slow host answer times out to null`() = runTest {
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
                delay(3_000); return healthValue()
            }
            override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> =
                error("health fetch never subscribes")
        }
        assertNull(wire.fetchHostRuntimeHealth(timeoutMillis = 2_000))
    }

    @Test fun `caller cancellation propagates through the fetch`() = runTest {
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue =
                throw CancellationException("caller cancelled")
            override fun stream(endpoint: String, payload: Map<String, WireValue>): kotlinx.coroutines.flow.Flow<WireValue> =
                error("health fetch never subscribes")
        }
        assertFailsWith<CancellationException> { wire.fetchHostRuntimeHealth() }
    }

    @Test fun `the health endpoint resolves to the advertised host-diagnostics capability`() {
        assertEquals(NativeObservedCapability.HOST_DIAGNOSTICS, NativeObservedCapability.forEndpoint("hostDiagnostics/health"))
        assertEquals("host.diagnostics.v1", NativeObservedCapability.HOST_DIAGNOSTICS.wire)
    }
}
