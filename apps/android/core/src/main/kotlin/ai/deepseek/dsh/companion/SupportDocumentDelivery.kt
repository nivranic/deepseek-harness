package ai.deepseek.dsh.companion

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** A new document owned by this save operation; writes include flushing and closing the destination. */
interface SupportSaveDestination {
    fun write(bytes: ByteArray)
    fun discard()
}

/** Return only after delivery completes; failure or cancellation joins I/O and attempts to discard the new document. */
suspend fun deliverSupportDocument(document: ApprovedSupportDocument, destination: SupportSaveDestination) {
    var delivered = false
    try {
        withContext(Dispatchers.IO) {
            currentCoroutineContext().ensureActive()
            destination.write(document.copyBytes())
        }
        currentCoroutineContext().ensureActive()
        delivered = true
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        throw SupportExportException(SupportExportFailure.SAVE_FAILED)
    } finally {
        if (!delivered) withContext(NonCancellable + Dispatchers.IO) {
            try { destination.discard() }
            catch (_: Exception) { throw SupportExportException(SupportExportFailure.SAVE_FAILED) }
        }
    }
}
