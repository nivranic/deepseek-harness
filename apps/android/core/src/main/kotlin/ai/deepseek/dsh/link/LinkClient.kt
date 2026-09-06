package ai.deepseek.dsh.link

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.EventListener
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.security.KeyPairGenerator
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Every way a link call can fail, mirroring the Swift `LinkClientError`. */
sealed class LinkClientException(message: String) : RuntimeException(message) {
    class Carrier(val status: Int, message: String) : LinkClientException("carrier $status: $message")

    class Unpaired : LinkClientException("no paired identity")

    class Refused(val code: String, message: String) : LinkClientException("refused $code: $message")

    class BadWire(message: String) : LinkClientException("bad wire: $message")
}

/**
 * Deployment-owned HTTP timeouts for the Link transport. Zero disables the
 * corresponding OkHttp timeout, which is required for idle long-lived streams.
 * @param connectTimeoutMillis TCP/TLS connection timeout.
 * @param writeTimeoutMillis request-body write timeout.
 * @param unaryReadTimeoutMillis response-read timeout for pair and unary calls.
 * @param unaryCallTimeoutMillis whole-call timeout for pair and unary calls.
 * @param streamReadTimeoutMillis idle response-read timeout for streams.
 * @param streamCallTimeoutMillis whole-call timeout for streams.
 */
data class LinkTransportConfig(
    val connectTimeoutMillis: Long,
    val writeTimeoutMillis: Long,
    val unaryReadTimeoutMillis: Long,
    val unaryCallTimeoutMillis: Long,
    val streamReadTimeoutMillis: Long,
    val streamCallTimeoutMillis: Long,
) {
    init {
        val values = listOf(
            connectTimeoutMillis,
            writeTimeoutMillis,
            unaryReadTimeoutMillis,
            unaryCallTimeoutMillis,
            streamReadTimeoutMillis,
            streamCallTimeoutMillis,
        )
        require(values.all { it >= 0 }) { "Link transport timeouts must be non-negative" }
    }
}

/** Transport-phase observation used by owner-level cancellation checks. */
internal interface LinkCallObserver {
    fun callStart(path: String) = Unit

    fun requestBodyStart(path: String)

    fun requestBodyEnd(path: String, byteCount: Long)

    fun callFailed(path: String, failure: IOException) = Unit
}

/**
 * The link-client state machine over one owned OkHttp transport — the Kotlin
 * mirror of the Swift `LinkClient`: pair once, then describe, call unary
 * endpoints through the shared `/api` chain, and open NDJSON Remote streams.
 * Every HTTPS call installs [LinkPinning] before sending its request body;
 * [close] cancels all created calls and retires the transport resources.
 */
