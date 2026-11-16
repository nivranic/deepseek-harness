package ai.deepseek.dsh.companion

import android.app.Activity
import android.content.Intent
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Installed Activity-result ownership rejects duplicate and restored callbacks without deleting an accepted document. */
class NativeResourceSavePickerTest {
    private val source = NativeResourceState(NativeResourceTarget("session", "folder/报告.txt"), NativeResourcePhase.READY,
        NativeFileDescriptor("/folder/报告.txt", "v1", 3), 3, content = byteArrayOf(1, 2, 3))

    @Test fun pickerContractUsesNewDocumentAndPreservesTheBasename() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        try {
            val saver = NativeResourceSaver(scope) { source }
            val request = checkNotNull(saver.prepare(source))
            val contract = NativeResourceDocument()
            val intent = contract.createIntent(InstrumentationRegistry.getInstrumentation().targetContext, request)
            assertEquals(Intent.ACTION_CREATE_DOCUMENT, intent.action)
            assertEquals("报告.txt", intent.getStringExtra(Intent.EXTRA_TITLE))
            assertEquals("application/octet-stream", intent.type)
            assertTrue(intent.categories.contains(Intent.CATEGORY_OPENABLE))
            assertNull(contract.parseResult(Activity.RESULT_CANCELED, intent))
            saver.invalidateAndAwait()
        } finally { scope.cancel() }
    }

    @Test fun duplicateActivityResultDoesNotDeleteTheSavedDocument() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val owner = NativeResourceSavePicker()
        val store = ViewModelStore().also { it.put("picker", owner) }
        val writes = AtomicInteger()
        val deletes = AtomicInteger()
        val destination = object : NativeResourceSaveDestination {
            override fun write(content: NativeResourceContent) {
                val bytes = java.io.ByteArrayOutputStream(); content.copyTo(bytes::write)
                assertArrayEquals(source.content, bytes.toByteArray()); writes.incrementAndGet()
            }
            override fun discard() { deletes.incrementAndGet() }
        }
        try {
            val saver = NativeResourceSaver(scope) { source }
            withContext(Dispatchers.Main) {
                assertNotNull(owner.begin(source, saver))
                owner.complete(destination)
                withTimeout(10_000) { while (owner.busy) delay(10) }
                assertEquals(NativeResourceSavePhase.SAVED, owner.result)
                owner.complete(destination)
                assertEquals(NativeResourceSavePhase.SAVED, owner.result)
                owner.selectionChanged()
                assertNull(owner.result)
                owner.complete(destination)
                assertNull(owner.result)
            }
            assertEquals(1, writes.get())
            assertEquals(0, deletes.get())
        } finally { withContext(Dispatchers.Main) { store.clear() }; scope.cancel() }
    }

    @Test fun restoredPickerHasNoAuthorityToWriteAndDiscardsOnlyOnce() = runBlocking {
        val owner = NativeResourceSavePicker()
        val store = ViewModelStore().also { it.put("picker", owner) }
        val deletes = AtomicInteger()
        val destination = object : NativeResourceSaveDestination {
            override fun write(content: NativeResourceContent) { error("restored picker must not write") }
            override fun discard() { deletes.incrementAndGet() }
        }
        try {
            withContext(Dispatchers.Main) {
                owner.complete(destination)
                withTimeout(10_000) { while (owner.busy) delay(10) }
                assertEquals(NativeResourceSavePhase.EXPIRED, owner.result)
                owner.complete(destination)
                assertEquals(NativeResourceSavePhase.EXPIRED, owner.result)
            }
            assertEquals(1, deletes.get())
        } finally { withContext(Dispatchers.Main) { store.clear() } }
    }
}
