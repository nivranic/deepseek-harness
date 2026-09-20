package ai.deepseek.dsh.link

import java.util.UUID

/**
 * The signed per-request device admission injected into every business RPC
 * envelope and stream-open payload: base64 Ed25519 over the three-line form
 * `deviceId\ntimestamp\nnonce`, mirroring the gateway's admission wire. A
 * fresh nonce rides every call, so a captured envelope replayed inside the
 * acceptance window is refused Host-side as a replay.
 */
data class DeviceAdmission(
    val deviceId: String,
    val timestamp: Long,
    val nonce: String,
    val signature: String,
) {
    /** The four-key wire object: deviceId, timestamp, nonce, signature. */
    fun toWireValue(): WireValue.ObjectValue = WireValue.ObjectValue(
        mapOf(
            "deviceId" to WireValue.StringValue(deviceId),
            "timestamp" to WireValue.NumberValue(timestamp.toDouble()),
            "nonce" to WireValue.StringValue(nonce),
            "signature" to WireValue.StringValue(signature),
        ),
    )

    companion object {
        /** Build one admission over a fresh nonce with the paired signing key. */
        fun create(deviceId: String, signingKeyRaw: ByteArray): DeviceAdmission {
            val timestamp = System.currentTimeMillis()
            val nonce = UUID.randomUUID().toString()
            return DeviceAdmission(
                deviceId = deviceId,
                timestamp = timestamp,
                nonce = nonce,
                signature = LinkSigning.sign("$deviceId\n$timestamp\n$nonce", signingKeyRaw),
            )
        }
    }
}
