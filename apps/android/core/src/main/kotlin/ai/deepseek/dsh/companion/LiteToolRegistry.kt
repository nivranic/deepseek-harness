package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.ToolDescriptor

/**
 * The capability marker a Lite runtime hands off on instead of serving
 * (nativization plan chapter 35): the full Node harness continues the work
 * on a host.
 */
const val LITE_REQUIRES_FULL_RUNTIME = "requiresFullRuntime"

/** One app-bundled static tool (chapter 36): reviewable, never downloaded. */
data class LiteToolDescriptor(
    val name: String,
    val description: String,
    /** The capability this tool demands when Lite cannot serve it. */
    val fallbackCapability: String? = null,
)

/**
 * Which judgment source produced a dispatch decision: the Host's tool
 * declaration, or the bundled defaults kept for offline sessions and Hosts
 * that never served one. The source is carried explicitly so a fallback stays
 * observable, never silent.
 */
enum class LiteToolSource { HOST_DECLARED, BUNDLED_FALLBACK }

/**
 * The dispatch decisions for one Lite runtime (§32): which tool may execute
 * on-device and which hands off to the full runtime. Host-declared mode
 * consumes the Host's [ToolDescriptor] projection — the Client never guesses;
 * a tool executes on-device only when the Host declares `supportsLite` and a
 * bundled executor exists, and everything else keeps the handoff path.
 */
class LiteToolCatalog private constructor(
    /** Which judgment source produced this catalog. */
    val source: LiteToolSource,
    private val hostTools: Map<String, ToolDescriptor>,
) {
    /**
     * Look up one bundled tool's execution face.
     * @param name the model-requested tool name.
     * @return the bundled descriptor, or null when no bundled tool carries the name.
     */
    fun tool(name: String): LiteToolDescriptor? = LiteToolRegistry.tool(name)

    /**
     * Look up the Host's declaration for one tool name — the read face the
     * §31 permission policy consumes for the Host-declared risk and
     * permission facts.
     * @param name the model-requested tool name.
     * @return the declared descriptor, or null when the name is absent from the declaration; [LiteToolSource.BUNDLED_FALLBACK] carries no declaration, so lookups there answer null.
     */
    fun declaration(name: String): ToolDescriptor? = hostTools[name]

    /**
     * Whether dispatching this tool hands off to the full runtime instead of
     * executing on-device.
     * @param name the model-requested tool name.
     * @return the capability to hand off on, or null when Lite serves it.
     */
    fun handoffCapability(name: String): String? = when (source) {
        LiteToolSource.BUNDLED_FALLBACK -> LiteToolRegistry.handoffCapability(name)
        LiteToolSource.HOST_DECLARED -> when {
            hostTools[name]?.supportsLite != true -> LITE_REQUIRES_FULL_RUNTIME
            LiteToolRegistry.tool(name) == null -> LITE_REQUIRES_FULL_RUNTIME
            else -> null
        }
    }

    companion object {
        /** The bundled-default catalog for offline sessions and Hosts without a declaration. */
        val FALLBACK: LiteToolCatalog = LiteToolCatalog(LiteToolSource.BUNDLED_FALLBACK, emptyMap())

        /**
         * Build the Host-declared catalog from a fetched tools declaration.
         * @param descriptors the Host's tool descriptors, matched by id against the bundled names.
         * @returns the catalog; names unknown to the declaration or the bundle stay non-executable rather than guessed.
         */
        fun fromHostDescriptors(descriptors: List<ToolDescriptor>): LiteToolCatalog =
            LiteToolCatalog(LiteToolSource.HOST_DECLARED, descriptors.associateBy { it.id })
    }
}

/**
 * The Lite static tool registry: the chapter-36 P0 tool set, bundled with
 * the app. Registration is compile-time only — a dynamic name is refused
 * loudly, never resolved. The registry's own lookups answer in bundled
 * fallback semantics; a live session decides through a [LiteToolCatalog].
 */
object LiteToolRegistry {
    /** The bundled tool set the Lite runtime may dispatch. */
    val bundled: List<LiteToolDescriptor> = listOf(
        LiteToolDescriptor(name = "web_search", description = "搜索网络并返回结果列表。"),
        LiteToolDescriptor(name = "url_fetch", description = "抓取一个 URL 的文本内容。"),
        LiteToolDescriptor(name = "image_inspect", description = "读取一张本地图片的尺寸与类型。"),
        LiteToolDescriptor(name = "attachment_read", description = "读取一个会话附件的内容。"),
        LiteToolDescriptor(name = "artifact_create", description = "创建一个 artifact 引用并写入内容。"),
        LiteToolDescriptor(name = "calculator", description = "求值一个算术表达式。"),
        // Shell-less by design (chapter 35): arbitrary execution hands off.
        LiteToolDescriptor(
            name = "run_tests",
            description = "运行完整测试套件——需要完整运行时。",
            fallbackCapability = LITE_REQUIRES_FULL_RUNTIME,
        ),
    )

    /**
     * Look up one bundled tool by name.
     * @param name the model-requested tool name.
     * @return the descriptor, or null when no bundled tool carries the name.
     */
    fun tool(name: String): LiteToolDescriptor? = bundled.firstOrNull { it.name == name }

    /**
     * The bundled-fallback judgment: whether dispatching this tool hands off
     * to the full runtime instead of executing on-device.
     * @param name the model-requested tool name.
     * @return the capability to hand off on, or null when Lite serves it.
     */
    fun handoffCapability(name: String): String? = tool(name)?.fallbackCapability
}
