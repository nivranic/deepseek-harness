package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.link.*
import kotlinx.serialization.json.*
import java.security.KeyPairGenerator
import java.util.Base64
import kotlin.test.*

class NativeGatewayProtocolTest {
    private val keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val credentials = LinkCredentials("device", "host", "Host", "viewer", "https://localhost:443",
        "a".repeat(64), Base64.getEncoder().encodeToString(keys.private.encoded.takeLast(32).toByteArray()),
        NativeGatewayProtocol.credentialFormat)
    private val config = NativeGatewayConfig(LinkTransportConfig(1000, 1000, 1000, 2000, 0, 0), 8)

    private fun pairing(changes: Map<String, JsonElement> = emptyMap()): String = JsonObject(mapOf(
        "kind" to JsonPrimitive("dsh-native-pairing"), "version" to JsonPrimitive(1),
        "endpoint" to JsonPrimitive("https://localhost:443"), "hostId" to JsonPrimitive("host"),
        "displayName" to JsonPrimitive("Host"), "spkiFingerprint" to JsonPrimitive("a".repeat(64)),
        "code" to JsonPrimitive("synthetic-code"), "expiresAt" to JsonPrimitive(2000), "role" to JsonPrimitive("viewer"),
    ) + changes).toString()

    @Test fun `accepts the operator payload and all current roles`() {
        for (role in NativePairing.roles) {
            val parsed = NativePairing.parse(pairing(mapOf("role" to JsonPrimitive(role))), 1000)
            assertEquals(role, parsed.role)
            assertEquals("host", parsed.hostId)
            assertFalse(parsed.toString().contains("synthetic-code"))
        }
    }

    @Test fun `rejects expired legacy and malformed pairing before network`() {
        for (changes in listOf(
            mapOf("kind" to JsonPrimitive("dsh-link-pairing")), mapOf("version" to JsonPrimitive("1")),
            mapOf("version" to JsonPrimitive(2)), mapOf("expiresAt" to JsonPrimitive(1000)),
            mapOf("expiresAt" to JsonPrimitive(1000.5)), mapOf("hostId" to JsonPrimitive("")),
            mapOf("role" to JsonPrimitive("administrator")), mapOf("spkiFingerprint" to JsonPrimitive("A".repeat(64))),
            mapOf("code" to JsonNull), mapOf("endpoint" to JsonArray(emptyList())),
        )) assertFailsWith<LinkClientException.BadWire> { NativePairing.parse(pairing(changes), 1000) }
        for (text in listOf("[1]", "{", "null")) assertFailsWith<LinkClientException.BadWire> { NativePairing.parse(text) }
    }

    @Test fun `rejects unsafe endpoints and keeps explicit port and IPv6`() {
        for (endpoint in listOf("http://host", "https://user:secret@host", "https://host/path", "https://host?q=1",
            "https://host#part", "https://0.0.0.0", "https://[::]", "https://host:0", "https://host:65536", "https://")) {
            assertFailsWith<LinkClientException.BadWire> { nativeOrigin(endpoint) }
        }
        assertEquals("https://[::1]:8443", nativeOrigin("https://[::1]:8443/"))
    }

    @Test fun `signs each dispatch and places events proof inside reserved args only`() {
        val nonces = mutableSetOf<String>()
        for (endpoint in listOf("session/list", "session/follow", "\$events", "\$events/result", "host/negotiate")) {
            val payload = NativeGatewayProtocol.payload(endpoint, emptyMap(), credentials)
            assertEquals(2, payload["apiProtocolVersion"]!!.jsonPrimitive.int)
            val event = endpoint == "\$events"
            val admission = (if (event) payload["args"]!!.jsonObject["device"] else payload["device"])!!.jsonObject
            assertEquals(!event, payload.containsKey("device"))
            assertEquals(event, payload["args"]!!.jsonObject.containsKey("device"))
            val input = "${admission.text("deviceId")}\n${admission.integer("timestamp")}\n${admission.text("nonce")}"
            assertTrue(LinkSigning.verify(input, admission.text("signature"), keys.public.encoded))
            assertTrue(nonces.add(admission.text("nonce")))
        }
    }

    @Test fun `only pairing redemption can omit a device`() {
        assertFalse(NativeGatewayProtocol.payload("deviceTrust/redeemPairing", emptyMap(), null).containsKey("device"))
        assertFailsWith<LinkClientException.Unpaired> { NativeGatewayProtocol.payload("host/negotiate", emptyMap(), null) }
    }

