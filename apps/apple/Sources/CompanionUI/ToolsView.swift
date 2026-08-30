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
