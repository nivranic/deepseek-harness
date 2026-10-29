package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The chapter-70 minimized push vocabulary: reference data only. A push
 * names WHAT happened and WHERE — never source code, prompt, credential,
 * or diff content; details are fetched over the secure remote link after
 * the app opens. The relay (APNs/FCM) carries this same shape later.
 */
sealed interface CompanionPush {
    val sessionId: String

    /** One approval the host is waiting on. */
    data class ApprovalWaiting(override val sessionId: String, val eventId: String) : CompanionPush

    /** One question the host is waiting on. */
    data class QuestionWaiting(override val sessionId: String, val eventId: String) : CompanionPush

    /** One turn the open session completed. */
    data class TaskCompleted(override val sessionId: String, val turn: Int) : CompanionPush
}

/** The device-side localized title; no wire content ever rides it. */
fun pushTitle(push: CompanionPush): String = when (push) {
    is CompanionPush.ApprovalWaiting -> "宿主等待审批"
    is CompanionPush.QuestionWaiting -> "宿主等待答复"
    is CompanionPush.TaskCompleted -> "任务完成"
}

/** The device-side body line every push shares: details live behind the
 * secure link, not in the notification. */
fun pushBody(): String = "打开应用，经安全连接查看详情。"

/**
 * Parse one `$events` forward frame into a minimized push. Approval and
 * question titles and texts never ride the push — only the session and
 * event references are extracted; other frames project nothing.
 */
fun pushFromForward(frame: WireValue): CompanionPush? {
    val eventName = WireShape.string(frame, "event") ?: return null
    val sessionId = WireShape.string(frame, "sessionId") ?: return null
    val eventId = WireShape.string(frame, "eventId") ?: return null
    return when {
        eventName.contains("approval") -> CompanionPush.ApprovalWaiting(sessionId, eventId)
        eventName.contains("question") -> CompanionPush.QuestionWaiting(sessionId, eventId)
        else -> null
    }
}

/**
 * Parse one follow record for a completed turn end — the task-completed
 * push. Records that end a turn any other way project nothing.
 * @param record one `{type:"event", event:{…}}` follow frame.
 * @param openSessionId the session the record belongs to.
 */
fun pushFromTurnEnd(record: WireValue, openSessionId: String): CompanionPush? {
    val event = WireShape.objectValue(record, "event") ?: return null
    if (WireShape.string(event, "type") != "turn/end") return null
    val data = WireShape.objectValue(event, "data") ?: return null
    val reason = WireShape.objectValue(data, "reason") ?: return null
    if (WireShape.string(reason, "kind") != "completed") return null
    val turn = WireShape.number(data, "turn") ?: return null
    return CompanionPush.TaskCompleted(openSessionId, turn.toInt())
}

/**
 * The minimal host-to-companion push chain over the live `$events`
 * stream: each forwarded approval or question becomes one minimized push,
 * deduplicated by kind and event id, in arrival order. Presentation rides
 * the platform notifier; the payload vocabulary is the one the relay will
 * carry (chapter 70).
 */
class PushModel(private val wire: WireDriving, private val scope: CoroutineScope) {
    private val _pushes = MutableStateFlow<List<CompanionPush>>(emptyList())
    val pushes: StateFlow<List<CompanionPush>> = _pushes

    private var watchJob: Job? = null

    fun startWatching() {
        watchJob?.cancel()
        watchJob = scope.launch {
            wire.stream("\$events")
                .catch { }
                .collect { frame -> collect(frame) }
        }
    }

    fun stopWatching() {
        watchJob?.cancel()
        watchJob = null
    }

    fun collect(frame: WireValue) {
        val push = pushFromForward(frame) ?: return
        if (_pushes.value.contains(push)) return
        _pushes.update { current -> current + push }
    }
}
