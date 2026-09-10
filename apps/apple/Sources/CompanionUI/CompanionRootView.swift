import SharedAppleRemoteCore
import SwiftUI

/// The companion root: pairing when no identity exists, then the tabbed
/// surface — sessions, the interaction inbox, the plan/todo/goal pane, the
/// tool trajectory, and the read-only files browser — under the selected
/// visual style.
@MainActor
public struct CompanionRootView: View {
    @State private var style: CompanionStyle = .neumorphic
    @State private var paired: Bool

    @State private var sessionModel: RemoteSessionViewModel?
    @State private var interactionModel: InteractionViewModel?
    @State private var filesModel: FilesViewModel?
    @State private var subagentsModel: SubagentsViewModel?
    @State private var pushModel: PushViewModel?
    @State private var activeClient: LinkClient?
    @StateObject private var support: CompanionSupportModel
    @Environment(\.scenePhase) private var scenePhase

    /// - Parameters:
    ///   - client: the paired client, or nil before the first pairing.
    ///   - makeSupportExporter: the shell's scanner and application-identity composition.
    public init(client: LinkClient?, makeSupportExporter: @escaping @MainActor () throws -> CompanionSupportExporter) {
        _activeClient = State(initialValue: client)
        _paired = State(initialValue: client?.credentials != nil)
        _support = StateObject(wrappedValue: CompanionSupportModel(makeExporter: makeSupportExporter))
    }

    public var body: some View {
        Group {
            if paired, let sessionModel, let interactionModel, let filesModel, let subagentsModel {
                CompanionTabView(
                    sessionModel: sessionModel,
                    interactionModel: interactionModel,
                    filesModel: filesModel,
                    subagentsModel: subagentsModel,
                    style: $style
                )
            } else {
                HostPairingView { client in
                    activeClient = client
                    sessionModel = nil
                    interactionModel = nil
                    filesModel = nil
                    subagentsModel = nil
                    pushModel = nil
                    paired = true
                }
            }
        }
        .companionTheme(style)
        .safeAreaInset(edge: .bottom) {
            CompanionSupportView(model: support) { activeClient?.supportSnapshot() }
        }
        .task(id: paired && scenePhase == .active) {
            guard paired, scenePhase == .active, let activeClient else { return }
            do {
                _ = try await activeClient.describe()
            } catch {
                // LinkClient records a fixed failure and clears metadata; the application remains usable offline.
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { support.cancel() }
        }
        .onDisappear { support.cancel() }
        .task(id: paired) {
            guard paired, sessionModel == nil, let activeClient else { return }
            let wire = LinkClientWireDriver(client: activeClient)
            let sessions = RemoteSessionViewModel(wire: wire)
            let interactions = InteractionViewModel(wire: wire)
            let files = FilesViewModel(wire: wire)
            let subagents = SubagentsViewModel(wire: wire)
            sessionModel = sessions
            interactionModel = interactions
            filesModel = files
            subagentsModel = subagents
            let pushes = PushViewModel(wire: wire, presenter: SystemPushPresenter())
            pushModel = pushes
            await sessions.loadSessions()
            await interactions.startWatching()
            await pushes.startWatching()
            await files.start()
        }
    }
}

/// The seven-tab surface once paired.
struct CompanionTabView: View {
    let sessionModel: RemoteSessionViewModel
    let interactionModel: InteractionViewModel
    let filesModel: FilesViewModel
    let subagentsModel: SubagentsViewModel
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
            ArtifactsView(sessionModel: sessionModel)
                .tabItem { Label("工件", systemImage: "shippingbox") }
            SubagentsView(sessionModel: sessionModel, model: subagentsModel)
                .tabItem { Label("子代理", systemImage: "person.2") }
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
