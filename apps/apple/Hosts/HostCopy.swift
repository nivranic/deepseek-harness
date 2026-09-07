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
    let recovery: String

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
        case .failed: return failed
        }
    }

    private static let chinese = HostCopy(
        start: "启动", stop: "停止", restart: "重新启动", stopped: "已停止", starting: "正在启动…",
        ready: "运行中", stopping: "正在停止…", failed: "运行时已停止，发生错误",
        unavailable: "运行时组件不可用", recovery: "可尝试重新启动；若组件不可用，请重新安装完整应用。"
    )
    private static let english = HostCopy(
        start: "Start", stop: "Stop", restart: "Restart", stopped: "Stopped", starting: "Starting…",
        ready: "Running", stopping: "Stopping…", failed: "Runtime stopped with an error",
        unavailable: "Runtime components unavailable", recovery: "Try starting again. If components are unavailable, reinstall the complete app."
    )
}
