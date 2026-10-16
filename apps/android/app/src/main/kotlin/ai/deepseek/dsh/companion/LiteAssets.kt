package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptors
import ai.deepseek.dsh.contract.LiteToolSchemas
import android.content.Context
import java.io.IOException

/**
 * The Lite catalogs loaded from the Host-projection bytes the build bundles
 * into `assets/lite/` (§31's app-carried projection pair). Both parse through
 * the shared contract parsers and stay observable as their own BUNDLED source.
 */
class LiteBundledCatalogs(
    /** The model-face tool schemas (§32) loaded from `lite/lite-tool-schemas.json`. */
    val toolSchemas: LiteToolSchemaCatalog,
    /** The persona selection (§33) loaded from `lite/lite-preset-descriptors.json`. */
    val presets: LitePresetCatalog,
)

/**
 * Loads [LiteBundledCatalogs] from the APK's assets. A missing or malformed
 * bundle throws — the app never silently falls back to a BARE selection.
 */
object LiteAssets {
    private const val TOOL_SCHEMAS_ASSET = "lite/lite-tool-schemas.json"
    private const val PRESETS_ASSET = "lite/lite-preset-descriptors.json"

    /**
     * Load and parse both bundled projections.
     * @param context any context of the application whose assets carry the bundle.
     * @returns both BUNDLED-source catalogs.
     * @throws IOException when either asset is absent from the APK.
     * @throws IllegalArgumentException when either document is malformed.
     */
    fun load(context: Context): LiteBundledCatalogs {
        val toolSchemas = LiteToolSchemaCatalog.fromBundledProjection(
            LiteToolSchemas.parseDocument(context.readAsset(TOOL_SCHEMAS_ASSET)),
        )
        val presets = LitePresetCatalog.fromBundledProjection(
            LitePresetDescriptors.parseDocument(context.readAsset(PRESETS_ASSET)),
        )
        return LiteBundledCatalogs(toolSchemas = toolSchemas, presets = presets)
    }

    private fun Context.readAsset(path: String): String =
        assets.open(path).use { stream -> stream.readBytes().decodeToString() }
}
