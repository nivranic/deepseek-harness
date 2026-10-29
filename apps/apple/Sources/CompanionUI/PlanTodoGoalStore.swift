import Foundation

/// Read-only snapshot for the Plan / Todo / Goal pane, folded by the session
/// view model from the session-event contract models (`plan/mode`,
/// `todo/write`, `goal/change`). All three are whole-value states on the
/// wire, so the fold is last-write-wins and this value is the complete
/// current pane state.
public struct PlanTodoGoalSnapshot: Equatable {
    public struct TodoItem: Identifiable, Equatable {
        public let id: String
        public let text: String
        /// Wire status verbatim: `pending`, `in_progress`, or `completed`.
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
        /// Wire phase verbatim: `active`, `paused`, `blocked`, or `complete`.
        public let state: String

        public init(id: String, title: String, state: String) {
            self.id = id
            self.title = title
            self.state = state
        }
    }

    /// Whether plan mode is in force; false before the first `plan/mode`.
    public var planActive: Bool
    public var todos: [TodoItem]
    public var goals: [GoalRecord]

    public init(planActive: Bool = false, todos: [TodoItem] = [], goals: [GoalRecord] = []) {
        self.planActive = planActive
        self.todos = todos
        self.goals = goals
    }

    /// The empty snapshot shown before any pane event arrives.
    public static let empty = PlanTodoGoalSnapshot()
}
