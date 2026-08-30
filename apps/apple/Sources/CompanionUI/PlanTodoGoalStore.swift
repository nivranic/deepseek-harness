import Foundation

/// Read-only snapshots for the Plan / Todo / Goal pane. The pane renders
/// whatever the host projects; the wire endpoints that fill these rows ride
/// the session-event contract models and arrive with them — the store
/// protocol keeps the surface honest about that boundary today.
public struct PlanTodoGoalSnapshot: Equatable {
    public struct PlanStep: Identifiable, Equatable {
        public let id: String
        public let text: String
        public let done: Bool

        public init(id: String, text: String, done: Bool) {
            self.id = id
            self.text = text
            self.done = done
        }
    }

    public struct TodoItem: Identifiable, Equatable {
        public let id: String
        public let text: String
        public let status: String

        public init(id: String, text: String, status: String) {
            self.id = id
            self.text = text
            self.status = status
        }
    }

    public struct GoalRecord: Identifiable, Equatable {
        public let id: String
        public let title: String
        public let state: String

        public init(id: String, title: String, state: String) {
            self.id = id
            self.title = title
            self.state = state
        }
    }

    public var planSteps: [PlanStep]
    public var todos: [TodoItem]
    public var goals: [GoalRecord]

    public init(planSteps: [PlanStep] = [], todos: [TodoItem] = [], goals: [GoalRecord] = []) {
        self.planSteps = planSteps
        self.todos = todos
        self.goals = goals
    }

    /// The empty snapshot shown before the host projects anything.
    public static let empty = PlanTodoGoalSnapshot()
}

/// Where the pane's snapshots come from. The production source derives rows
/// from the session's projections; previews and tests inject snapshots.
public protocol PlanTodoGoalSourcing {
    /// Load the snapshot for one session.
    /// - Parameter sessionId: the open session.
    /// - Returns: the projected rows.
    func snapshot(sessionId: String) async -> PlanTodoGoalSnapshot
}

/// A fixed source, for previews and tests.
public struct StaticPlanTodoGoalSource: PlanTodoGoalSourcing {
    private let snapshot: PlanTodoGoalSnapshot

    /// - Parameter snapshot: the rows every load returns.
    public init(snapshot: PlanTodoGoalSnapshot) {
        self.snapshot = snapshot
    }

    public func snapshot(sessionId: String) async -> PlanTodoGoalSnapshot {
        snapshot
    }
}
