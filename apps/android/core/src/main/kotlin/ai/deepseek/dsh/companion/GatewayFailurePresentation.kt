package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.RemoteFailureClass
import ai.deepseek.dsh.contract.RemoteFailureClasses
import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue

/**
 * One Gateway failure envelope exactly as the wire carried it. The shell
 * consumes the shared Remote failure contract through this value: the code
 * classifies through [RemoteFailureClasses], and the message and details stay
 * available unchanged for diagnostics.
 */
data class GatewayFailureEnvelope(val code: String, val message: String, val details: WireValue?) {
    companion object {
        /** Lift a Gateway refusal into the envelope it carries. */
        fun from(failure: LinkClientException.Refused): GatewayFailureEnvelope =
            GatewayFailureEnvelope(failure.code, failure.envelopeMessage, failure.details)
    }
}

/** What the shell suggests the user may do next for one failure class. */
enum class GatewayFailureAction(val wire: String) {
    /** Re-authenticate, then retry the same call explicitly. */
    REAUTHENTICATE("reauthenticate"),

    /** The unchanged request cannot succeed; abandon or change it. */
    ABANDON("abandon"),

    /** The Host or transport may recover; retrying later is safe. */
    RETRY_LATER("retry-later"),

    /** Local state is stale; refresh it, then retry. */
    REFRESH_AND_RETRY("refresh-and-retry"),

    /** The request input is invalid; change it before retrying. */
    FIX_INPUT("fix-input"),

    /** No shared semantics; present code, message and details unchanged. */
    INSPECT_DIAGNOSTICS("inspect-diagnostics"),
}

/** The classified presentation of one Gateway failure. */
data class GatewayFailurePresentation(
    val failureClass: RemoteFailureClass,
    val action: GatewayFailureAction,
    val text: String,
)

/**
 * Maps one Gateway failure envelope onto the shared classification and the
 * shell's presentation of it. Known classes get class-level copy; codes the
 * shared vocabulary does not know stay presentable as opaque diagnostics
 * (code and message verbatim, details retained on the envelope).
 */
object GatewayFailurePresenter {

    /** Classify and present one envelope. */
    fun present(envelope: GatewayFailureEnvelope): GatewayFailurePresentation {
        val failureClass = RemoteFailureClasses.classify(envelope.code)
        return GatewayFailurePresentation(failureClass, actionOf(failureClass), textOf(failureClass, envelope))
    }

    private fun actionOf(failureClass: RemoteFailureClass): GatewayFailureAction = when (failureClass) {
        RemoteFailureClass.AUTHENTICATION -> GatewayFailureAction.REAUTHENTICATE
        RemoteFailureClass.PERMISSION,
        RemoteFailureClass.COMPATIBILITY,
        RemoteFailureClass.CARRIER_INVALID,
        RemoteFailureClass.UNAVAILABLE,
        -> GatewayFailureAction.ABANDON
        RemoteFailureClass.HOST_STATE,
        RemoteFailureClass.TRANSPORT,
        -> GatewayFailureAction.RETRY_LATER
        RemoteFailureClass.CONFLICT -> GatewayFailureAction.REFRESH_AND_RETRY
        RemoteFailureClass.INVALID_INPUT -> GatewayFailureAction.FIX_INPUT
        RemoteFailureClass.UNKNOWN -> GatewayFailureAction.INSPECT_DIAGNOSTICS
    }

    private fun textOf(failureClass: RemoteFailureClass, envelope: GatewayFailureEnvelope): String = when (failureClass) {
        RemoteFailureClass.AUTHENTICATION -> "需要重新认证后再重试"
        RemoteFailureClass.PERMISSION -> "Host 拒绝了本次调用"
        RemoteFailureClass.HOST_STATE -> "Host 暂不可用，可稍后重试"
        RemoteFailureClass.COMPATIBILITY -> "客户端与 Host 版本不兼容，请升级后再连接"
        RemoteFailureClass.CARRIER_INVALID -> "连接契约无效，请重新配对"
        RemoteFailureClass.TRANSPORT -> "传输中断，重试时结果可能已生效"
        RemoteFailureClass.CONFLICT -> "本地数据已过期，刷新后重试"
        RemoteFailureClass.UNAVAILABLE -> "目标不存在或已被移除"
        RemoteFailureClass.INVALID_INPUT -> "请求内容无效，修改后重试"
        RemoteFailureClass.UNKNOWN ->
            if (envelope.message.isEmpty()) "操作失败：${envelope.code}" else "操作失败：${envelope.code}：${envelope.message}"
    }
}
