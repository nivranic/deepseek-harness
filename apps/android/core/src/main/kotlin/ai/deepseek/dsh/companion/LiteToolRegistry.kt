package ai.deepseek.dsh.companion

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
 * The Lite static tool registry: the chapter-36 P0 tool set, bundled with
 * the app. Registration is compile-time only — a dynamic name is refused
 * loudly, never resolved.
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
     * Whether dispatching this tool hands off to the full runtime instead
     * of executing on-device.
     * @param name the model-requested tool name.
     * @return the capability to hand off on, or null when Lite serves it.
     */
    fun handoffCapability(name: String): String? = tool(name)?.fallbackCapability
}
