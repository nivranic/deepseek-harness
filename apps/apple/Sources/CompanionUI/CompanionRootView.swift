import SharedAppleRemoteCore
import SwiftUI

/// The companion root: pairing when no identity exists, then the tabbed
/// surface — sessions, the interaction inbox, the plan/todo/goal pane, the
/// tool trajectory, and the read-only files browser — under the selected
/// visual style.
public struct CompanionRootView: View {
    @State private var style: CompanionStyle = .neumorphic
    @State private var paired: Bool

    @State private var sessionModel: RemoteSessionViewModel?
    @State private var interactionModel: InteractionViewModel?
    @State private var filesModel: FilesViewModel?

    private let client: LinkClient?

    /// - Parameter client: the paired client, or nil before the first
    ///   pairing (the pairing view then constructs its own).
    public init(client: LinkClient?) {
        self.client = client
        _paired = State(initialValue: client?.credentials != nil)
    }

    public var body: some View {
        Group {
            if paired, let sessionModel, let interactionModel, let filesModel {
                CompanionTabView(
                    sessionModel: sessionModel,
                    interactionModel: interactionModel,
                    filesModel: filesModel,
                    style: $style
                )
            } else {
                HostPairingView { _ in
                    paired = true
                }
            }
        }
        .companionTheme(style)
        .task(id: paired) {
            guard paired, sessionModel == nil else { return }
            let wire = LinkClientWireDriver(client: client ?? unpairedClient())
            let sessions = RemoteSessionViewModel(wire: wire)
            let interactions = InteractionViewModel(wire: wire)
            let files = FilesViewModel(wire: wire)
            sessionModel = sessions
            interactionModel = interactions
            filesModel = files
            await sessions.loadSessions()
            await interactions.startWatching()
            await files.start()
        }
    }

    /// A placeholder client for the impossible window where pairing
    /// finished without a client handle; calls fail `unpaired` loudly.
    private func unpairedClient() -> LinkClient {
        LinkClient(
            baseURL: URL(string: "https://unpaired.invalid")!,
            pinnedFingerprint: String(repeating: "0", count: 64),
            store: MemoryLinkCredentialsStore()
        )
    }
}

/// The five-tab surface once paired.
struct CompanionTabView: View {
    let sessionModel: RemoteSessionViewModel
    let interactionModel: InteractionViewModel
    let filesModel: FilesViewModel
    @Binding var style: CompanionStyle

    var body: some View {
        TabView {
            SessionListView(model: sessionModel)
                .tabItem { Label("会话", systemImage: "bubble.left.and.bubble.right") }
            InteractionInboxView(model: interactionModel)
                .tabItem { Label("审批", systemImage: "checkmark.shield") }
            PlanTodoGoalView(sessionModel: sessionModel)
                .tabItem { Label("计划", systemImage: "list.clipboard") }
            ToolsView(sessionModel: sessionModel)
                .tabItem { Label("工具", systemImage: "wrench.and.screwdriver") }
            FilesView(model: filesModel)
                .tabItem { Label("文件", systemImage: "folder") }
        }
        .toolbar {
            ToolbarItem {
                Picker("外观", selection: $style) {
                    ForEach(CompanionStyle.allCases) { candidate in
                        Text(candidate.displayName).tag(candidate)
                    }
                }
            }
        }
    }
}
