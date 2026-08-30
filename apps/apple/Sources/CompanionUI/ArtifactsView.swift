import SwiftUI

/// The read-only artifacts pane (chapter 56): every reference the fold
/// collected from the session log, with kind and live status. Content
/// rides the resource channel, never this surface.
public struct ArtifactsView: View {
    private let sessionModel: RemoteSessionViewModel

    /// - Parameter sessionModel: the session view model owning the fold.
    public init(sessionModel: RemoteSessionViewModel) {
        self.sessionModel = sessionModel
    }

    public var body: some View {
        let artifacts = sessionModel.artifacts
        NavigationStack {
            List {
                if artifacts.isEmpty {
                    Text("当前会话暂无工件。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(artifacts) { artifact in
                    ArtifactRow(artifact: artifact)
                }
            }
            .navigationTitle("工件")
        }
    }
}

/// One artifact row: title and status headline, kind underneath.
struct ArtifactRow: View {
    let artifact: CompanionDomainState.Artifact

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(artifact.title)
                    .font(.body.weight(.medium))
                Spacer()
                Text(Self.statusLabel(artifact.status))
                    .font(.caption)
                    .foregroundStyle(Self.statusColor(artifact.status))
            }
            Text(artifact.kind)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private static func statusLabel(_ status: CompanionDomainState.Artifact.Status) -> String {
        switch status {
        case .pending: return "待定"
        case .ready: return "就绪"
        case .failed: return "失败"
        }
    }

    private static func statusColor(_ status: CompanionDomainState.Artifact.Status) -> Color {
        switch status {
        case .pending: return .secondary
        case .ready: return .green
        case .failed: return .red
        }
    }
}
