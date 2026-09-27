package ai.deepseek.dsh.gateway

import ai.deepseek.dsh.companion.WireDriving
import ai.deepseek.dsh.companion.WireDiagnosticSnapshot
import ai.deepseek.dsh.companion.ConnectionFailure
import ai.deepseek.dsh.link.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.ByteString
import java.io.IOException
import java.security.KeyPairGenerator
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Bounded mux buffering; timeouts remain deployment-owned. */
data class NativeGatewayConfig(val transport: LinkTransportConfig, val bufferedFramesPerStream: Int) {
    init { require(bufferedFramesPerStream > 0) }
}

/** Pinned HTTPS Connection RPC and one shared Gateway WebSocket per client generation.
 * No cookies, redirects, or historical Link routes participate in authorization.
 * A slow stream fails explicitly when its bounded buffer fills; values are never silently dropped.
 * Closing retires all work; [closeAndAwait] also waits for transport callbacks to settle.
 */
class NativeGatewayClient private constructor(
    private val endpoint: String,
    pin: String,
    private val config: NativeGatewayConfig,
    initialIdentity: LinkCredentials?,
) : WireDriving {
    private val lock = Any()
    private var closed = false
    private var identity: LinkCredentials? = initialIdentity
    private val negotiation = Mutex()
    @Volatile private var observedHost: NativeHostDescription? = null
    private var descriptionState = NativeDescriptionState.NOT_REQUESTED
    private var descriptionFailure: ConnectionFailure? = null
    private var protocolObservation: NativeProtocolObservation? = null
    private var startedHttpCalls = 0L
    private var finishedHttpCalls = 0L
    private val trust = LinkPinning.trustManager(pin)
    private val transport = OkHttpClient.Builder()
        .sslSocketFactory(LinkPinning.sslContext(trust).socketFactory, trust)
        .hostnameVerifier(LinkPinning.hostnameVerifier(pin))
        .followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .connectionSpecs(listOf(ConnectionSpec.MODERN_TLS))
        .connectTimeout(config.transport.connectTimeoutMillis, TimeUnit.MILLISECONDS)
        .writeTimeout(config.transport.writeTimeoutMillis, TimeUnit.MILLISECONDS)
        .readTimeout(config.transport.unaryReadTimeoutMillis, TimeUnit.MILLISECONDS)
        .callTimeout(config.transport.unaryCallTimeoutMillis, TimeUnit.MILLISECONDS)
        .build()
    private val streamTransport = transport.newBuilder()
        .readTimeout(config.transport.streamReadTimeoutMillis, TimeUnit.MILLISECONDS)
        .callTimeout(config.transport.streamCallTimeoutMillis, TimeUnit.MILLISECONDS).build()
    private val calls = mutableMapOf<Call, CompletableDeferred<Unit>>()
    private data class Subscription(val endpoint: String, val args: Map<String, WireValue>, val frames: Channel<WireValue>)
    private class Mux {
        lateinit var socket: WebSocket
        var ready = false
        val settled = CompletableDeferred<Unit>()
        val streams = mutableMapOf<String, Subscription>()
    }
    private var mux: Mux? = null
    private val retiringMuxes = mutableSetOf<Mux>()

    /** Last successful negotiated observation; refresh never grants business permissions. */
    fun hostDescription(): NativeHostDescription? = observedHost

    override fun diagnosticSnapshot(): WireDiagnosticSnapshot.Native = synchronized(lock) {
        WireDiagnosticSnapshot.Native(NativeGatewayDiagnosticSnapshot(closed, calls.size,
            startedHttpCalls, finishedHttpCalls, mux?.streams?.size ?: 0, retiringMuxes.size,
            NativeObservedRole.from(identity?.role), descriptionState, descriptionFailure, protocolObservation))
    }

    override suspend fun refreshHostDescription() {
        try { describe() }
        catch (_: LinkClientException) {
            // Foreground observation failure leaves the last successful facts unchanged;
            // business operations still receive the Host's current signed-admission decision.
        }
    }

    /** Negotiate API 2 and check the pinned Host identity before exposing business operations. */
    suspend fun describe(): NativeHostDescription = negotiation.withLock {
        synchronized(lock) {
            requireOpen()
            descriptionState = NativeDescriptionState.CHECKING
            descriptionFailure = null
        }
        try {
            val credentials = currentIdentity()
            val value = rpc("host/negotiate", mapOf("supportedApiProtocolVersions" to
                WireValue.ArrayValue(listOf(WireValue.NumberValue(2.0)))))
            NativeHostDescription.parse(value, credentials.hostId).also { description ->
                synchronized(lock) {
                    requireOpen()
                    observedHost = description
                    protocolObservation = NativeProtocolObservation(description.sessionFormatVersion,
                        NativeObservedCapability.entries.filter { it.wire in description.capabilities }.toSet())
                    descriptionState = NativeDescriptionState.AVAILABLE
                }
            }
        } catch (failure: Exception) {
            synchronized(lock) {
                if (!closed) {
                    descriptionState = if (failure is CancellationException) NativeDescriptionState.CANCELLED else NativeDescriptionState.FAILED
                    descriptionFailure = ConnectionFailure.from(failure)
                }
            }
            throw failure
        }
    }

    private suspend fun ensureNegotiated() {
        if (observedHost == null) describe()
    }

    override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
        ensureNegotiated()
        return rpc(method, args)
    }

    override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow {
        ensureNegotiated()
        val id = UUID.randomUUID().toString()
        val subscription = Subscription(endpoint, payload.toMap(), Channel(config.bufferedFramesPerStream))
        val owner = synchronized(lock) {
            requireOpen()
            val current = mux ?: newMux().also { mux = it }
            current.streams[id] = subscription
            if (current.ready) sendOpen(current, id, subscription)
            current
        }
        try {
            for (value in subscription.frames) emit(value)
        } finally {
            synchronized(lock) {
                if (owner.streams.remove(id) != null && owner.ready) owner.socket.send(NativeGatewayProtocol.cancel(id))
                subscription.frames.cancel()
            }
        }
    }

    private fun newMux(): Mux {
        val owner = Mux()
        val request = Request.Builder().url(endpoint + "/api/remote.mux").build()
        owner.socket = streamTransport.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = synchronized(lock) {
                if (closed || mux !== owner) { webSocket.cancel(); return@synchronized }
                owner.ready = true
                owner.streams.toList().forEach { (id, subscription) -> sendOpen(owner, id, subscription) }
            }

            override fun onMessage(webSocket: WebSocket, text: String) = synchronized(lock) {
                if (mux !== owner || closed) return@synchronized
                try {
                    val frame = NativeGatewayProtocol.frame(text)
                    val subscription = owner.streams[frame.id] ?: return@synchronized
                    when (frame) {
                        is NativeStreamFrame.Item -> if (!subscription.frames.trySend(frame.value).isSuccess) {
                            owner.streams.remove(frame.id)
                            subscription.frames.close(LinkClientException.Carrier(0, "native stream buffer exceeded"))
                            webSocket.send(NativeGatewayProtocol.cancel(frame.id))
                        }
                        is NativeStreamFrame.End -> { owner.streams.remove(frame.id); subscription.frames.close() }
                        is NativeStreamFrame.Failure -> { owner.streams.remove(frame.id); subscription.frames.close(frame.error) }
                    }
                } catch (failure: Exception) { retireMux(owner, failure) }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) = synchronized(lock) {
                if (mux === owner) retireMux(owner, LinkClientException.BadWire("binary mux frame"))
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, null) }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = settled(owner,
                LinkClientException.Carrier(0, "native mux closed"))

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = settled(owner,
                LinkClientException.Carrier(response?.code ?: 0, "native mux interrupted").apply { initCause(t) })
        })
        return owner
    }

    /** Called under the lifecycle lock; proofs are fresh even when the socket opened slowly. */
    private fun sendOpen(owner: Mux, id: String, subscription: Subscription) {
        try {
            if (!owner.socket.send(NativeGatewayProtocol.open(id, subscription.endpoint, subscription.args, currentIdentity()))) {
                retireMux(owner, LinkClientException.Carrier(0, "native mux send refused"))
            }
        } catch (failure: Exception) { retireMux(owner, failure) }
    }

    private fun retireMux(owner: Mux, failure: Throwable) {
        if (mux === owner) mux = null
        owner.streams.values.forEach { it.frames.close(failure) }
        owner.streams.clear()
        retiringMuxes.add(owner)
        owner.socket.cancel()
    }

    private fun settled(owner: Mux, failure: Throwable) = synchronized(lock) {
        if (mux === owner) mux = null
        owner.streams.values.forEach { it.frames.close(failure) }
        owner.streams.clear()
        retiringMuxes.remove(owner)
        owner.settled.complete(Unit)
        Unit
    }

    private suspend fun rpc(method: String, args: Map<String, WireValue>): WireValue {
        require(method.matches(Regex("[A-Za-z$][A-Za-z0-9$-]*/[A-Za-z][A-Za-z0-9-]*"))) { "invalid Remote method" }
        val id = UUID.randomUUID().toString()
        val body = synchronized(lock) { requireOpen(); NativeGatewayProtocol.request(id, method, args, identity) }
        val request = Request.Builder().url(endpoint + "/api/" + method)
            // Signed mutations cannot be replayed after an ambiguous idle-socket failure.
            // End each HTTP connection; the separately owned mux stays persistent.
            .header("Connection", "close")
            .post(body.toRequestBody("application/json".toMediaType())).build()
        val bytes = execute(request)
        return NativeGatewayProtocol.response(bytes, id)
    }

    private suspend fun execute(request: Request): String = suspendCancellableCoroutine { continuation ->
        val call = synchronized(lock) {
            requireOpen()
            transport.newCall(request).also {
                calls[it] = CompletableDeferred()
                if (startedHttpCalls != Long.MAX_VALUE) startedHttpCalls++
            }
        }
        continuation.invokeOnCancellation { call.cancel() }
        fun finish(result: Result<String>) {
            try { if (continuation.isActive) continuation.resumeWith(result) }
            finally {
                synchronized(lock) {
                    calls.remove(call)?.let {
                        if (finishedHttpCalls != Long.MAX_VALUE) finishedHttpCalls++
                        it.complete(Unit)
                    }
                }
            }
        }
        try {
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    finish(Result.failure(LinkClientException.Carrier(0, "native HTTPS request failed").apply { initCause(e) }))
                }
                override fun onResponse(call: Call, response: Response) {
                    val result = runCatching {
                        response.use {
                            if (!it.isSuccessful) throw LinkClientException.Carrier(it.code, "native HTTPS request refused")
                            it.body.string()
                        }
                    }.recoverCatching { error ->
                        if (error is IOException) throw LinkClientException.Carrier(0, "native HTTPS response interrupted").apply { initCause(error) }
                        throw error
                    }
                    finish(result)
                }
            })
        } catch (failure: Exception) { finish(Result.failure(failure)) }
    }

    private fun currentIdentity(): LinkCredentials = synchronized(lock) {
        requireOpen()
        identity ?: throw LinkClientException.Unpaired()
    }

    private fun requireOpen() { if (closed) throw LinkClientException.Carrier(0, "native client is closed") }

    override fun close() {
        synchronized(lock) {
            if (closed) return
            closed = true
            descriptionState = NativeDescriptionState.RETIRED
            observedHost = null
            calls.keys.forEach(Call::cancel)
            mux?.let { retireMux(it, LinkClientException.Carrier(0, "native client is closed")) }
            transport.connectionPool.evictAll()
            transport.dispatcher.executorService.shutdown()
        }
    }

    override suspend fun closeAndAwait() {
        close()
        withContext(NonCancellable) {
            val pending = synchronized(lock) { calls.values.toList() + retiringMuxes.map { it.settled } }
            pending.forEach { it.await() }
            withContext(Dispatchers.IO) {
                transport.dispatcher.executorService.awaitTermination(Long.MAX_VALUE, TimeUnit.NANOSECONDS)
            }
        }
    }

    companion object {
        /** Restore only explicitly marked native credentials. Legacy files remain untouched. */
        fun restore(store: LinkCredentialsStoring, config: NativeGatewayConfig): NativeGatewayClient? {
            val credentials = store.load() ?: return null
            if (credentials.transportFormat != NativeGatewayProtocol.credentialFormat) return null
            if (credentials.role !in NativePairing.roles || credentials.signingKeyRaw?.size != 32 ||
                !Regex("[a-f0-9]{64}").matches(credentials.pinnedFingerprint) || credentials.deviceId.isBlank() || credentials.hostId.isBlank()) {
                badNativeWire("invalid native credentials; pair again")
            }
            return NativeGatewayClient(nativeOrigin(credentials.endpoint), credentials.pinnedFingerprint, config, credentials)
        }

        /** Redeem once, verify the returned key/role and negotiated Host, then persist the sealed identity.
         * Rejected acknowledgements leave the previous local identity unchanged; an issued Host grant may require operator revocation.
         */
        suspend fun pair(payload: NativePairing, deviceName: String, store: LinkCredentialsStoring,
                         config: NativeGatewayConfig): NativeGatewayClient {
            require(deviceName.isNotBlank()) { "device name is required" }
            if (payload.expiresAt <= System.currentTimeMillis()) badNativeWire("pairing has expired")
            val client = NativeGatewayClient(payload.endpoint, payload.spkiFingerprint, config, null)
            try {
                val keys = withContext(Dispatchers.IO) { KeyPairGenerator.getInstance("Ed25519").generateKeyPair() }
                val publicKey = keys.public.encoded
                val result = client.rpc("deviceTrust/redeemPairing", mapOf("request" to WireValue.ObjectValue(mapOf(
                    "code" to WireValue.StringValue(payload.code), "deviceName" to WireValue.StringValue(deviceName),
                    "devicePublicKey" to WireValue.StringValue(Base64.getEncoder().encodeToString(publicKey)),
                    "platform" to WireValue.StringValue("android"),
                )))).toJsonElement() as? JsonObject ?: badNativeWire("invalid pairing result")
                if (result.text("role") != payload.role || result.text("keyFingerprint") != LinkSigning.spkiFingerprint(publicKey)) {
                    badNativeWire("pairing acknowledgement differs from requested identity")
                }
                result.integer("pairedAt")
                val credentials = LinkCredentials(result.text("deviceId"), payload.hostId, payload.displayName,
                    payload.role, payload.endpoint, payload.spkiFingerprint,
                    Base64.getEncoder().encodeToString(keys.private.encoded.takeLast(32).toByteArray()), NativeGatewayProtocol.credentialFormat)
                synchronized(client.lock) { client.identity = credentials }
                client.describe()
                withContext(Dispatchers.IO) { store.save(credentials) }
                return client
            } catch (failure: Throwable) {
                client.closeAndAwait()
                throw failure
            }
        }
    }
}
