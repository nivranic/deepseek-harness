import SwiftUI
import DirectHostRuntime

/// One native lifecycle owner and one local Web carrier over the bundled dsh runtime.
@main
struct DirectHostMacApp: App {
    @NSApplicationDelegateAdaptor(HostApplicationDelegate.self) private var delegate
    @StateObject private var runtime: RuntimeSupervisor

    init() {
        let resources = Bundle.main.resourceURL!.appendingPathComponent("Runtime", isDirectory: true)
        let home = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/DeepSeek Harness/Host", isDirectory: true)
        let policy = try! RuntimePolicy(startupMilliseconds: 60000, healthMilliseconds: 5000,
                                       requestMilliseconds: 3000, shutdownMilliseconds: 10000)
        #if arch(arm64)
        let executable = resources.appendingPathComponent("deepseek-harness-sdk-runtime-macos-arm64")
        #else
        let executable = resources.appendingPathComponent("deepseek-harness-sdk-runtime-macos-x64")
        #endif
        _runtime = StateObject(wrappedValue: RuntimeSupervisor(
            executable: executable, helper: resources.appendingPathComponent("HostRuntimeSupervisor"),
            home: home, policy: policy, homeOverride: ProcessInfo.processInfo.environment["DSH_HOME"]
        ))
    }

    var body: some Scene {
        WindowGroup {
            HostHomeView(runtime: runtime)
                .onAppear {
                    delegate.runtime = runtime
                    runtime.start()
                }
        }
    }
}

@MainActor
final class HostApplicationDelegate: NSObject, NSApplicationDelegate {
    weak var runtime: RuntimeSupervisor?

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let runtime else { return .terminateNow }
        Task {
            await runtime.stop()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
