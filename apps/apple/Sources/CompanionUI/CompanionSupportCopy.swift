import Foundation

/// Diagnostic controls and failure feedback follow the application's selected locale.
struct CompanionSupportCopy {
    let export: String
    let scanning: String
    let cancel: String
    let scope: String
    let failed: String
    let recovery: String
    let dismiss: String

    static func select(_ locale: Locale) -> CompanionSupportCopy {
        locale.language.languageCode?.identifier == "zh" ? chinese : english
    }

    private static let chinese = CompanionSupportCopy(
        export: "导出诊断信息", scanning: "正在检查诊断信息…", cancel: "取消",
        scope: "包含应用信息和连接活动，不含聊天内容；诊断信息可能不完整。",
        failed: "无法导出诊断信息", recovery: "请重试，或确认应用完整安装后再次导出。", dismiss: "知道了")
    private static let english = CompanionSupportCopy(
        export: "Export diagnostics", scanning: "Checking diagnostics…", cancel: "Cancel",
        scope: "Includes app information and connection activity, without chat content. Diagnostics may be incomplete.",
        failed: "Could not export diagnostics", recovery: "Try again, or reinstall the complete application before exporting.", dismiss: "OK")
}
