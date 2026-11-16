package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import java.io.ByteArrayInputStream
import java.util.Base64
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.serialization.json.Json

internal fun sharedWireValue(value: String): WireValue = WireValue.fromJsonElement(Json.parseToJsonElement(value))

internal open class SharedSource(val bytes: ByteArray = byteArrayOf(7), val type: String? = null,
                                 val title: String? = "shared.bin") : NativeFileAttachmentSource {
    var names = 0
    var types = 0
    var opens = 0
    var closes = 0
    override fun name(): String? { names++; return title }
    override fun mediaType(): String? { types++; return type }
    override fun open() = object : ByteArrayInputStream(bytes) {
        init { opens++ }
        override fun close() { closes++; super.close() }
    }
}

internal class ShareStore : CompanionInputStoring {
    var saved: CompanionInputSnapshot? = null
    var fail = false
    var onSave: ((CompanionInputSnapshot) -> Unit)? = null
    override fun load() = saved
    override fun save(snapshot: CompanionInputSnapshot) {
        onSave?.invoke(snapshot)
        check(!fail)
        saved = snapshot
    }
    override fun preserveAndStartFresh() { saved = CompanionInputSnapshot() }
}

@OptIn(ExperimentalCoroutinesApi::class)
internal class ShareFixture(val test: TestScope, val inputs: CompanionInputState = CompanionInputState.memory(),
                           parent: CoroutineScope = test.backgroundScope,
                           limits: NativeFileAttachmentLimits = NativeFileAttachmentLimits(4, 4096, 8),
                           dispatcher: CoroutineDispatcher = StandardTestDispatcher(test.testScheduler)) {
    val wire = FakeWire()
    val session = SessionModel(wire, test.backgroundScope, inputs = inputs)
    val model = NativeFileAttachmentsModel(wire, session, inputs, parent, limits, dispatcher)
    private var nextReceipt = 0

    init {
        wire.stub("fileUploads/upload") { receipt(image = false) }
        wire.stub("fileUploads/uploadImage") { receipt(image = true) }
        wire.stub("session/prompt") { sharedWireValue("""{"accepted":true}""") }
    }

    suspend fun open() { session.openSession("session") }
    fun request(text: String = "", items: List<NativeShareItem> = emptyList(),
                allowed: Set<NativeAttachmentKind> = NativeAttachmentKind.entries.toSet()) =
        NativeShareRequest("session", session.selectionGeneration, text, items, allowed)
    fun importBatch(text: String = "", items: List<NativeShareItem> = emptyList()) =
        model.importShare(request(text, items), NativeShareLimits(64))

    fun receipt(image: Boolean, id: String = "receipt-${++nextReceipt}"): WireValue {
        if (image) return sharedWireValue("""{"receiptId":"$id","image":{"attachmentId":"image-$id","mediaType":"image/png","bytes":69,"width":1,"height":1}}""")
        val request = wire.calls.last().second.getValue("request")
        val size = Base64.getDecoder().decode(WireShape.string(request, "data")).size
        return sharedWireValue("""{"receiptId":"$id","file":{"attachmentId":"file-$id","name":"shared.bin","bytes":$size}}""")
    }
}
