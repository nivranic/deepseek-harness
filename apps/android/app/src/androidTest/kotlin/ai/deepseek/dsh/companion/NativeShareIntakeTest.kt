package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.text.SpannableString
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.contract.ActivityResultContract
import androidx.core.app.ActivityOptionsCompat
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Installed parser and owner cases keep all provider reads under explicit, captured-target import. */
class NativeShareIntakeTest {
    private val packageName get() = InstrumentationRegistry.getInstrumentation().targetContext.packageName
    private fun uri(name: String) = Uri.parse("content://share-test/$name")
    private fun shared(text: CharSequence = "shared", items: List<Uri> = emptyList(), type: String = "*/*"): Intent =
        Intent(if (items.size > 1) Intent.ACTION_SEND_MULTIPLE else Intent.ACTION_SEND).setType(type)
            .putExtra(Intent.EXTRA_TEXT, text).apply {
                if (items.size == 1) putExtra(Intent.EXTRA_STREAM, items.single())
                if (items.size > 1) putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(items))
            }
    private fun accepted(intent: Intent) = (parseNativeShareIntent(intent, packageName) as NativeShareParseResult.Accepted).payload
    private fun rejected(intent: Intent, issue: NativeShareRejection) {
        assertEquals(NativeShareParseResult.Rejected(issue), parseNativeShareIntent(intent, packageName))
    }

    @Test fun plainTextIsBoundedAndUrlsAndHtmlAreNeverInterpreted() {
        val body = "https://example.invalid/path <script>text</script>"
        val parsed = accepted(shared(SpannableString(body)).putExtra(Intent.EXTRA_HTML_TEXT, "<b>different</b>"))
        assertEquals(body, parsed.text); assertTrue(parsed.items.isEmpty())
        assertEquals(65_536, accepted(shared("a".repeat(65_536))).text.length)
        rejected(shared("a".repeat(65_537)), NativeShareRejection.TEXT_TOO_LARGE)
        rejected(shared("字".repeat(21_846)), NativeShareRejection.TEXT_TOO_LARGE)
        rejected(Intent(Intent.ACTION_SEND).setType("text/html").putExtra(Intent.EXTRA_HTML_TEXT, "<b>only</b>"), NativeShareRejection.EMPTY)
        assertEquals(NativeShareParseResult.Ignored, parseNativeShareIntent(Intent(Intent.ACTION_VIEW, uri("ignored")), packageName))
    }

    @Test fun streamExtrasOwnOrderingAndRepeatedOccurrencesWithoutDuplicatingClipData() {
        val values = listOf(uri("image"), uri("file"), uri("image"))
        val intent = shared(items = values).apply {
            clipData = ClipData.newRawUri("duplicate", values.first()).apply { addItem(ClipData.Item(uri("not-authoritative"))) }
        }
        assertEquals(values, accepted(intent).items.map { it.uri })
        val fallback = Intent(Intent.ACTION_SEND_MULTIPLE).setType("image/*").apply {
            clipData = ClipData.newRawUri("images", values[0]).apply { addItem(ClipData.Item(values[2])) }
        }
        val parsed = accepted(fallback)
        assertEquals(listOf(values[0], values[2]), parsed.items.map { it.uri }); assertTrue(parsed.items.all { it.requireImage })
        assertTrue(accepted(shared(items = listOf(uri("uppercase-image")), type = "IMAGE/PNG")).items.single().requireImage)
        assertEquals(8, accepted(shared(items = List(8) { uri("$it") })).items.size)
        rejected(shared(items = List(9) { uri("$it") }), NativeShareRejection.TOO_MANY)
    }

    @Test fun malformedStreamsAndNonContentOrPrivateUrisAndNestedIntentsAreRefused() {
        for (value in listOf("file:///private/file", "https://example.invalid/file", "content://$packageName.native-camera/camera-captures/private.jpg", "content://0@$packageName.native-camera/private")) {
            rejected(shared(items = listOf(Uri.parse(value))), NativeShareRejection.INVALID)
        }
        rejected(shared().putExtra(Intent.EXTRA_STREAM, "not a Parcelable Uri"), NativeShareRejection.INVALID)
        rejected(Intent(Intent.ACTION_SEND_MULTIPLE).putExtra(Intent.EXTRA_STREAM, uri("not-list")), NativeShareRejection.INVALID)
        rejected(shared().putExtra(Intent.EXTRA_TEXT, 42), NativeShareRejection.INVALID)
        rejected(shared(items = listOf(uri("valid"))).putExtra(Intent.EXTRA_INTENT, Intent(Intent.ACTION_VIEW)), NativeShareRejection.INVALID)
        rejected(shared(items = listOf(uri("valid"))).apply { clipData = ClipData.newIntent("nested", Intent(Intent.ACTION_VIEW)) }, NativeShareRejection.INVALID)
        rejected(Intent(Intent.ACTION_SEND).apply { clipData = ClipData.newRawUri("many", uri("a")).apply { addItem(ClipData.Item(uri("b"))) } }, NativeShareRejection.INVALID)
    }

    private class Source(private val type: String? = "application/octet-stream", private val fail: Boolean = false) : NativeFileAttachmentSource {
        val types = AtomicInteger(); val names = AtomicInteger(); val opens = AtomicInteger(); val closes = AtomicInteger()
        override fun mediaType(): String? { types.incrementAndGet(); return type }
        override fun name(): String { names.incrementAndGet(); return "share.bin" }
        override fun open(): ByteArrayInputStream {
            opens.incrementAndGet()
            if (fail) throw IOException("provider unavailable")
            return object : ByteArrayInputStream(byteArrayOf(7)) {
                override fun close() { closes.incrementAndGet(); super.close() }
            }
        }
        fun untouched() { assertEquals(0, types.get()); assertEquals(0, names.get()); assertEquals(0, opens.get()) }
    }

    private class Store : CompanionInputStoring {
        var failing = false
        override fun load(): CompanionInputSnapshot? = null
        override fun save(snapshot: CompanionInputSnapshot) { if (failing) throw IOException("input store unavailable") }
        override fun preserveAndStartFresh() = Unit
    }

    private class Fixture private constructor(val scope: CoroutineScope, val inputs: CompanionInputState) {
        val calls = mutableListOf<String>()
        var beforeUpload: suspend () -> Unit = {}
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
                check(method in setOf("fileUploads/upload", "fileUploads/uploadImage")) { "Share intake must not submit prompts" }
                calls.add(method); beforeUpload()
                val request = args.getValue("request")
                val bytes = Base64.getDecoder().decode(checkNotNull(WireShape.string(request, "data")))
                return WireValue.fromJsonElement(buildJsonObject {
                    put("receiptId", "receipt-${calls.size}")
                    put(if (method.endsWith("Image")) "image" else "file", buildJsonObject {
                        put("attachmentId", "attachment-${calls.size}"); put("name", "share.bin"); put("bytes", bytes.size)
                        if (method.endsWith("Image")) { put("mediaType", "image/png"); put("width", 1); put("height", 1) }
                    })
                })
            }
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow { awaitCancellation() }
        }
        val session = SessionModel(wire, scope, inputs = inputs)
        val model = NativeFileAttachmentsModel(wire, session, inputs, scope, NativeFileAttachmentLimits(16, 4096, 8))
        val savedState = SavedStateHandle()
        val owner = NativeShareIntake(savedState)
        val viewModels = ViewModelStore().also { it.put("share", owner) }
        val target get() = NativeShareTarget(model, inputs, NativeHostKey("fixture-host"), 1, "session", session.selectionGeneration)
        suspend fun close() { try { model.closeAndAwait(); session.closeAndAwait(); inputs.retireAndAwait() } finally { viewModels.clear(); scope.cancel() } }
        companion object {
            suspend fun create(store: CompanionInputStoring?): Fixture {
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
                val inputs = if (store == null) CompanionInputState.memory() else CompanionInputState.restore(store, scope)
                return Fixture(scope, inputs)
            }
        }
    }
    private suspend fun withFixture(store: CompanionInputStoring? = null, block: suspend (Fixture) -> Unit) = withContext(Dispatchers.Main) {
        val fixture = Fixture.create(store)
        try { withTimeout(10_000) { fixture.session.openSession("session"); block(fixture) } }
        finally { withContext(NonCancellable) { fixture.close() } }
    }
    private suspend fun settled(owner: NativeShareIntake) { while (owner.phase == NativeSharePhase.IMPORTING) delay(10) }
    private fun confirm(fixture: Fixture, sources: List<Source>, admitted: Boolean = true, kinds: Set<NativeAttachmentKind> = NativeAttachmentKind.entries.toSet()) {
        var index = 0
        fixture.owner.confirm(fixture.target, kinds, { fixture.target }, { admitted }) { sources[index++] }
    }

    @Test fun receptionRetainsOneDeliveryWithoutReadingAndRotationDoesNotReplayIt() = runBlocking {
        withFixture { fixture ->
            val source = Source()
            fixture.owner.onActivityCreated(shared("first", listOf(uri("a"))), false, packageName)
            source.untouched(); assertTrue(fixture.calls.isEmpty()); assertEquals(1L, fixture.owner.arrival)
            fixture.owner.receive(shared("second", listOf(uri("b"))), packageName)
            assertEquals("first", fixture.owner.payload!!.text); assertTrue(fixture.owner.incomingRejected)
            val retained = ViewModelProvider(fixture.viewModels, ViewModelProvider.NewInstanceFactory()).get("share", NativeShareIntake::class.java)
            assertSame(fixture.owner, retained)
            retained.onActivityCreated(shared("old startup"), true, packageName)
            assertEquals("first", retained.payload!!.text); assertEquals(1L, retained.arrival)
            retained.dismiss(); retained.receive(shared("first", listOf(uri("a"))), packageName)
            assertEquals(2L, retained.arrival); source.untouched(); assertTrue(fixture.calls.isEmpty())
        }
    }

    @Test fun processRestorationKeepsOnlyInterruptionMarkerAndAcceptsAnExplicitNewDelivery() = runBlocking {
        withFixture { fixture ->
            val intent = shared(items = listOf(uri("private-source")))
            fixture.owner.onActivityCreated(intent, false, packageName)
            val saved = fixture.savedState.keys().associateWith { fixture.savedState.get<Any>(it) }
            assertEquals(mapOf("native-share-disposition" to "pending"), saved)
            val restored = NativeShareIntake(SavedStateHandle(saved))
            restored.onActivityCreated(intent, true, packageName)
            assertEquals(NativeSharePhase.INTERRUPTED, restored.phase); assertNull(restored.payload); assertTrue(fixture.calls.isEmpty())
            restored.receive(intent, packageName)
            assertEquals(NativeSharePhase.REVIEW, restored.phase); assertEquals(uri("private-source"), restored.payload!!.items.single().uri)
            restored.dismiss()
        }
    }

    @Test fun historyLaunchWithoutSavedBundleCannotReplayOldUrisButLaterNewIntentCanBeReceived() {
        val owner = NativeShareIntake()
        val history = shared(items = listOf(uri("historic"))).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)
        owner.onActivityCreated(history, false, packageName)
        assertEquals(NativeSharePhase.INTERRUPTED, owner.phase); assertNull(owner.payload); assertEquals(0L, owner.arrival)
        owner.receive(shared(items = listOf(uri("historic"))), packageName)
        assertEquals(NativeSharePhase.REVIEW, owner.phase); assertEquals(1L, owner.arrival)
        assertEquals(uri("historic"), owner.payload!!.items.single().uri)
        owner.dismiss()
    }

    @Test fun explicitMixedImportPreservesTheDraftAndConsumesPendingWithoutPromptOrRepeatedUpload() = runBlocking {
        withFixture { fixture ->
            fixture.session.updateDraft("session", "existing")
            fixture.owner.receive(shared("shared", listOf(uri("a"), uri("b"))), packageName)
            val image = Source("image/png"); val file = Source()
            image.untouched(); file.untouched(); confirm(fixture, listOf(image, file)); settled(fixture.owner)
            assertEquals(NativeSharePhase.ADOPTED, fixture.owner.phase); assertNull(fixture.owner.payload)
            val draft = fixture.inputs.state.value.drafts.getValue("session")
            assertEquals("existing\n\nshared", draft.text)
            assertTrue(draft.attachments[0] is SessionImageAttachment); assertTrue(draft.attachments[1] is SessionFileAttachment)
            assertEquals(listOf("fileUploads/uploadImage", "fileUploads/upload"), fixture.calls)
            confirm(fixture, listOf(image, file)); assertEquals(2, fixture.calls.size)
            assertEquals(1, image.opens.get()); assertEquals(1, file.opens.get())
        }
    }

    @Test fun changedDisplayedTargetAndDisabledAdmissionCannotOpenProviderData() = runBlocking {
        withFixture { fixture ->
            fixture.owner.receive(shared(items = listOf(uri("a"))), packageName)
            val source = Source(); val previous = fixture.target
            fixture.owner.confirm(previous, NativeAttachmentKind.entries.toSet(), { previous.copy(hostGeneration = 2) }, { true }) { source }
            assertEquals(NativeShareIssue.STALE_TARGET, fixture.owner.issue); source.untouched()
            confirm(fixture, listOf(source), admitted = false)
            assertEquals(NativeShareIssue.BUSY, fixture.owner.issue); source.untouched(); assertTrue(fixture.calls.isEmpty())
            assertNotNull(fixture.owner.payload)
        }
    }

    @Test fun failedImportRetainsPendingForExplicitRetryWhileKnownUnavailableKindsNeverOpenBytes() = runBlocking {
        withFixture { fixture ->
            fixture.owner.receive(shared(items = listOf(uri("a")), type = "IMAGE/PNG"), packageName)
            val mismatched = Source("application/octet-stream")
            confirm(fixture, listOf(mismatched)); settled(fixture.owner)
            assertEquals(NativeFileAttachmentIssue.UNSUPPORTED_IMAGE, fixture.owner.attachmentIssue)
            assertEquals(0, mismatched.opens.get()); assertTrue(fixture.calls.isEmpty())
            val image = Source("image/png")
            confirm(fixture, listOf(image), kinds = setOf(NativeAttachmentKind.FILE)); settled(fixture.owner)
            assertEquals(NativeSharePhase.FAILED, fixture.owner.phase); assertEquals(NativeShareIssue.KIND_UNAVAILABLE, fixture.owner.issue)
            assertEquals(0, image.opens.get()); assertEquals(0, image.names.get()); assertNotNull(fixture.owner.payload)
            confirm(fixture, listOf(Source("image/png", fail = true))); settled(fixture.owner)
            assertEquals(NativeSharePhase.FAILED, fixture.owner.phase); assertTrue(fixture.calls.isEmpty())
            confirm(fixture, listOf(Source("image/png"))); settled(fixture.owner)
            assertEquals(NativeSharePhase.ADOPTED, fixture.owner.phase); assertEquals(1, fixture.calls.size)
        }
    }

    @Test fun adoptedButUnflushedImportConsumesPendingAndOnlyStorageRetryRemains() = runBlocking {
        val store = Store()
        withFixture(store) { fixture ->
            fixture.session.updateDraft("session", "existing"); fixture.inputs.flush()
            fixture.owner.receive(shared(items = listOf(uri("a"))), packageName)
            store.failing = true
            confirm(fixture, listOf(Source())); settled(fixture.owner)
            assertEquals(NativeSharePhase.SAVE_FAILED, fixture.owner.phase); assertNull(fixture.owner.payload)
            assertEquals(1, fixture.inputs.state.value.drafts.getValue("session").attachments.size)
            confirm(fixture, listOf(Source())); assertEquals(1, fixture.calls.size)
            store.failing = false; fixture.inputs.flush(); assertEquals(1, fixture.calls.size)
            val otherHostInputs = CompanionInputState.memory()
            fixture.owner.observePersistence(otherHostInputs, InputPersistenceStatus.SAVED)
            assertEquals(NativeSharePhase.SAVE_FAILED, fixture.owner.phase)
            fixture.owner.observePersistence(fixture.inputs, fixture.inputs.persistence.value)
            assertEquals(NativeSharePhase.ADOPTED, fixture.owner.phase)
            otherHostInputs.retireAndAwait()
        }
    }

    @Test fun targetChangeDuringImportCancelsOldOwnershipAndDoesNotImportIntoReplacement() = runBlocking {
        withFixture { fixture ->
            val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            fixture.beforeUpload = { entered.complete(Unit); withContext(NonCancellable) { release.await() } }
            fixture.owner.receive(shared(items = listOf(uri("a"))), packageName)
            try {
                confirm(fixture, listOf(Source())); entered.await()
                fixture.owner.observeTarget(fixture.target.copy(hostGeneration = 2))
                fixture.owner.receive(shared("must not replace"), packageName)
                assertTrue(fixture.owner.incomingRejected); assertEquals("shared", fixture.owner.payload!!.text)
                release.complete(Unit); settled(fixture.owner)
                assertEquals(NativeShareIssue.STALE_TARGET, fixture.owner.issue); assertTrue(fixture.inputs.state.value.drafts.isEmpty())
                assertEquals(1, fixture.calls.size); assertNotNull(fixture.owner.payload)
            } finally { release.complete(Unit) }
        }
    }

    private class Registry : ActivityResultRegistry() {
        var requestCode = 0
        override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) { this.requestCode = requestCode }
    }

    @Test fun incomingShareDoesNotConsumePendingSafOrCameraAndSystemCancellationReleasesTheirTickets() = runBlocking {
        withFixture { fixture ->
            val picker = NativeFileAttachmentPicker(); val models = ViewModelStore().also { it.put("picker", picker) }
            val registry = Registry()
            try {
                assertNotNull(picker.begin(fixture.model))
                val saf = registry.register("saf", NativeFileDocument()) { picker.complete(null) }
                saf.launch(Unit)
                fixture.owner.receive(shared("pending text"), packageName)
                assertTrue(picker.busy); assertEquals(NativeSharePhase.REVIEW, fixture.owner.phase); assertTrue(fixture.calls.isEmpty())
                assertTrue(registry.dispatchResult(registry.requestCode, Activity.RESULT_CANCELED, null)); assertFalse(picker.busy); saf.unregister()
                val cameraFiles = NativeCameraFiles.get(InstrumentationRegistry.getInstrumentation().targetContext)
                val capture = checkNotNull(picker.beginCamera(fixture.model, cameraFiles))
                val camera = registry.register(capture.name, NativeCameraPicture()) { picker.completeCamera(capture.name, it) }
                camera.launch(checkNotNull(picker.takeCameraLaunch(capture.name)))
                fixture.owner.receive(shared("second share"), packageName)
                assertTrue(fixture.owner.incomingRejected); assertTrue(picker.busy)
                assertTrue(registry.dispatchResult(registry.requestCode, Activity.RESULT_CANCELED, null))
                while (picker.busy) delay(10)
                camera.unregister(); assertFalse(java.io.File(cameraFiles.directory, capture.name).exists())
                assertEquals("pending text", fixture.owner.payload!!.text); assertTrue(fixture.calls.isEmpty())
                confirm(fixture, emptyList()); settled(fixture.owner)
                assertEquals("pending text", fixture.inputs.state.value.drafts.getValue("session").text); assertTrue(fixture.calls.isEmpty())
            } finally { models.clear() }
        }
    }
}
