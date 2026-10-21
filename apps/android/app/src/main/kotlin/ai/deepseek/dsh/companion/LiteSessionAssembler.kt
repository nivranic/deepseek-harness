package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.ToolDescriptor
import android.content.Context
import kotlinx.coroutines.CoroutineScope

/**
 * Assembles one standalone Lite chat session over the APK-bundled documents:
 * the provider's `tools` array is the APK-frozen union of the bundled Host
 * projection's schemas and the app-owned device schemas, the preset catalog
 * comes from [LiteAssets]' BUNDLED catalogs with the preset selection
 * resolved once against it — a null id keeps the projection default — and
 * the dispatch catalog is the APK-frozen union of the device tool
 * declarations and the bundled Host projection (§32), or the live union with
 * the paired Host's fetched declaration when one is served: the §31
 * permission gate walks the declared gates, and a name absent from both
 * documents stays Unknown. Construction only: mounting the view model into a
 * UI is not this factory's concern.
 */
object LiteSessionAssembler {

    /**
     * Build the chat view model over the bundled catalogs.
     * @param context any context of the application whose assets carry the bundle.
     * @param scope the scope the loop driver submits turns on.
     * @param sessionId the durable journal identity for the assembled session.
     * @param endpoint the provider's OpenAI-compatible chat-completions endpoint.
     * @param apiKey the provider credential; request-face only.
     * @param model the provider model id.
     * @param execute the on-device bundled-tool executor.
     * @param store the optional durable journal store.
     * @param artifacts the optional artifact content channel.
     * @param presetId the requested preset id (§33): null assembles the catalog default, and an id the bundled projection does not carry fails loud — no substitute is guessed.
     * @param liveHostToolDescriptors the paired Host's live-served tool declaration; null keeps the APK-frozen BUNDLED union.
     * @returns the assembled view model; its facts name the preset actually in effect and the tool-catalog source actually assembled.
     * @throws java.io.IOException when a bundled asset is absent.
     * @throws IllegalArgumentException when a bundled document is malformed, [presetId] names a preset the bundled catalog does not carry, or a live declaration names a device-declared tool id.
     */
    fun assemble(
        context: Context,
        scope: CoroutineScope,
        sessionId: String,
        endpoint: String,
        apiKey: String,
        model: String,
        execute: LiteToolExecuting,
        store: LiteSessionStoring? = null,
        artifacts: LiteArtifactStoring? = null,
        presetId: String? = null,
        liveHostToolDescriptors: List<ToolDescriptor>? = null,
    ): LiteChatViewModel {
        val bundled = LiteAssets.load(context)
        // The selection resolves here, once: switching presets means
        // assembling a new session with new facts, never re-pointing a live one.
        val preset = bundled.presets.resolve(presetId)
        // A served Host declaration replaces the bundled Host projection
        // wholesale; without one the APK-frozen union stays.
        val toolCatalog = if (liveHostToolDescriptors != null) {
            LiteToolCatalog.fromDeviceAndLiveHostDeclarations(bundled.deviceToolDeclarations, liveHostToolDescriptors)
        } else {
            LiteToolCatalog.fromBundledDocuments(bundled.deviceToolDeclarations, bundled.hostToolDescriptors)
        }
        val toolSchemas = LiteToolSchemaCatalog.fromBundledDocuments(bundled.toolSchemas.tools, bundled.deviceToolSchemas)
        return LiteChatViewModel(
            scope = scope,
            sessionId = sessionId,
            provider = LiteHTTPProvider(
                endpoint = endpoint,
                apiKey = apiKey,
                model = model,
                toolSchemas = toolSchemas.tools,
            ),
            execute = execute,
            store = store,
            artifacts = artifacts,
            toolCatalog = toolCatalog,
            presetCatalog = bundled.presets,
            selectedPreset = preset,
            facts = LiteSessionFacts(
                toolCatalogSource = toolCatalog.source,
                toolSchemasSource = toolSchemas.source,
                presetSource = bundled.presets.source,
                presetId = preset?.id,
            ),
        )
    }
}
