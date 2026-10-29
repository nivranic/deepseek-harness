import Foundation

/// The capability marker a Lite runtime hands off on instead of serving
/// (nativization plan chapter 35): the full Node harness continues the work
/// on a host.
public let LITE_REQUIRES_FULL_RUNTIME = "requiresFullRuntime"

/// One app-bundled static tool (chapter 36): reviewable, never downloaded.
public struct LiteToolDescriptor: Equatable, Sendable {
    public let name: String
    public let description: String
    /// The capability this tool demands when Lite cannot serve it.
    public let fallbackCapability: String?

    public init(name: String, description: String, fallbackCapability: String? = nil) {
        self.name = name
        self.description = description
        self.fallbackCapability = fallbackCapability
    }
}

/// The Lite static tool registry: the chapter-36 P0 tool set, bundled with
/// the app. Registration is compile-time only — a dynamic name is refused
/// loudly, never resolved.
public enum LiteToolRegistry {
    /// The bundled tool set the Lite runtime may dispatch.
    public static let bundled: [LiteToolDescriptor] = [
        LiteToolDescriptor(name: "web_search", description: "搜索网络并返回结果列表。"),
        LiteToolDescriptor(name: "url_fetch", description: "抓取一个 URL 的文本内容。"),
        LiteToolDescriptor(name: "image_inspect", description: "读取一张本地图片的尺寸与类型。"),
        LiteToolDescriptor(name: "attachment_read", description: "读取一个会话附件的内容。"),
        LiteToolDescriptor(name: "artifact_create", description: "创建一个 artifact 引用并写入内容。"),
        LiteToolDescriptor(name: "calculator", description: "求值一个算术表达式。"),
        // Shell-less by design (chapter 35): arbitrary execution hands off.
        LiteToolDescriptor(
            name: "run_tests",
            description: "运行完整测试套件——需要完整运行时。",
            fallbackCapability: LITE_REQUIRES_FULL_RUNTIME
        ),
    ]

    /// Look up one bundled tool by name.
    /// - Parameter name: the model-requested tool name.
    /// - Returns: the descriptor, or nil when no bundled tool carries the name.
    public static func tool(named name: String) -> LiteToolDescriptor? {
        bundled.first { $0.name == name }
    }

    /// Whether dispatching this tool hands off to the full runtime instead
    /// of executing on-device.
    /// - Parameter name: the model-requested tool name.
    /// - Returns: the capability to hand off on, or nil when Lite serves it.
    public static func handoffCapability(for name: String) -> String? {
        tool(named: name)?.fallbackCapability
    }
}