    @Test fun `preserves structured RPC and mux failures`() {
        val error = """{"code":"gateway/permission-denied","message":"denied","details":{"requiredPermission":"device.admin"}}"""
        val rpc = assertFailsWith<LinkClientException.Refused> {
            NativeGatewayProtocol.response("""{"type":"server-response","rpcId":"r","result":{"ok":false,"error":$error}}""", "r")
        }
        val mux = NativeGatewayProtocol.frame("""{"type":"error","streamId":"s","error":$error}""") as NativeStreamFrame.Failure
        assertEquals(rpc.code, mux.error.code)
        assertEquals(rpc.details, mux.error.details)
        assertEquals(rpc.envelopeMessage, mux.error.envelopeMessage)
    }

    @Test fun `rejects malformed mux frames and mismatched RPC correlation`() {
        for (text in listOf("{}", "[]", """{"type":"end","streamId":"s","value":1}""",
            """{"type":"item","streamId":""}""", """{"type":"error","streamId":"s","error":{"code":"x","message":"x","details":[]}}""")) {
            assertFailsWith<LinkClientException.BadWire> { NativeGatewayProtocol.frame(text) }
        }
        assertFailsWith<LinkClientException.BadWire> {
            NativeGatewayProtocol.response("""{"type":"server-response","rpcId":"other","result":{"ok":true,"value":1}}""", "expected")
        }
        assertIs<NativeStreamFrame.End>(NativeGatewayProtocol.frame("""{"type":"end","streamId":"s"}"""))
        assertEquals(WireValue.NullValue, (NativeGatewayProtocol.frame("""{"type":"item","streamId":"s"}""") as NativeStreamFrame.Item).value)
    }

    @Test fun `Host Session writer version does not become client protocol version`() {
        val value = WireValue.fromJsonElement(Json.parseToJsonElement("""{"hostId":"host","displayName":"Host","productVersion":"future","apiProtocolVersion":2,"runtimeMode":"full","sessionFormatVersion":999,"capabilities":["session.list.v1"]}"""))
        assertEquals(999, NativeHostDescription.parse(value, "host").sessionFormatVersion)
        assertFailsWith<LinkClientException.BadWire> { NativeHostDescription.parse(value, "another-host") }
    }

    @Test fun `legacy credentials require re-pair without being deleted`() {
        val store = MemoryLinkCredentialsStore()
        store.save(credentials.copy(transportFormat = null))
        assertNull(NativeGatewayClient.restore(store, config))
        assertNotNull(store.load())
    }

    @Test fun `rejects incompatible negotiation and malformed advertised capabilities`() {
        val base = Json.parseToJsonElement("""{"hostId":"host","displayName":"Host","productVersion":"future","apiProtocolVersion":2,"runtimeMode":"full","sessionFormatVersion":3,"capabilities":[]}""").jsonObject
        for (changed in listOf(mapOf("apiProtocolVersion" to JsonPrimitive(1)), mapOf("runtimeMode" to JsonPrimitive("lite")),
            mapOf("capabilities" to JsonArray(listOf(JsonPrimitive("x"), JsonPrimitive("x")))),
            mapOf("capabilities" to JsonArray(listOf(JsonPrimitive(12)))))) {
            assertFailsWith<LinkClientException.BadWire> {
                NativeHostDescription.parse(WireValue.fromJsonElement(JsonObject(base + changed)), "host")
            }
        }
    }

    @Test fun `rejects corrupt current credentials before creating transport`() {
        for (value in listOf(credentials.copy(signingKeyBase64 = "eA=="), credentials.copy(pinnedFingerprint = "invalid"),
            credentials.copy(role = "administrator"), credentials.copy(endpoint = "http://localhost"))) {
            val store = MemoryLinkCredentialsStore()
            store.save(value)
            assertFailsWith<LinkClientException.BadWire> { NativeGatewayClient.restore(store, config) }
            assertEquals(value, store.load())
        }
    }

    @Test fun `native credential format survives encrypted store roundtrip`() {
        val file = kotlin.io.path.createTempFile().toFile()
        val cipher = object : CredentialsCipher {
            override fun seal(plain: ByteArray) = plain.map { (it.toInt() xor 0x55).toByte() }.toByteArray()
            override fun open(sealed: ByteArray) = seal(sealed)
        }
        try {
            val store = FileLinkCredentialsStore(file, cipher)
            store.save(credentials)
            assertFalse(file.readText().contains(credentials.signingKeyBase64))
            assertEquals(credentials, store.load())
            val client = NativeGatewayClient.restore(store, config)!!
            kotlinx.coroutines.runBlocking { client.closeAndAwait() }
        } finally { file.delete() }
    }
}
