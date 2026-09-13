/// Counts describe the selected model's retained projection, not the complete Host log or current authorization.
public struct CompanionSessionDiagnostics: Encodable, Sendable, Equatable {
    let producer = "RemoteSessionViewModel"
    let activityScope = "retained-local-projection"
    let observation: String
    let selected: Bool?
    let snapshot: Counts?

    /// An absent model supplies no selection or counts.
    public static var unavailable: Self { Self(observation: "unavailable", selected: nil, snapshot: nil) }

    static var unselected: Self { Self(observation: "current", selected: false, snapshot: nil) }

    init(counts: Counts) {
        observation = "current"
        selected = true
        snapshot = counts
    }

    private init(observation: String, selected: Bool?, snapshot: Counts?) {
        self.observation = observation
        self.selected = selected
        self.snapshot = snapshot
    }

    /// Saturation is explicit; payloads, identifiers and cursor values never enter this value.
    struct Counts: Encodable, Sendable, Equatable {
        let timelineRows: UInt32
        let toolCalls: UInt32
        let artifacts: UInt32
        let images: UInt32
        let todos: UInt32
        let goals: UInt32
        let countsSaturated: Bool

        init(timelineRows: Int, toolCalls: Int, artifacts: Int, images: Int, todos: Int, goals: Int) {
            self.timelineRows = UInt32(clamping: timelineRows)
            self.toolCalls = UInt32(clamping: toolCalls)
            self.artifacts = UInt32(clamping: artifacts)
            self.images = UInt32(clamping: images)
            self.todos = UInt32(clamping: todos)
            self.goals = UInt32(clamping: goals)
            countsSaturated = [timelineRows, toolCalls, artifacts, images, todos, goals].contains { $0 >= Int(UInt32.max) }
        }
    }
}
