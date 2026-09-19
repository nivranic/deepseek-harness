package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.RemoteFailureClass
import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/**
 * Shell consumption of the shared Gateway failure contract: every class the
 * vocabulary distinguishes maps to one action and one presentation text, and
 * codes outside the vocabulary stay opaque diagnostics carrying the envelope
 * unchanged.
 */
class GatewayFailurePresentationTest {

    private fun present(code: String, message: String = ""): GatewayFailurePresentation =
        GatewayFailurePresenter.present(GatewayFailureEnvelope(code, message, null))

    @Test
    fun knownCodesMapToTheirClassActionAndText() {
        val cases: Map<String, Triple<RemoteFailureClass, GatewayFailureAction, String>> = mapOf(
            "gateway/authentication-required" to Triple(
                RemoteFailureClass.AUTHENTICATION, GatewayFailureAction.REAUTHENTICATE, "需要重新认证后再重试"),
            "gateway/permission-denied" to Triple(
                RemoteFailureClass.PERMISSION, GatewayFailureAction.ABANDON, "Host 拒绝了本次调用"),
            "gateway/host-not-ready" to Triple(
                RemoteFailureClass.HOST_STATE, GatewayFailureAction.RETRY_LATER, "Host 暂不可用，可稍后重试"),
            "host/capability-unavailable" to Triple(
                RemoteFailureClass.COMPATIBILITY, GatewayFailureAction.ABANDON, "客户端与 Host 版本不兼容，请升级后再连接"),
            "gateway/stream-invalid" to Triple(
                RemoteFailureClass.CARRIER_INVALID, GatewayFailureAction.ABANDON, "连接契约无效，请重新配对"),
            "gateway/transport-interrupted" to Triple(
                RemoteFailureClass.TRANSPORT, GatewayFailureAction.RETRY_LATER, "传输中断，重试时结果可能已生效"),
            "session/revision-conflict" to Triple(
                RemoteFailureClass.CONFLICT, GatewayFailureAction.REFRESH_AND_RETRY, "本地数据已过期，刷新后重试"),
            "workspace-file/not-found" to Triple(
                RemoteFailureClass.UNAVAILABLE, GatewayFailureAction.ABANDON, "目标不存在或已被移除"),
            "session/title-invalid" to Triple(
                RemoteFailureClass.INVALID_INPUT, GatewayFailureAction.FIX_INPUT, "请求内容无效，修改后重试"),
        )
        for ((code, expected) in cases) {
            val presentation = present(code)
            assertEquals(expected.first, presentation.failureClass, code)
            assertEquals(expected.second, presentation.action, code)
            assertEquals(expected.third, presentation.text, code)
        }
    }

    @Test
    fun everyClassCarriesADistinctActionTextPair() {
        // All ten classes produce a non-empty text and the three abandon-class
        // members agree; the mapping total stays explicit so adding a class to
        // the contract mirror forces a presentation decision here.
        val presented = RemoteFailureClass.entries.associateWith { failureClass ->
            val code = RemoteFailureClassEntriesTest.codeOf(failureClass)
            val presentation = present(code)
            assertEquals(failureClass, presentation.failureClass)
            presentation
        }
        assertEquals(10, presented.size)
        presented.values.forEach { presentation ->
            assertEquals(true, presentation.text.isNotEmpty())
        }
    }

    @Test
    fun unknownCodesStayOpaqueWithEnvelopeVerbatim() {
        val noMessage = present("private/file-binary")
        assertEquals(RemoteFailureClass.UNKNOWN, noMessage.failureClass)
        assertEquals(GatewayFailureAction.INSPECT_DIAGNOSTICS, noMessage.action)
        assertEquals("操作失败：private/file-binary", noMessage.text)

        val withMessage = present("session/gone", "no such session")
        assertEquals("操作失败：session/gone：no such session", withMessage.text)
    }

    @Test
    fun refusalLiftsIntoTheEnvelopeItCarries() {
        val details = WireValue.ObjectValue(mapOf("endpoint" to WireValue.StringValue("session/prompt")))
        val refused = LinkClientException.Refused("gateway/permission-denied", "not allowed", details)
        val envelope = GatewayFailureEnvelope.from(refused)
        assertEquals("gateway/permission-denied", envelope.code)
        assertEquals("not allowed", envelope.message)
        assertEquals(details, envelope.details)
        assertEquals(GatewayFailureAction.ABANDON, GatewayFailurePresenter.present(envelope).action)
    }

    @Test
    fun refusalWithoutDetailsKeepsANullEnvelopeField() {
        val envelope = GatewayFailureEnvelope.from(LinkClientException.Refused("incompatible-host", "unsupported"))
        assertNull(envelope.details)
        assertEquals("unsupported", envelope.message)
    }
}

/** Private helper keeping the per-class representative codes in one place. */
private object RemoteFailureClassEntriesTest {
    fun codeOf(failureClass: RemoteFailureClass): String = when (failureClass) {
        RemoteFailureClass.AUTHENTICATION -> "gateway/authentication-required"
        RemoteFailureClass.PERMISSION -> "gateway/permission-denied"
        RemoteFailureClass.HOST_STATE -> "gateway/host-not-ready"
        RemoteFailureClass.COMPATIBILITY -> "host/capability-unavailable"
        RemoteFailureClass.CARRIER_INVALID -> "gateway/stream-invalid"
        RemoteFailureClass.TRANSPORT -> "gateway/transport-interrupted"
        RemoteFailureClass.CONFLICT -> "session/revision-conflict"
        RemoteFailureClass.UNAVAILABLE -> "workspace-file/not-found"
        RemoteFailureClass.INVALID_INPUT -> "session/title-invalid"
        RemoteFailureClass.UNKNOWN -> "totally/private-code"
    }
}