class LinkClient private constructor(
    baseUrl: String,
    pinnedFingerprint: String,
    private val store: LinkCredentialsStoring,
    transportConfig: LinkTransportConfig,
    callObserver: LinkCallObserver?,
) : java.io.Closeable {
    constructor(
        baseUrl: String,
        pinnedFingerprint: String,
        store: LinkCredentialsStoring,
        transportConfig: LinkTransportConfig,
    ) : this(baseUrl, pinnedFingerprint, store, transportConfig, null)

    private val base: String = baseUrl.trimEnd('/')
    private val pinned: String = pinnedFingerprint
    private val trustManager = LinkPinning.trustManager(pinnedFingerprint)
    private val sslContext = LinkPinning.sslContext(trustManager)
    private val hostnameVerifier = LinkPinning.hostnameVerifier(pinnedFingerprint)
    private val transportClient = OkHttpClient.Builder()
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        .hostnameVerifier(hostnameVerifier)
        .connectTimeout(transportConfig.connectTimeoutMillis, TimeUnit.MILLISECONDS)
        .writeTimeout(transportConfig.writeTimeoutMillis, TimeUnit.MILLISECONDS)
        .apply {
            if (callObserver != null) {
                eventListener(
                    object : EventListener() {
                        override fun callStart(call: Call) {
                            callObserver.callStart(call.request().url.encodedPath)
                        }

                        override fun requestBodyStart(call: Call) {
                            callObserver.requestBodyStart(call.request().url.encodedPath)
                        }

                        override fun requestBodyEnd(call: Call, byteCount: Long) {
                            callObserver.requestBodyEnd(call.request().url.encodedPath, byteCount)
                        }

                        override fun callFailed(call: Call, ioe: IOException) {
                            callObserver.callFailed(call.request().url.encodedPath, ioe)
                        }
                    },
                )
            }
        }
        .build()
    private val unaryClient = transportClient.newBuilder()
        .readTimeout(transportConfig.unaryReadTimeoutMillis, TimeUnit.MILLISECONDS)
        .callTimeout(transportConfig.unaryCallTimeoutMillis, TimeUnit.MILLISECONDS)
        .build()
    private val streamClient = transportClient.newBuilder()
        .readTimeout(transportConfig.streamReadTimeoutMillis, TimeUnit.MILLISECONDS)
        .callTimeout(transportConfig.streamCallTimeoutMillis, TimeUnit.MILLISECONDS)
        .build()
    private val lifecycleLock = Any()
    private val activeCalls = mutableSetOf<TrackedCall>()
    private var closed = false
    private val transportRetired = AtomicBoolean(false)

    private class TrackedCall(
        val call: Call,
        private val retireCall: (Call) -> Unit,
    ) {
        val settled = CompletableDeferred<Unit>()
        private val retiring = AtomicBoolean(false)

        fun retire() {
            if (retiring.compareAndSet(false, true)) retireCall(call)
        }
    }

    private class LinkRetiredCancellation : CancellationException("Link client is closed")

    /** The persisted identity, or null before the first successful pairing. */
    val credentials: LinkCredentials? get() = store.load()

    /** The fingerprint this client was constructed to pin. */
    val pinnedFingerprint: String get() = pinned

    /**
     * Pair with a host by exchanging the one-time QR code for a durable
     * identity. The client generates a fresh Ed25519 key whose SPKI DER the
     * host stores, then validates required identity, role, and protocol fields
     * before the store persists credentials. Work runs off the caller's
     * dispatcher, and cancellation cancels the owned OkHttp call.
     */
    suspend fun pair(payload: LinkPairingPayload, deviceName: String): LinkCredentials = withContext(Dispatchers.IO) {
        if (payload.endpoint.trimEnd('/') != base || payload.spkiFingerprint != pinned) {
            throw LinkClientException.BadWire("pairing payload does not own this client transport")
        }
        val key = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val publicRaw = key.public.encoded.copyOfRange(key.public.encoded.size - 32, key.public.encoded.size)
        val body = Json.encodeToString(
            JsonElement.serializer(),
            kotlinx.serialization.json.buildJsonObject {
                put("code", payload.code)
                put("deviceName", deviceName)
                put("devicePublicKey", Base64.getEncoder().encodeToString(LinkSigning.ed25519SpkiDer(publicRaw)))
            },
        )
        val data = post("/link/pair", body.toByteArray(Charsets.UTF_8), signed = false)
        val document = runCatching { Json.parseToJsonElement(data.decodeToString()).jsonObject }
            .getOrElse { throw LinkClientException.BadWire("pair response is not a JSON object") }
        val value = document.pairResponse(expectedProtocolVersion = payload.v)
        val credentials = LinkCredentials(
            deviceId = value.deviceId,
            hostId = value.hostId,
            hostName = value.hostName,
            role = value.role.wire,
            endpoint = payload.endpoint,
            pinnedFingerprint = payload.spkiFingerprint,
            signingKeyBase64 = Base64.getEncoder().encodeToString(
                key.private.encoded.copyOfRange(key.private.encoded.size - 32, key.private.encoded.size),
            ),
        )
        store.save(credentials)
        credentials
    }

    /** Ask the authenticated host for its description without blocking the caller's dispatcher.
     * Cancellation cancels the owned OkHttp call. */
    suspend fun describe(): LinkHostDescription = withContext(Dispatchers.IO) {
        val data = post("/link/describe", ByteArray(0), signed = true)
        mapHostDescription(Json.parseToJsonElement(data.decodeToString()).jsonObject)
    }

    /**
     * Call one unary Remote endpoint through the shared `/api` chain;
     * throws [LinkClientException.Refused] when carrier authorization or the
     * business call refuses the operation.
     * Coroutine cancellation cancels the owned OkHttp call.
     */
    suspend fun call(method: String, args: Map<String, WireValue> = emptyMap()): WireValue =
        withContext(Dispatchers.IO) {
            val rpcId = "rpc-${UUID.randomUUID()}"
            val envelope = LinkRequestEnvelope(rpcId = rpcId, method = method, args = args)
            val body = Json.encodeToString(envelope.toJsonElement())
                .toByteArray(Charsets.UTF_8)
            val data = post("/api/$method", body, signed = true)
            val response = LinkResponseEnvelope.fromJsonElement(Json.parseToJsonElement(data.decodeToString()))
            if (response.type != "server-response") {
                throw LinkClientException.BadWire("unexpected response type ${response.type}")
            }
            if (response.rpcId != rpcId) throw LinkClientException.BadWire("rpcId mismatch")
            if (response.result.ok) {
                if (response.result.errorCode != null) {
                    throw LinkClientException.BadWire("successful result carried an error")
                }
                return@withContext response.result.value ?: WireValue.NullValue
            }
            if (response.result.value != null) {
                throw LinkClientException.BadWire("failed result carried a value")
            }
            if (response.result.errorCode != null) {
                throw LinkClientException.Refused(response.result.errorCode!!, response.result.errorMessage ?: "")
            }
            throw LinkClientException.BadWire("failed result lacked a structured error")
        }

    /**
     * Open one NDJSON Remote stream: value frames flow as they arrive; carrier
     * authorization or a failure frame completes the flow with
     * [LinkClientException.Refused].
     * Cancelling collection cancels the call and waits for the blocking owner
     * to close its response source before collection finishes.
     */
    fun stream(endpoint: String, payload: Map<String, WireValue> = emptyMap()): Flow<WireValue> = flow {
        val body = Json.encodeToString(
            JsonElement.serializer(),
            kotlinx.serialization.json.buildJsonObject {
                put("args", kotlinx.serialization.json.buildJsonObject {
                    payload.forEach { (key, value) -> put(key, value.toJsonElement()) }
                })
            },
        ).toByteArray(Charsets.UTF_8)
        val path = "/link/stream/$endpoint"
        val frames = Channel<WireValue>(Channel.RENDEZVOUS)
        val retirement = LinkRetiredCancellation()
        val tracked = trackedCall(streamClient, request(path, body, signed = true)) { call ->
            frames.cancel(retirement)
            call.cancel()
        }
        val call = tracked.call
        var blockingOwner: Job? = null

        suspend fun settle(owner: Job?) {
            call.cancel()
            withContext(NonCancellable) {
                owner?.cancelAndJoin()
            }
        }

        try {
            supervisorScope {
                val owner = async(Dispatchers.IO) {
                    try {
                        call.execute().use { response ->
                            if (!response.isSuccessful) {
                                checkStatus(response.code, response.body.bytes())
                            }
                            response.body.source().use { source ->
                                while (true) {
                                    val line = source.readUtf8Line() ?: break
                                    if (line.isBlank()) continue
                                    val frame = DecodedLinkStreamFrame.fromJsonElement(
                                        Json.parseToJsonElement(line),
                                    )
                                    if (frame.isFailure) {
                                        throw LinkClientException.Refused(
                                            frame.code ?: "internal",
                                            frame.message ?: "stream failed",
                                        )
                                    }
                                    frames.send(frame.value ?: WireValue.NullValue)
                                }
                            }
                        }
                    } catch (failure: CancellationException) {
                        frames.cancel(failure)
                        throw failure
                    } catch (failure: LinkClientException) {
                        frames.close(failure)
                        throw failure
                    } catch (failure: Exception) {
                        currentCoroutineContext().ensureActive()
                        val carrier = LinkClientException.Carrier(0, failure.message ?: failure.javaClass.simpleName)
                        frames.close(carrier)
                        throw carrier
                    } finally {
                        frames.close()
                    }
                }
                blockingOwner = owner
                try {
                    try {
                        for (frame in frames) emit(frame)
                        owner.await()
                    } catch (_: LinkRetiredCancellation) {
                        throw LinkClientException.Carrier(0, "Link client is closed")
                    }
                } finally {
                    settle(owner)
                }
            }
        } finally {
            try {
                if (blockingOwner == null) settle(null)
            } finally {
                frames.cancel()
                finishTrackedCall(tracked)
            }
        }
    }

    /** Forget the paired identity; the host refuses the next request. */
    fun unpair() = store.clear()

    /** Request cancellation of every owned call and retire this client's
     * dispatcher and connections. Use [closeAndAwait] when subsequent work
     * must observe completed callbacks and stream collectors. */
    override fun close() {
        requestClose()
    }

    /** Retire the transport and wait for callbacks, stream collectors, and
     * the shared OkHttp dispatcher to reach quiescence. */
    suspend fun closeAndAwait() {
        val calls = requestClose()
        withContext(NonCancellable) {
            calls.forEach { tracked -> tracked.settled.await() }
            withContext(Dispatchers.IO) {
                transportClient.dispatcher.executorService.awaitTermination(Long.MAX_VALUE, TimeUnit.NANOSECONDS)
            }
        }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()

        internal fun observed(
            baseUrl: String,
            pinnedFingerprint: String,
            store: LinkCredentialsStoring,
            transportConfig: LinkTransportConfig,
            callObserver: LinkCallObserver,
        ): LinkClient = LinkClient(baseUrl, pinnedFingerprint, store, transportConfig, callObserver)

        /** Rebuild the paired client from persisted credentials — the
         * relaunch path that skips pairing and pins the stored fingerprint
         * again. Null before the first successful pairing.
         * @param store persisted Link identity owner.
         * @param transportConfig deployment-owned HTTP timeouts.
         * @return the restored client, or null when no identity exists.
         */
        fun restore(store: LinkCredentialsStoring, transportConfig: LinkTransportConfig): LinkClient? {
            val credentials = store.load() ?: return null
            return LinkClient(
                baseUrl = credentials.endpoint,
                pinnedFingerprint = credentials.pinnedFingerprint,
                store = store,
                transportConfig = transportConfig,
            )
        }
    }

    private suspend fun post(path: String, body: ByteArray, signed: Boolean): ByteArray {
        val tracked = trackedCall(unaryClient, request(path, body, signed))
        try {
            return awaitResponse(tracked)
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: LinkClientException) {
            throw failure
        } catch (failure: Exception) {
            currentCoroutineContext().ensureActive()
            throw LinkClientException.Carrier(0, failure.message ?: failure.javaClass.simpleName)
        }
    }

    /** Enqueue a registered call; cancellation owns it before enqueue so a
     * concurrent [close] settles through callback failure or enqueue rejection. */
    private suspend fun awaitResponse(tracked: TrackedCall): ByteArray = suspendCancellableCoroutine { continuation ->
        val call = tracked.call
        val completed = AtomicBoolean(false)

        fun complete(result: Result<ByteArray>) {
            if (completed.compareAndSet(false, true) && continuation.isActive) continuation.resumeWith(result)
        }

        continuation.invokeOnCancellation { call.cancel() }
        val callback = object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                try {
                    complete(Result.failure(e))
                } finally {
                    finishTrackedCall(tracked)
                }
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val responseBody = response.use { value ->
                        val bytes = value.body.bytes()
                        checkStatus(value.code, bytes)
                        bytes
                    }
                    complete(Result.success(responseBody))
                } catch (failure: Exception) {
                    complete(Result.failure(failure))
                } finally {
                    finishTrackedCall(tracked)
                }
            }
        }
        try {
            call.enqueue(callback)
        } catch (failure: Exception) {
            try {
                complete(Result.failure(failure))
            } finally {
                finishTrackedCall(tracked)
            }
        }
    }

    private fun request(path: String, body: ByteArray, signed: Boolean): Request {
        val builder = Request.Builder()
            .url(base + path)
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
        if (signed) applyCredentials(builder, path, body)
        return builder.build()
    }

    private fun trackedCall(
        client: OkHttpClient,
        request: Request,
        retireCall: (Call) -> Unit = { call -> call.cancel() },
    ): TrackedCall = synchronized(lifecycleLock) {
        if (closed) throw LinkClientException.Carrier(0, "Link client is closed")
        TrackedCall(client.newCall(request), retireCall).also { tracked ->
            activeCalls.add(tracked)
        }
    }

    private fun finishTrackedCall(tracked: TrackedCall) {
        synchronized(lifecycleLock) {
            activeCalls.remove(tracked)
            tracked.settled.complete(Unit)
        }
    }

    private fun requestClose(): List<TrackedCall> {
        val calls = synchronized(lifecycleLock) {
            closed = true
            activeCalls.toList()
        }
        calls.forEach { tracked -> tracked.retire() }
        if (transportRetired.compareAndSet(false, true)) {
            transportClient.connectionPool.evictAll()
            transportClient.dispatcher.executorService.shutdown()
        }
        return calls
    }

    private fun applyCredentials(builder: Request.Builder, path: String, body: ByteArray) {
        val credentials = store.load() ?: throw LinkClientException.Unpaired()
        val privateKeyRaw = credentials.signingKeyRaw
            ?: throw LinkClientException.BadWire("stored signing key is not base64")
        val timestamp = System.currentTimeMillis().toString()
        val input = LinkSigning.signingInput(
            timestamp = timestamp,
            method = "POST",
            path = path,
            bodySha256Hex = LinkSigning.sha256Hex(body),
        )
        builder.header(LinkSigning.deviceIdHeader, credentials.deviceId)
        builder.header(LinkSigning.timestampHeader, timestamp)
        builder.header(LinkSigning.signatureHeader, LinkSigning.sign(input, privateKeyRaw))
    }

    private fun checkStatus(status: Int, body: ByteArray?) {
        if (status in 200..299) return
        val document = body?.let { bytes ->
            runCatching {
                Json.parseToJsonElement(bytes.decodeToString()) as? JsonObject
            }.getOrNull()
        }
        val message = document?.optionalString("message")?.takeIf { it.isNotEmpty() }
            ?: document?.optionalString("reason")?.takeIf { it.isNotEmpty() }
            ?: "HTTP $status"
        if (status == 403 && document?.optionalString("error") == "forbidden") {
            throw LinkClientException.Refused("forbidden", message)
        }
        throw LinkClientException.Carrier(status, message)
    }

}

