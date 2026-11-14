package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.RemoteFailureClass
import ai.deepseek.dsh.link.WireValue
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Receipt guidance depends on the wire reason while the general Gateway classification stays intact. */
class PromptSubmissionFailureTest {
    private fun value(json: String) = WireValue.fromJsonElement(Json.parseToJsonElement(json))
    private fun failure(details: WireValue?, code: String = "session/attachment-invalid", message: String = "Host attachment refusal") =
        PromptSubmissionFailure("session", ConnectionFailure.REFUSED, GatewayFailureEnvelope(code, message, details))

    @Test fun `a missing staged file enables receipt guidance without changing its Gateway class`() {
        val failure = failure(value("""{"reason":"FILE_NOT_STAGED"}"""), message = "Host wording may change")
        assertTrue(failure.attachmentReceiptUnavailable)
        val presentation = GatewayFailurePresenter.present(failure.refusal!!)
        assertEquals(RemoteFailureClass.INVALID_INPUT, presentation.failureClass)
        assertEquals(GatewayFailureAction.FIX_INPUT, presentation.action)
    }

    @Test fun `a missing staged image enables the same receipt guidance`() {
        val failure = failure(value("""{"reason":"IMAGE_NOT_STAGED"}"""), message = "Image was not uploaded for this session.")
        assertTrue(failure.attachmentReceiptUnavailable)
    }

    @Test fun `other attachment reasons keep the general invalid input presentation`() {
        val unsupported = failure(value("""{"reason":"MODEL_DOES_NOT_SUPPORT_IMAGES"}"""))
        val future = failure(value("""{"reason":"FUTURE_ATTACHMENT_REASON"}"""), message = "File was not uploaded for this session.")
        assertFalse(unsupported.attachmentReceiptUnavailable)
        assertFalse(future.attachmentReceiptUnavailable)
        assertEquals(GatewayFailurePresentation(RemoteFailureClass.INVALID_INPUT, GatewayFailureAction.FIX_INPUT,
            "请求内容无效，修改后重试"), GatewayFailurePresenter.present(unsupported.refusal!!))
    }

    @Test fun `missing or incorrectly typed wire details do not imply an unavailable receipt`() {
        assertFalse(failure(null).attachmentReceiptUnavailable)
        assertFalse(failure(WireValue.NullValue).attachmentReceiptUnavailable)
        assertFalse(failure(WireValue.StringValue("FILE_NOT_STAGED")).attachmentReceiptUnavailable)
        assertFalse(failure(value("""["FILE_NOT_STAGED"]""")).attachmentReceiptUnavailable)
        assertFalse(failure(value("""{}""")).attachmentReceiptUnavailable)
        assertFalse(failure(value("""{"reason":null}""")).attachmentReceiptUnavailable)
        assertFalse(failure(value("""{"reason":42}""")).attachmentReceiptUnavailable)
        assertFalse(failure(value("""{"reason":["FILE_NOT_STAGED"]}""")).attachmentReceiptUnavailable)
    }

    @Test fun `known receipt reason text cannot override another Gateway code`() {
        val details = value("""{"reason":"FILE_NOT_STAGED"}""")
        assertFalse(failure(details, code = "gateway/permission-denied").attachmentReceiptUnavailable)
        assertFalse(failure(details, code = "FILE_NOT_STAGED").attachmentReceiptUnavailable)
    }

    @Test fun `a transport failure without a Gateway envelope has no receipt guidance`() {
        val failure = PromptSubmissionFailure("session", ConnectionFailure.TRANSPORT, null)
        assertFalse(failure.attachmentReceiptUnavailable)
    }
}
