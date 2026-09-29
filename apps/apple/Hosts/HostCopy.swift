import DirectHostRuntime
import Foundation

/// Locale-owned native copy; the embedded Web UI retains its own typed dictionaries.
struct HostCopy {
    let start: String
    let stop: String
    let restart: String
    let stopped: String
    let starting: String
    let ready: String
    let stopping: String
    let failed: String
    let unavailable: String
    let invalidConfiguration: String
    let recovery: String
    let exportDiagnostics: String
    let scanningDiagnostics: String
    let cancelExport: String
    let exportScope: String
    let exportFailed: String
    let exportRecovery: String
    let dismiss: String

    static var current: HostCopy {
        Locale.current.language.languageCode?.identifier == "zh" ? chinese : english
    }

    func status(_ state: RuntimeStatus) -> String {
        switch state {
        case .stopped: return stopped
        case .starting: return starting
        case .ready: return ready
        case .stopping: return stopping
        case .failed(.unavailable): return unavailable
        case .failed(.invalidConfiguration): return invalidConfiguration
        case .failed: return failed
        }
    }

    private static let chinese = HostCopy(
        start: "启动", stop: "停止", restart: "重新启动", stopped: "已停止", starting: "正在启动…",
        ready: "运行中", stopping: "正在停止…", failed: "运行时已停止，发生错误",
        unavailable: "运行时组件不可用", invalidConfiguration: "DSH_HOME 必须是有效的绝对目录路径",
        recovery: "修正配置后重新启动；若组件不可用，请重新安装完整应用。",
        exportDiagnostics: "导出运行时诊断…", scanningDiagnostics: "正在检查诊断…", cancelExport: "取消",
        exportScope: "保存应用版本、运行时状态和生命周期计数，不含会话内容、路径或连接地址。连接、权限和更新信息尚未采集。",
        exportFailed: "未能导出诊断", exportRecovery: "诊断未通过安全检查或无法保存。请重试；若仍然失败，请重新安装完整应用。", dismiss: "好"
    )
    private static let english = HostCopy(
        start: "Start", stop: "Stop", restart: "Restart", stopped: "Stopped", starting: "Starting…",
        ready: "Running", stopping: "Stopping…", failed: "Runtime stopped with an error",
        unavailable: "Runtime components unavailable", invalidConfiguration: "DSH_HOME must be a valid absolute directory path",
        recovery: "Correct the configuration and start again. If components are unavailable, reinstall the complete app.",
        exportDiagnostics: "Export runtime diagnostics…", scanningDiagnostics: "Checking diagnostics…", cancelExport: "Cancel",
        exportScope: "Save app version, runtime state and lifecycle counts without session content, paths or connection addresses. Connection, permissions and update information are not collected yet.",
        exportFailed: "Could not export diagnostics", exportRecovery: "Diagnostics did not pass the security check or could not be saved. Try again; if this continues, reinstall the complete app.", dismiss: "OK"
    )
}
