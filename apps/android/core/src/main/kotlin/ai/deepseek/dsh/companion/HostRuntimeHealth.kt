package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The §41 health-state vocabulary exactly as the Host defines it; no other word parses. */
enum class HostHealthState(val wire: String) {
    UP("up"), DEGRADED("degraded"), DOWN("down");

    companion object {
        internal fun from(value: String): HostHealthState? = entries.find { it.wire == value }
    }
}

/** One §41 health component: the evaluated state plus the probed-source detail, verbatim from the Host. */
data class HostHealthComponent(val state: HostHealthState, val detail: String) {
    fun toJson(): JsonObject = buildJsonObject { put("state", state.wire); put("detail", detail) }
}

/** The paired Host's §41 liveness snapshot: the six component states and the derived readiness verdict. */
data class HostRuntimeHealth(
    val ready: Boolean,
    val process: HostHealthComponent,
    val runtime: HostHealthComponent,
    val sessionStore: HostHealthComponent,
    val pluginState: HostHealthComponent,
    val connection: HostHealthComponent,
    val modelProvider: HostHealthComponent,
) {
    /** The document segment names the wire endpoint and the fetch-time observation; component values stay verbatim. */
    fun toJson(): JsonObject = buildJsonObject {
        put("producer", "hostDiagnostics/health")
        put("observation", "fetch-time")
        put("ready", ready)
        put("components", buildJsonObject {
            put("process", process.toJson()); put("runtime", runtime.toJson())
            put("sessionStore", sessionStore.toJson()); put("pluginState", pluginState.toJson())
            put("connection", connection.toJson()); put("modelProvider", modelProvider.toJson())
        })
    }

    companion object {
        /** Strict §41 parse: every component and the readiness verdict must be
         * present in the Host's exact vocabulary. A deviating answer is
         * rejected whole — a health snapshot never carries a guessed component. */
        internal fun parse(value: WireValue): HostRuntimeHealth {
            val root = value.toJsonElement().strictObject()
            fun component(field: String): HostHealthComponent {
                val obj = root.strictObjectField(field)
                val state = HostHealthState.from(obj.strictString("state"))
                    ?: throw IllegalArgumentException("unknown health state in '$field'")
                return HostHealthComponent(state, obj.strictString("detail"))
            }
            return HostRuntimeHealth(
                ready = root.strictBoolean("ready"),
                process = component("process"),
                runtime = component("runtime"),
                sessionStore = component("sessionStore"),
                pluginState = component("pluginState"),
                connection = component("connection"),
                modelProvider = component("modelProvider"),
            )
        }
    }
}

/** Fetch the paired Host's §41 health snapshot over [WireDriving.call]. An
 * unpaired wire, an unadvertised capability, a timeout, or a deviating answer
 * returns null — the snapshot stays uncollected, never guessed; caller
 * cancellation propagates.
 * @param timeoutMillis bounds the fetch independently of the transport's own call timeout.
 * @returns the parsed snapshot, or null when this attempt collected nothing.
 */
suspend fun WireDriving.fetchHostRuntimeHealth(timeoutMillis: Long = 2_000L): HostRuntimeHealth? =
    try {
        withTimeoutOrNull(timeoutMillis) { HostRuntimeHealth.parse(call("hostDiagnostics/health", emptyMap())) }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        null
    }

private fun JsonElement.strictObject(): JsonObject =
    this as? JsonObject ?: throw IllegalArgumentException("expected a JSON object")

private fun JsonObject.strictObjectField(field: String): JsonObject =
    (this[field] as? JsonObject) ?: throw IllegalArgumentException("expected object field '$field'")

private fun JsonObject.strictString(field: String): String =
    (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw IllegalArgumentException("expected string field '$field'")

private fun JsonObject.strictBoolean(field: String): Boolean =
    (this[field] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull
        ?: throw IllegalArgumentException("expected boolean field '$field'")
