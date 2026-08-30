import SharedAppleRemoteCore
import SwiftUI

/// The companion root: pairing when no identity exists, then the tabbed
/// surface — sessions, the interaction inbox, the plan/todo/goal pane, and
/// the tool trajectory — under the selected visual style.
public struct CompanionRootView: View {
    @State private var style: CompanionStyle = .neumorphic
    @State private var paired: Bool

    @State private var sessionModel: RemoteSessionViewModel?
    @State private var interactionModel: InteractionViewModel?

    private let client: LinkClient?

    /// - Parameter client: the paired client, or nil before the first
    ///   pairing (the pairing view then constructs its own).
    public init(client: LinkClient?) {
        self.client = client
        _paired = State(initialValue: client?.credentials != nil)
    }

    public var body: some View {
        Group {
            if paired, let sessionModel, let interactionModel {
                CompanionTabView(
                    sessionModel: sessionModel,
                    interactionModel: interactionModel,
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
            sessionModel = sessions
            interactionModel = interactions
            await sessions.loadSessions()
            await interactions.startWatching()
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

/// The three-tab surface once paired.
struct CompanionTabView: View {
    let sessionModel: RemoteSessionViewModel
    let interactionModel: InteractionViewModel
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
