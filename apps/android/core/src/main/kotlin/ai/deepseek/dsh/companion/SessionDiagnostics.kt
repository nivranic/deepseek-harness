package ai.deepseek.dsh.companion

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Local retained projection counts do not establish complete Host history or current authorization. */
sealed interface SessionDiagnostics {
    data object Unavailable : SessionDiagnostics
    data object Unselected : SessionDiagnostics
    data class Selected(val counts: SessionProjectionCounts) : SessionDiagnostics
}

/** Collection sizes saturate at the JVM Int limit; identifiers, cursor and payloads are excluded. */
data class SessionProjectionCounts(
    val timelineRows: Int,
    val toolCalls: Int,
    val artifacts: Int,
    val images: Int,
    val todos: Int,
    val goals: Int,
) {
    val countsSaturated: Boolean
        get() = listOf(timelineRows, toolCalls, artifacts, images, todos, goals).any { it == Int.MAX_VALUE }

    companion object {
        internal fun capture(state: DomainState) = SessionProjectionCounts(
            state.items.size, state.toolCalls.size, state.artifacts.size,
            state.images.size, state.todos.size, state.goals.size,
        )
    }
}

internal fun SessionDiagnostics.toJson(): JsonObject = buildJsonObject {
    put("producer", "SessionModel")
    put("activityScope", "retained-local-projection")
    when (val value = this@toJson) {
        SessionDiagnostics.Unavailable -> put("observation", "unavailable")
        SessionDiagnostics.Unselected -> {
            put("observation", "current")
            put("selected", false)
        }
        is SessionDiagnostics.Selected -> {
            put("observation", "current")
            put("selected", true)
            put("snapshot", buildJsonObject {
                put("timelineRows", value.counts.timelineRows)
                put("toolCalls", value.counts.toolCalls)
                put("artifacts", value.counts.artifacts)
                put("images", value.counts.images)
                put("todos", value.counts.todos)
                put("goals", value.counts.goals)
                put("countsSaturated", value.counts.countsSaturated)
            })
        }
    }
}