private fun JsonObject.optionalString(field: String): String? =
    (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.requiredString(field: String): String =
    optionalString(field)?.takeIf { it.isNotEmpty() }
        ?: throw LinkClientException.BadWire("missing or invalid string field $field")

private fun JsonObject.requiredNumber(field: String): Double =
    (this[field] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull
        ?: throw LinkClientException.BadWire("missing or invalid number field $field")

private fun JsonObject.pairResponse(expectedProtocolVersion: Double): LinkPairResponse {
    val role = requiredString("role")
    val protocolVersion = requiredNumber("linkProtocolVersion")
    if (protocolVersion != expectedProtocolVersion) {
        throw LinkClientException.BadWire("pair response protocol version mismatch")
    }
    return LinkPairResponse(
        deviceId = requiredString("deviceId"),
        hostId = requiredString("hostId"),
        hostName = requiredString("hostName"),
        role = LinkDeviceRole.entries.singleOrNull { it.wire == role }
            ?: throw LinkClientException.BadWire("pair response carried an invalid role"),
        linkProtocolVersion = protocolVersion,
    )
}

private fun JsonObject.boolean(field: String): Boolean =
    this[field]?.jsonPrimitive?.booleanOrNull ?: false

private fun JsonObject.number(field: String): Double =
    this[field]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0

/** Map the host-description JSON onto the generated contract model. */
internal fun mapHostDescription(obj: JsonObject): LinkHostDescription {
    val capabilities = obj["capabilities"]?.jsonObject ?: JsonObject(emptyMap())
    val session = capabilities["session"]?.jsonObject ?: JsonObject(emptyMap())
    val workspace = capabilities["workspace"]?.jsonObject ?: JsonObject(emptyMap())
    val interaction = capabilities["interaction"]?.jsonObject ?: JsonObject(emptyMap())
    return LinkHostDescription(
        linkProtocolVersion = obj.number("linkProtocolVersion"),
        contractVersion = obj.number("contractVersion"),
        hostVersion = obj.requiredString("hostVersion"),
        hostId = obj.requiredString("hostId"),
        hostName = obj.requiredString("hostName"),
        runtimeClass = obj.requiredString("runtimeClass"),
        sessionFormatVersion = obj.number("sessionFormatVersion"),
        allowRemoteApproval = obj.boolean("allowRemoteApproval"),
        capabilities = LinkCapabilities(
            session = LinkSessionCapabilities(
                list = session.boolean("list"),
                history = session.boolean("history"),
                follow = session.boolean("follow"),
                prompt = session.boolean("prompt"),
                cancel = session.boolean("cancel"),
            ),
            workspace = LinkWorkspaceCapabilities(follow = workspace.boolean("follow")),
            interaction = LinkInteractionCapabilities(
                approval = interaction.boolean("approval"),
                question = interaction.boolean("question"),
            ),
        ),
    )
}
