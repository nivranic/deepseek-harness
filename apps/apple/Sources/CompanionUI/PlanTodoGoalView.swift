import SwiftUI

/// The Plan / Todo / Goal pane for the open session: three sections read
/// live from the session view model's folded pane state, which updates with
/// every follow record.
public struct PlanTodoGoalView: View {
    private let sessionModel: RemoteSessionViewModel

    /// - Parameter sessionModel: the session view model owning the pane state.
    public init(sessionModel: RemoteSessionViewModel) {
        self.sessionModel = sessionModel
    }

    public var body: some View {
        let pane = sessionModel.planTodoGoal
        NavigationStack {
            List {
                if !pane.planActive && pane.todos.isEmpty && pane.goals.isEmpty {
                    Text("当前会话暂无计划、待办或目标。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("计划") {
                    Label(
                        pane.planActive ? "计划模式进行中" : "计划模式未开启",
                        systemImage: pane.planActive ? "square.and.pencil.circle.fill" : "circle.slash"
                    )
                }
                if !pane.todos.isEmpty {
                    Section("待办") {
                        ForEach(pane.todos) { todo in
                            HStack {
                                Text(todo.text)
                                Spacer()
                                Text(todo.status).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if !pane.goals.isEmpty {
                    Section("目标") {
                        ForEach(pane.goals) { goal in
                            HStack {
                                Text(goal.title)
                                Spacer()
                                Text(Self.phaseLabel(goal.state)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("计划")
        }
    }

    private static func phaseLabel(_ phase: String) -> String {
        switch phase {
        case "active": return "进行中"
        case "paused": return "已暂停"
        case "blocked": return "受阻"
        case "complete": return "已完成"
        default: return phase
        }
    }
}
