import SwiftUI

/// The Plan / Todo / Goal pane for the open session: three sections fed by
/// a snapshot source. Until the session-event contract models land, the
/// production source derives rows from projections; previews and tests use
/// the static source.
public struct PlanTodoGoalView: View {
    @State private var snapshot = PlanTodoGoalSnapshot.empty
    private let source: PlanTodoGoalSourcing
    private let sessionModel: RemoteSessionViewModel

    /// - Parameters:
    ///   - sessionModel: the session view model naming the open session.
    ///   - source: where the pane's snapshot loads from.
    public init(
        sessionModel: RemoteSessionViewModel,
        source: PlanTodoGoalSourcing = ProjectionPlanTodoGoalSource()
    ) {
        self.sessionModel = sessionModel
        self.source = source
    }

    public var body: some View {
        NavigationStack {
            List {
                if snapshot.planSteps.isEmpty && snapshot.todos.isEmpty && snapshot.goals.isEmpty {
                    Text("当前会话暂无计划、待办或目标。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if !snapshot.planSteps.isEmpty {
                    Section("计划") {
                        ForEach(snapshot.planSteps) { step in
                            Label(step.text, systemImage: step.done ? "checkmark.circle.fill" : "circle")
                        }
                    }
                }
                if !snapshot.todos.isEmpty {
                    Section("待办") {
                        ForEach(snapshot.todos) { todo in
                            HStack {
                                Text(todo.text)
                                Spacer()
                                Text(todo.status).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if !snapshot.goals.isEmpty {
                    Section("目标") {
                        ForEach(snapshot.goals) { goal in
                            HStack {
                                Text(goal.title)
                                Spacer()
                                Text(goal.state).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("计划")
        }
        .task(id: sessionModel.active?.sessionId) {
            guard let sessionId = sessionModel.active?.sessionId else {
                snapshot = .empty
                return
            }
            snapshot = await source.snapshot(sessionId: sessionId)
        }
    }
}

/// The production source: derives rows from the open session's projected
/// items. The full projection vocabulary rides the session-event contract
/// models; until they land this source keeps the pane empty rather than
/// guessing wire shapes.
public struct ProjectionPlanTodoGoalSource: PlanTodoGoalSourcing {
    public init() {}

    public func snapshot(sessionId: String) async -> PlanTodoGoalSnapshot {
        .empty
    }
}
