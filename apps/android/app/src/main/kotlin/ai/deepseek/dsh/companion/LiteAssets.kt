package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.LitePresetDescriptors
import ai.deepseek.dsh.contract.LiteToolSchema
import ai.deepseek.dsh.contract.LiteToolSchemas
import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.contract.ToolDescriptors
import android.content.Context
import java.io.IOException

/**
 * The Lite catalogs and tool declarations loaded from the documents the
 * build bundles into `assets/lite/`: the model-face schemas — the Host's
 * projection and the app-owned device document — the persona selection, and
 * the two tool-declaration documents — the app-owned device declarations and
 * the Host's tool-descriptor projection — whose unions are a standalone
 * session's frozen schema and declaration domains. All parse through the
 * shared contract parsers and stay observable as their own BUNDLED source.
 */
class LiteBundledCatalogs(
    /** The Host's model-face tool schemas (§32) loaded from `lite/lite-tool-schemas.json`. */
    val toolSchemas: LiteToolSchemaCatalog,
    /** The app-owned device tool schemas (§32) loaded from `lite/lite-device-tool-schemas.json`. */
    val deviceToolSchemas: List<LiteToolSchema>,
    /** The persona selection (§33) loaded from `lite/lite-preset-descriptors.json`. */
    val presets: LitePresetCatalog,
    /** The app-owned device tool declarations (§32) loaded from `lite/lite-tool-declarations.json`. */
    val deviceToolDeclarations: List<ToolDescriptor>,
    /** The Host's tool-descriptor projection loaded from `lite/tool-descriptors.json`. */
    val hostToolDescriptors: List<ToolDescriptor>,
)

/**
 * Loads [LiteBundledCatalogs] from the APK's assets. A missing or malformed
 * bundle throws — the app never silently falls back to a BARE selection.
 */
object LiteAssets {
    private const val TOOL_SCHEMAS_ASSET = "lite/lite-tool-schemas.json"
    private const val DEVICE_TOOL_SCHEMAS_ASSET = "lite/lite-device-tool-schemas.json"
    private const val PRESETS_ASSET = "lite/lite-preset-descriptors.json"
    private const val DEVICE_DECLARATIONS_ASSET = "lite/lite-tool-declarations.json"
    private const val HOST_TOOL_DESCRIPTORS_ASSET = "lite/tool-descriptors.json"

    /**
     * Load and parse the bundled projections and tool declarations.
     * @param context any context of the application whose assets carry the bundle.
     * @returns the BUNDLED-source catalogs and declaration lists.
     * @throws IOException when any asset is absent from the APK.
     * @throws IllegalArgumentException when any document is malformed.
     */
    fun load(context: Context): LiteBundledCatalogs {
        val toolSchemas = LiteToolSchemaCatalog.fromBundledProjection(
            LiteToolSchemas.parseDocument(context.readAsset(TOOL_SCHEMAS_ASSET)),
        )
        val deviceToolSchemas = LiteToolSchemas.parseDocument(context.readAsset(DEVICE_TOOL_SCHEMAS_ASSET))
        val presets = LitePresetCatalog.fromBundledProjection(
            LitePresetDescriptors.parseDocument(context.readAsset(PRESETS_ASSET)),
        )
        val deviceToolDeclarations = ToolDescriptors.parseDocument(context.readAsset(DEVICE_DECLARATIONS_ASSET))
        val hostToolDescriptors = ToolDescriptors.parseDocument(context.readAsset(HOST_TOOL_DESCRIPTORS_ASSET))
        return LiteBundledCatalogs(
            toolSchemas = toolSchemas,
            deviceToolSchemas = deviceToolSchemas,
            presets = presets,
            deviceToolDeclarations = deviceToolDeclarations,
            hostToolDescriptors = hostToolDescriptors,
        )
    }

    private fun Context.readAsset(path: String): String =
        assets.open(path).use { stream -> stream.readBytes().decodeToString() }
}
