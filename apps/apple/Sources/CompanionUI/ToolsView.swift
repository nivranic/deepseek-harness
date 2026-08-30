import SwiftUI

/// The tool trajectory of the open session: every model-requested
/// invocation paired with its result, read live from the session view
/// model's folded records.
public struct ToolsView: View {
    private let sessionModel: RemoteSessionViewModel

    /// - Parameter sessionModel: the session view model owning the trajectory.
    public init(sessionModel: RemoteSessionViewModel) {
        self.sessionModel = sessionModel
    }

    public var body: some View {
        let calls = sessionModel.toolCalls
        NavigationStack {
            List {
                if calls.isEmpty {
                    Text("当前会话暂无工具调用。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(calls) { call in
                    ToolCallRow(call: call)
                }
            }
            .navigationTitle("工具")
        }
    }
}

/// One trajectory row: name and phase headline, the raw arguments, and the
/// result text once the invocation closed.
struct ToolCallRow: View {
    let call: CompanionDomainState.ToolCall

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: Self.phaseIcon(call.phase))
                    .foregroundStyle(call.phase == .failed ? .red : .secondary)
                Text(call.name).font(.body.weight(.medium))
                Spacer()
                Text(Self.phaseLabel(call.phase))
                    .font(.caption)
                    .foregroundStyle(call.phase == .failed ? .red : .secondary)
            }
            if !call.arguments.isEmpty {
                Text(call.arguments)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !call.resultText.isEmpty {
                Text(call.resultText)
                    .font(.callout)
                    .lineLimit(6)
            }
            if let change = FileChange.project([call]).first {
                DiffReview(change: change)
            }
        }
        .padding(.vertical, 2)
    }

    private static func phaseLabel(_ phase: CompanionDomainState.ToolCall.Phase) -> String {
        switch phase {
        case .running: return "执行中"
        case .completed: return "已完成"
        case .failed: return "失败"
        }
    }

    private static func phaseIcon(_ phase: CompanionDomainState.ToolCall.Phase) -> String {
        switch phase {
        case .running: return "clock"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.octagon.fill"
        }
    }
}

/// The chapter-55 collapsed diff review: path and +/− counts always
/// visible, hunk lines behind the disclosure toggle.
struct DiffReview: View {
    let change: FileChange
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(change.lines.enumerated()), id: \.offset) { _, line in
                    Text((line.added ? "+ " : "− ") + line.text)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(line.added ? Color.green : Color.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } label: {
            HStack(spacing: 8) {
                Text(change.path)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                Spacer()
                Text("+\(change.added)")
                    .foregroundStyle(.green)
                Text("−\(change.removed)")
                    .foregroundStyle(.red)
            }
        }
    }
}
