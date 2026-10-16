package ai.deepseek.dsh.companion

import android.content.Context
import kotlinx.coroutines.CoroutineScope

/**
 * Assembles one standalone Lite chat session over the APK-bundled projection
 * pair: the provider's `tools` array and the preset catalog both come from
 * [LiteAssets]' BUNDLED catalogs, and the dispatch catalog stays the bundled
 * fallback name domain — §31's permission gate keeps unknown names refused
 * because this generation bundles no tool declaration. Construction only:
 * mounting the view model into a UI is not this factory's concern.
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
     * @returns the assembled view model.
     * @throws java.io.IOException when a bundled asset is absent.
     * @throws IllegalArgumentException when a bundled document is malformed.
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
    ): LiteChatViewModel {
        val bundled = LiteAssets.load(context)
        return LiteChatViewModel(
            scope = scope,
            sessionId = sessionId,
            provider = LiteHTTPProvider(
                endpoint = endpoint,
                apiKey = apiKey,
                model = model,
                toolSchemas = bundled.toolSchemas.tools,
            ),
            execute = execute,
            store = store,
            artifacts = artifacts,
            toolCatalog = LiteToolCatalog.FALLBACK,
            presetCatalog = bundled.presets,
            facts = LiteSessionFacts(
                toolCatalogSource = LiteToolCatalog.FALLBACK.source,
                toolSchemasSource = bundled.toolSchemas.source,
                presetSource = bundled.presets.source,
            ),
        )
    }
}
