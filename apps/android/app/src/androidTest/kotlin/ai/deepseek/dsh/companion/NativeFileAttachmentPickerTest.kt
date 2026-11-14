package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Installed picker-result ownership tests use controlled sources; the Host e2e owns real SAF selection. */
class NativeFileAttachmentPickerTest {
    private class Source : NativeFileAttachmentSource {
        val names = AtomicInteger()
        val opens = AtomicInteger()
        val closes = AtomicInteger()
        override fun name(): String { names.incrementAndGet(); return "报告.bin" }
        override fun mediaType(): String = "image/png"
        override fun open(): InputStream {
            opens.incrementAndGet()
            return object : ByteArrayInputStream(byteArrayOf(0, 127, -1)) {
                override fun close() { closes.incrementAndGet(); super.close() }
            }
        }
        fun assertUntouched() { assertEquals(0, names.get()); assertEquals(0, opens.get()); assertEquals(0, closes.get()) }
    }

    private class Fixture {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val inputs = CompanionInputState.memory()
        val uploads = AtomicInteger()
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
                check(method in setOf("fileUploads/upload", "fileUploads/uploadImage")) { "Picker test must not submit another Host operation" }
                check(WireShape.string(WireValue.ObjectValue(args), "agentId") == "session")
                val request = checkNotNull(args["request"])
                val bytes = Base64.getDecoder().decode(checkNotNull(WireShape.string(request, "data")))
                val index = uploads.incrementAndGet()
                return WireValue.fromJsonElement(buildJsonObject {
                    put("receiptId", "receipt-$index")
                    put(if (method == "fileUploads/uploadImage") "image" else "file", buildJsonObject {
                        put("attachmentId", "attachment-$index")
                        put("name", checkNotNull(WireShape.string(request, "name")))
                        put("bytes", bytes.size)
                        if (method == "fileUploads/uploadImage") { put("mediaType", "image/png"); put("width", 1); put("height", 1) }
                    })
                })
            }
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow { awaitCancellation() }
        }
        val session = SessionModel(wire, scope, inputs = inputs)
        val model = NativeFileAttachmentsModel(wire, session, inputs, scope, NativeFileAttachmentLimits(16, 4096, 8))
        val picker = NativeFileAttachmentPicker()
        val store = ViewModelStore().also { it.put("picker", picker) }

        suspend fun select(id: String) { session.openSession(id); model.selectSession(id) }
        suspend fun close() {
            try { withTimeout(10_000) { model.closeAndAwait(); session.closeAndAwait() } }
            finally { store.clear(); scope.cancel() }
        }
    }

    private suspend fun withFixture(block: suspend (Fixture) -> Unit) = withContext(Dispatchers.Main) {
        val fixture = Fixture()
        try { withTimeout(10_000) { fixture.select("session"); block(fixture) } }
        finally { withContext(NonCancellable) { fixture.close() } }
    }

    @Test fun documentContractRequestsOneReadableFileAndRejectsCancelledOrMultipleResults() {
        val contract = NativeFileDocument()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = contract.createIntent(context, Unit)
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action)
        assertEquals("*/*", intent.type)
        assertTrue(intent.categories.contains(Intent.CATEGORY_OPENABLE))
        assertFalse(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, true))
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertEquals(0, intent.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        val uri = Uri.parse("content://picker-test/first")
        assertEquals(uri, contract.parseResult(Activity.RESULT_OK, Intent().setData(uri)))
        assertNull(contract.parseResult(Activity.RESULT_CANCELED, Intent().setData(uri)))
        val multiple = ClipData.newRawUri("files", uri).apply { addItem(ClipData.Item(Uri.parse("content://picker-test/second"))) }
        assertNull(contract.parseResult(Activity.RESULT_OK, Intent().setData(uri).apply { clipData = multiple }))
    }

    @Test fun photoContractRequestsOneImageThroughAndroidXPhotoPicker() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val contract = androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()
        val request = nativePhotoPickerRequest()
        assertEquals(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly, request.mediaType)
        val intent = contract.createIntent(context, request)
        assertEquals("image/*", intent.type)
        assertFalse(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
        assertNull(contract.parseResult(Activity.RESULT_CANCELED, Intent().setData(Uri.parse("content://picker-test/photo"))))
    }

    @Test fun photoAndFileCallbacksShareOneRetainedOwnerAndCannotConsumeEachOthersSelections() = runBlocking {
        withFixture { fixture ->
            assertNotNull(fixture.picker.begin(fixture.model, NativeAttachmentKind.IMAGE))
            assertNull(fixture.picker.begin(fixture.model))
            val retained = androidx.lifecycle.ViewModelProvider(fixture.store, androidx.lifecycle.ViewModelProvider.NewInstanceFactory())
                .get("picker", NativeFileAttachmentPicker::class.java)
            assertSame(fixture.picker, retained)
            val source = Source()
            retained.complete(source)
            source.assertUntouched(); assertTrue(retained.busy)
            retained.complete(source, NativeAttachmentKind.IMAGE)
            while (fixture.model.state.value.phase != NativeFileAttachmentPhase.IDLE || fixture.inputs.state.value.drafts["session"]?.attachments?.size != 1) delay(10)
            assertTrue(fixture.inputs.state.value.drafts.getValue("session").attachments.single() is SessionImageAttachment)
            assertEquals(1, fixture.uploads.get())
            val duplicate = Source()
            retained.complete(duplicate, NativeAttachmentKind.IMAGE)
            NativeFileAttachmentPicker().complete(duplicate, NativeAttachmentKind.IMAGE)
            duplicate.assertUntouched()
            assertEquals(1, fixture.uploads.get())
        }
    }

    @Test fun cancelledAndRetiredPhotoSelectionsCannotReviveThroughFileCallbacksOrSessionReturn() = runBlocking {
        withFixture { fixture ->
            assertNotNull(fixture.picker.begin(fixture.model, NativeAttachmentKind.IMAGE))
            fixture.picker.cancel(fixture.model)
            assertTrue(fixture.picker.busy); assertNull(fixture.picker.begin(fixture.model))
            val source = Source()
            fixture.picker.complete(source)
            assertTrue(fixture.picker.busy); source.assertUntouched()
            fixture.picker.complete(source, NativeAttachmentKind.IMAGE)
            assertFalse(fixture.picker.busy); source.assertUntouched()
            assertNotNull(fixture.picker.begin(fixture.model, NativeAttachmentKind.IMAGE))
            fixture.select("other-session"); fixture.select("session")
            fixture.picker.complete(source, NativeAttachmentKind.IMAGE)
            source.assertUntouched(); assertEquals(0, fixture.uploads.get())
        }
    }

    @Test fun duplicateAndRestoredResultsCannotReadOrUploadAgain() = runBlocking {
        withFixture { fixture ->
            val source = Source()
            assertNotNull(fixture.picker.begin(fixture.model))
            fixture.picker.complete(source)
            while (fixture.model.state.value.phase != NativeFileAttachmentPhase.IDLE || fixture.inputs.state.value.drafts["session"]?.attachments?.size != 1) delay(10)
            assertEquals(1, source.names.get()); assertEquals(1, source.opens.get()); assertEquals(1, source.closes.get())
            assertEquals(1, fixture.uploads.get())
            val duplicate = Source()
            fixture.picker.complete(duplicate)
            duplicate.assertUntouched()
            val restored = NativeFileAttachmentPicker()
            val restoredStore = ViewModelStore().also { it.put("restored", restored) }
            try { restored.complete(duplicate); duplicate.assertUntouched(); assertFalse(restored.busy) }
            finally { restoredStore.clear() }
            assertEquals(1, fixture.uploads.get())
            assertFalse(fixture.picker.busy)
        }
    }

    @Test fun cancelledPickerKeepsItsCallbackSlotAndCannotConsumeANewerSelection() = runBlocking {
        withFixture { fixture ->
            assertNotNull(fixture.picker.begin(fixture.model))
            fixture.picker.cancel(fixture.model)
            assertTrue(fixture.picker.busy)
            assertNull(fixture.picker.begin(fixture.model))
            val source = Source()
            fixture.picker.complete(source)
            source.assertUntouched()
            assertFalse(fixture.picker.busy)
            assertNotNull(fixture.picker.begin(fixture.model))
            fixture.picker.complete(null)
            assertFalse(fixture.picker.busy)
            assertEquals(0, fixture.uploads.get())
            assertTrue(fixture.inputs.state.value.drafts.isEmpty())
        }
    }

    @Test fun returningToTheSameSessionDoesNotReviveAnOldPickerResult() = runBlocking {
        withFixture { fixture ->
            assertNotNull(fixture.picker.begin(fixture.model))
            fixture.select("other-session")
            fixture.select("session")
            val source = Source()
            fixture.picker.complete(source)
            source.assertUntouched()
            assertFalse(fixture.picker.busy)
            assertEquals(0, fixture.uploads.get())
            assertTrue(fixture.inputs.state.value.drafts.isEmpty())
        }
    }

    @Test fun retiredHostModelCannotReadOrUploadIntoItsReplacement() = runBlocking {
        withFixture { previous ->
            withFixture { replacement ->
                assertNotNull(previous.picker.begin(previous.model))
                previous.model.closeAndAwait()
                val source = Source()
                previous.picker.complete(source)
                source.assertUntouched()
                assertEquals(0, previous.uploads.get()); assertEquals(0, replacement.uploads.get())
                assertTrue(previous.inputs.state.value.drafts.isEmpty())
                assertTrue(replacement.inputs.state.value.drafts.isEmpty())
            }
        }
    }

    @Test fun anEightFileDraftRefusesAnotherPickerWithoutReadingOrUploading() = runBlocking {
        withFixture { fixture ->
            repeat(8) { index ->
                assertTrue(fixture.session.addAttachment("session", SessionFileAttachment("receipt-$index", "attachment-$index", "file-$index.bin", 0)))
            }
            assertNull(fixture.picker.begin(fixture.model))
            assertFalse(fixture.picker.busy)
            assertEquals(NativeFileAttachmentIssue.TOO_MANY_FILES, fixture.model.state.value.issue)
            val source = Source()
            fixture.picker.complete(source)
            source.assertUntouched()
            assertEquals(0, fixture.uploads.get())
            assertEquals(8, fixture.inputs.state.value.drafts.getValue("session").attachments.size)
        }
    }
}
