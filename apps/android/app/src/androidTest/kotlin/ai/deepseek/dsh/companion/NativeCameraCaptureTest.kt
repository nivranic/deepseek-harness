package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.contract.ActivityResultContract
import androidx.core.app.ActivityOptionsCompat
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Installed tests exercise private FileProvider outputs and AndroidX result dispatch; Host e2e drives the camera app. */
class NativeCameraCaptureTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val files get() = NativeCameraFiles.get(context)
    private fun jpeg(): ByteArray = ByteArrayOutputStream().use { output ->
        val bitmap = Bitmap.createBitmap(2, 3, Bitmap.Config.ARGB_8888)
        try { check(bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output)); output.toByteArray() }
        finally { bitmap.recycle() }
    }
    private fun write(output: NativeCameraOutput, bytes: ByteArray = jpeg()) {
        context.contentResolver.openOutputStream(output.uri, "w")!!.use { it.write(bytes) }
    }
    private suspend fun settled(picker: NativeFileAttachmentPicker) { while (picker.busy) delay(10) }
    private suspend fun cleaned(output: NativeCameraOutput) { while (File(files.directory, output.name).exists()) delay(10) }

    private class Fixture {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val inputs = CompanionInputState.memory()
        val uploads = AtomicInteger()
        var beforeUpload: suspend () -> Unit = {}
        var uploaded: ByteArray? = null
        val wire = object : WireDriving {
            override suspend fun call(method: String, args: Map<String, WireValue>): WireValue {
                check(method == "fileUploads/uploadImage")
                check(WireShape.string(WireValue.ObjectValue(args), "agentId") == "session")
                val request = checkNotNull(args["request"])
                check(WireShape.string(request, "mediaType") == "image/jpeg")
                val bytes = Base64.getDecoder().decode(checkNotNull(WireShape.string(request, "data")))
                beforeUpload(); uploaded = bytes
                val index = uploads.incrementAndGet()
                return WireValue.fromJsonElement(buildJsonObject {
                    put("receiptId", "camera-$index")
                    put("image", buildJsonObject {
                        put("attachmentId", "image-$index"); put("mediaType", "image/jpeg")
                        put("name", checkNotNull(WireShape.string(request, "name")))
                        put("bytes", bytes.size); put("width", 2); put("height", 3)
                    })
                })
            }
            override fun stream(endpoint: String, payload: Map<String, WireValue>): Flow<WireValue> = flow { awaitCancellation() }
        }
        val session = SessionModel(wire, scope, inputs = inputs)
        val model = NativeFileAttachmentsModel(wire, session, inputs, scope, NativeFileAttachmentLimits(512 * 1024, 1024 * 1024, 8))
        val savedState = SavedStateHandle()
        val picker = NativeFileAttachmentPicker(savedState)
        val store = ViewModelStore().also { it.put("picker", picker) }
        suspend fun select(id: String) { session.openSession(id); model.selectSession(id) }
        suspend fun close() {
            try { model.closeAndAwait(); session.closeAndAwait() }
            finally { store.clear(); scope.cancel() }
        }
    }
    private suspend fun withFixture(block: suspend (Fixture) -> Unit) = withContext(Dispatchers.Main) {
        val fixture = Fixture()
        try { withTimeout(10_000) { fixture.select("session"); block(fixture) } }
        finally { withContext(NonCancellable) { fixture.close() } }
    }

    @Test fun fullSizeContractGrantsOnlyTemporaryOutputAuthorityThroughPrivateProvider() {
        val output = files.create()
        try {
            val contract = NativeCameraPicture()
            val intent = contract.createIntent(context, output.uri)
            assertEquals(MediaStore.ACTION_IMAGE_CAPTURE, intent.action)
            assertEquals(output.uri, intent.getParcelableExtra(MediaStore.EXTRA_OUTPUT, Uri::class.java))
            assertEquals(output.uri, intent.clipData!!.getItemAt(0).uri)
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION, intent.flags)
            assertTrue(contract.parseResult(Activity.RESULT_OK, null))
            assertFalse(contract.parseResult(Activity.RESULT_CANCELED, Intent()))
            val provider = context.packageManager.resolveContentProvider("${context.packageName}.native-camera", 0)!!
            assertFalse(provider.exported); assertTrue(provider.grantUriPermissions)
            val permissions = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
            assertTrue(permissions.none { it in setOf("android.permission.CAMERA", "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE") })
            val bytes = jpeg(); write(output, bytes)
            assertArrayEquals(bytes, output.open().use { it.readBytes() })
        } finally { output.close() }
    }

    @Test fun retainedCameraOwnerIgnoresPhotosAndDeletesOutputOnlyAfterImageUploadSettles() = runBlocking {
        withFixture { fixture ->
            val output = checkNotNull(fixture.picker.beginCamera(fixture.model, files)); val bytes = jpeg(); write(output, bytes)
            val retained = ViewModelProvider(fixture.store, ViewModelProvider.NewInstanceFactory()).get("picker", NativeFileAttachmentPicker::class.java)
            assertSame(fixture.picker, retained)
            assertEquals(output.uri, retained.takeCameraLaunch(output.name)); assertNull(retained.takeCameraLaunch(output.name))
            val untouched = object : NativeFileAttachmentSource {
                override fun name(): String = error("Photo callback cannot consume Camera")
                override fun open() = error("Photo callback cannot read Camera")
            }
            retained.complete(untouched, NativeAttachmentKind.IMAGE); retained.invalidResult(NativeAttachmentKind.IMAGE)
            assertTrue(retained.busy); assertNull(retained.begin(fixture.model)); assertEquals(0, fixture.uploads.get())
            val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            fixture.beforeUpload = { entered.complete(Unit); release.await() }
            try {
                retained.completeCamera(output.name, true); entered.await()
                assertTrue(File(files.directory, output.name).exists()); assertTrue(retained.busy)
            } finally { release.complete(Unit) }
            settled(retained)
            assertFalse(File(files.directory, output.name).exists()); assertNull(retained.cameraName)
            assertArrayEquals(bytes, fixture.uploaded); assertEquals(1, fixture.uploads.get())
            assertTrue(fixture.inputs.state.value.drafts.getValue("session").attachments.single() is SessionImageAttachment)
            retained.completeCamera(output.name, true); assertEquals(1, fixture.uploads.get())
        }
    }

    @Test fun cancelledAndFailedLaunchesCleanOutputsAndPermitSubsequentSelections() = runBlocking {
        withFixture { fixture ->
            val first = checkNotNull(fixture.picker.beginCamera(fixture.model, files))
            fixture.picker.completeCamera(first.name, false); settled(fixture.picker)
            assertFalse(File(files.directory, first.name).exists())
            val second = checkNotNull(fixture.picker.beginCamera(fixture.model, files))
            fixture.picker.cameraLaunchFailed(second.name); settled(fixture.picker)
            assertFalse(File(files.directory, second.name).exists()); assertTrue(fixture.picker.failedFor(fixture.model, "session"))
            assertNotNull(fixture.picker.begin(fixture.model)); fixture.picker.complete(null)
            assertNotNull(fixture.picker.begin(fixture.model, NativeAttachmentKind.IMAGE)); fixture.picker.complete(null, NativeAttachmentKind.IMAGE)
            val third = checkNotNull(fixture.picker.beginCamera(fixture.model, files))
            fixture.picker.cancel(fixture.model); settled(fixture.picker)
            assertFalse(File(files.directory, third.name).exists()); assertEquals(0, fixture.uploads.get())
        }
    }

    private class Registry : ActivityResultRegistry() {
        var requestCode = 0
        override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
            this.requestCode = requestCode
        }
    }

    @Test fun cleanedLaunchedCameraConsumesItsLateRegistryResultBeforeAdmittingAnyNewPicker() = runBlocking {
        withFixture { fixture ->
            val registry = Registry()
            val first = checkNotNull(fixture.picker.beginCamera(fixture.model, files))
            var callbacks = 0
            val launcher = registry.register(first.name, NativeCameraPicture()) { result -> callbacks++; fixture.picker.completeCamera(first.name, result) }
            launcher.launch(checkNotNull(fixture.picker.takeCameraLaunch(first.name)))
            val oldRequest = registry.requestCode
            fixture.picker.cancel(fixture.model); cleaned(first)
            while (fixture.model.state.value.phase == NativeFileAttachmentPhase.CLEANING) delay(10)
            assertTrue(fixture.picker.busy); assertEquals(first.name, fixture.picker.cameraName)
            assertNull(fixture.picker.begin(fixture.model)); assertNull(fixture.picker.begin(fixture.model, NativeAttachmentKind.IMAGE))
            assertNull(fixture.picker.beginCamera(fixture.model, files))
            assertTrue(registry.dispatchResult(oldRequest, Activity.RESULT_OK, Intent().putExtra("discarded", "late-camera")))
            settled(fixture.picker); assertEquals(1, callbacks); assertEquals(0, fixture.uploads.get())
            assertNull(fixture.picker.cameraName); launcher.unregister()
            val saved = Bundle(); registry.onSaveInstanceState(saved)
            val restored = Registry(); restored.onRestoreInstanceState(saved)
            val stale = restored.register(first.name, NativeCameraPicture()) { callbacks++ }
            assertEquals(1, callbacks); stale.unregister()
            assertNotNull(fixture.picker.begin(fixture.model)); fixture.picker.complete(null)
            assertNotNull(fixture.picker.begin(fixture.model, NativeAttachmentKind.IMAGE)); fixture.picker.complete(null, NativeAttachmentKind.IMAGE)
            val next = checkNotNull(fixture.picker.beginCamera(fixture.model, files))
            val nextLauncher = restored.register(next.name, NativeCameraPicture()) { fixture.picker.completeCamera(next.name, it) }
            try {
                nextLauncher.launch(checkNotNull(fixture.picker.takeCameraLaunch(next.name)))
                assertNotEquals(oldRequest, restored.requestCode)
                assertFalse(restored.dispatchResult(oldRequest, Activity.RESULT_OK, Intent()))
                assertTrue(fixture.picker.busy)
                restored.dispatchResult(restored.requestCode, Activity.RESULT_CANCELED, null); settled(fixture.picker)
                assertEquals(0, fixture.uploads.get())
            } finally { nextLauncher.unregister() }
        }
    }

    @Test fun SessionAndHostRetirementCannotReviveCapturedCameraAuthority() = runBlocking {
        withFixture { fixture ->
            val stale = checkNotNull(fixture.picker.beginCamera(fixture.model, files)); write(stale)
            fixture.picker.takeCameraLaunch(stale.name)
            fixture.select("other"); fixture.select("session")
            fixture.picker.completeCamera(stale.name, true); settled(fixture.picker)
            assertFalse(File(files.directory, stale.name).exists()); assertEquals(0, fixture.uploads.get())
            val retired = checkNotNull(fixture.picker.beginCamera(fixture.model, files)); write(retired)
            fixture.picker.takeCameraLaunch(retired.name); fixture.model.closeAndAwait()
            fixture.picker.completeCamera(retired.name, true); settled(fixture.picker)
            assertFalse(File(files.directory, retired.name).exists()); assertEquals(0, fixture.uploads.get())
            assertTrue(fixture.inputs.state.value.drafts.isEmpty())
        }
    }

    @Test fun processRestoredRegistryDiscardsOutstandingCameraResultBeforeOrAfterCleanupWithoutReupload() = runBlocking {
        for (resultFirst in listOf(false, true)) withFixture { fixture ->
            val original = Registry()
            val output = checkNotNull(fixture.picker.beginCamera(fixture.model, files))
            val launcher = original.register(output.name, NativeCameraPicture()) { fixture.picker.completeCamera(output.name, it) }
            launcher.launch(checkNotNull(fixture.picker.takeCameraLaunch(output.name)))
            val requestCode = original.requestCode
            val registryState = Bundle(); original.onSaveInstanceState(registryState)
            val pickerState = SavedStateHandle(fixture.savedState.keys().associateWith { fixture.savedState.get<Any>(it) })
            assertEquals(true, pickerState.get<Boolean>("native-camera-awaiting-result"))
            launcher.unregister(); fixture.model.closeAndAwait()
            val recoveredFile = File(files.directory, output.name).apply { writeBytes(jpeg()) }
            val restoredPicker = NativeFileAttachmentPicker(pickerState)
            val store = ViewModelStore().also { it.put("restored", restoredPicker) }
            val restoredRegistry = Registry().apply { onRestoreInstanceState(registryState) }
            var callbacks = 0
            val restoredLauncher = restoredRegistry.register(output.name, NativeCameraPicture()) {
                callbacks++; restoredPicker.completeCamera(output.name, it)
            }
            try {
                assertNull(restoredPicker.takeCameraLaunch(output.name))
                if (resultFirst) assertTrue(restoredRegistry.dispatchResult(requestCode, Activity.RESULT_OK, Intent()))
                restoredPicker.restoreCamera(files)
                while (recoveredFile.exists()) delay(10)
                if (!resultFirst) {
                    assertTrue(restoredPicker.busy); assertEquals(output.name, restoredPicker.cameraName)
                    assertTrue(restoredRegistry.dispatchResult(requestCode, Activity.RESULT_OK, Intent()))
                }
                settled(restoredPicker)
                assertNull(restoredPicker.cameraName); assertEquals(1, callbacks); assertEquals(0, fixture.uploads.get())
                assertTrue(pickerState.keys().isEmpty())
                restoredLauncher.unregister()
                val consumedState = Bundle(); restoredRegistry.onSaveInstanceState(consumedState)
                val after = Registry().apply { onRestoreInstanceState(consumedState) }
                val stale = after.register(output.name, NativeCameraPicture()) { callbacks++ }
                assertEquals(1, callbacks); stale.unregister()
            } finally { restoredLauncher.unregister(); store.clear(); recoveredFile.delete() }
        }
    }

    @Test fun restoredFilenameAuthorizesCleanupOnlyAndOrphanSweepSkipsLiveLeasesAndForeignFiles() = runBlocking {
        withContext(Dispatchers.Main) {
            val live = files.create(); write(live)
            val orphan = File(files.directory, "capture-${UUID.randomUUID()}.jpg").apply { writeBytes(jpeg()) }
            val foreign = File(files.directory, "foreign-${UUID.randomUUID()}.jpg").apply { writeText("preserve") }
            val restoredName = "capture-${UUID.randomUUID()}.jpg"
            val restoredFile = File(files.directory, restoredName).apply { writeBytes(jpeg()) }
            val restored = NativeFileAttachmentPicker(SavedStateHandle(mapOf("native-camera-output" to restoredName)))
            val store = ViewModelStore().also { it.put("restored", restored) }
            try {
                assertNull(restored.takeCameraLaunch(restoredName)); restored.completeCamera(restoredName, true)
                restored.restoreCamera(files); withTimeout(10_000) { settled(restored) }
                assertFalse(restoredFile.exists()); assertNull(restored.cameraName)
                assertTrue(files.cleanupOrphans()); assertFalse(orphan.exists())
                assertTrue(File(files.directory, live.name).exists()); assertEquals("preserve", foreign.readText())
                try { files.cleanupRestored(live.name); fail("restored metadata cannot adopt a live lease") } catch (_: IllegalStateException) { }
                assertTrue(File(files.directory, live.name).exists())
            } finally { store.clear(); live.close(); Files.deleteIfExists(orphan.toPath()); Files.deleteIfExists(restoredFile.toPath()); foreign.delete() }
        }
    }

    @Test fun cleanupFailurePreservesNoticeAndReleasesPickerWithoutDeletingSymlinkTarget() = runBlocking {
        withFixture { fixture ->
            val output = checkNotNull(fixture.picker.beginCamera(fixture.model, files))
            val file = File(files.directory, output.name)
            val sentinel = File(context.cacheDir, "camera-sentinel-${UUID.randomUUID()}").apply { writeText("preserve") }
            try {
                check(file.delete()); Files.createSymbolicLink(file.toPath(), sentinel.toPath())
                fixture.picker.completeCamera(output.name, false); settled(fixture.picker)
                assertTrue(fixture.picker.cameraCleanupFailed)
                assertEquals(NativeFileAttachmentIssue.CLEANUP_FAILED, fixture.model.state.value.issue)
                assertEquals(output.name, fixture.picker.cameraName); assertEquals("preserve", sentinel.readText())
                assertNotNull(fixture.picker.begin(fixture.model)); fixture.picker.complete(null)
            } finally { Files.deleteIfExists(file.toPath()); sentinel.delete() }
        }
    }

    @Test fun intermediateDirectorySymlinkCannotRedirectCaptureCreationOrCleanupOutsidePrivateRoot() {
        val temporary = File(context.cacheDir, "camera-path-test-${UUID.randomUUID()}").apply { check(mkdir()) }
        val outside = File(temporary, "outside").apply { check(mkdir()) }
        val captures = File(outside, "captures").apply { check(mkdir()) }
        val sentinel = File(captures, "capture-${UUID.randomUUID()}.jpg").apply { writeText("preserve") }
        val cache = File(temporary, "cache").apply { check(mkdir()) }
        val link = File(cache, "native-camera")
        try {
            Files.createSymbolicLink(link.toPath(), outside.toPath())
            val isolatedContext = object : ContextWrapper(context) { override fun getCacheDir(): File = cache }
            val constructor = NativeCameraFiles::class.java.getDeclaredConstructor(Context::class.java).apply { isAccessible = true }
            val isolated = constructor.newInstance(isolatedContext)
            assertFalse(isolated.cleanupOrphans()); assertTrue(isolated.orphanCleanupFailed)
            try { isolated.create(); fail("capture creation must reject an ancestor symlink") } catch (_: IllegalStateException) { }
            try { isolated.cleanupRestored(sentinel.name); fail("cleanup must reject an ancestor symlink") } catch (_: IllegalStateException) { }
            assertEquals("preserve", sentinel.readText())
        } finally {
            Files.deleteIfExists(link.toPath()); sentinel.delete(); captures.delete(); outside.delete(); cache.delete(); temporary.delete()
        }
    }
}
