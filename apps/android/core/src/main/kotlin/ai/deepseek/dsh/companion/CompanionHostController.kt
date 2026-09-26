package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkCredentials
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Retirement failure keeps the committed identity visible but prevents new model work. */
enum class NativeHostStatus { EMPTY, READY, SWITCHING, RESTORE_FAILED, RETIREMENT_FAILED, CLOSED }

/** Public Host state never contains device signing material. */
data class NativeHostState(
    val status: NativeHostStatus = NativeHostStatus.EMPTY,
    val hosts: List<SavedNativeHost> = emptyList(),
    val active: NativeHostKey? = null,
    val generation: Long = 0,
) {
    val selected: SavedNativeHost? get() = hosts.singleOrNull { it.key == active }
}

/** Fixed presentation failure; filesystem, transport, and cipher details remain private causes. */
class NativeHostException(cause: Throwable? = null) : Exception("saved Host selection is unavailable", cause)

/** Owns the catalog, transport, and principal input together. Callers must stop and await all
 * model producers before changing selection. A durable selection completes adoption even if
 * its caller is cancelled; a failed old-resource retirement requires process restart.
 */
class CompanionHostController(
    private val store: NativeHostStoring,
    private val wireFactory: (LinkCredentials) -> WireDriving,
    private val inputFactory: suspend (LinkCredentials) -> CompanionInputState,
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    private val transition = Mutex()
    private var initialized = false
    private var catalog = NativeHostCatalog()
    private val switchingWire = SwitchableWireDriving(UnselectedNativeWire())
    val wire: WireDriving get() = switchingWire
    var inputs: CompanionInputState = CompanionInputState.memory()
        private set
    private val mutableState = MutableStateFlow(NativeHostState())
    val state: StateFlow<NativeHostState> = mutableState

    /** Reads once per owner lifetime; damaged bytes remain untouched until explicit recovery. */
    suspend fun restore() = transition.withLock {
        if (initialized) return@withLock
        try {
            val saved = withContext(dispatcher) { store.load() } ?: NativeHostCatalog()
            if (saved.active == null) {
                catalog = saved
                initialized = true
                publish(NativeHostStatus.EMPTY)
            } else {
                adopt(saved, persist = false) { wireFactory(checkNotNull(saved.selected())) }
                initialized = true
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            initialized = true
            if (state.value.status != NativeHostStatus.RETIREMENT_FAILED) publish(NativeHostStatus.RESTORE_FAILED)
        }
    }

    /** Reuses an existing grant. This restores observations and input, never a business mutation. */
    suspend fun select(key: NativeHostKey) = transition.withLock {
        requireUsable()
        if (key == catalog.active) return@withLock
        val credentials = catalog.hosts.single { nativeHostKey(it) == key }
        adopt(catalog.copy(active = key)) { wireFactory(credentials) }
    }

    /** Takes ownership of an already verified client, including failure and cancellation paths. */
    suspend fun remember(credentials: LinkCredentials, client: WireDriving) {
        var transferred = false
        try {
            transition.withLock {
                requireUsable()
                transferred = true
                adopt(catalog.remember(credentials), supplied = client) { client }
            }
        } finally {
            if (!transferred) withContext(NonCancellable) { client.closeAndAwait() }
        }
    }

    /** Explicit recovery preserves unreadable catalog bytes before publishing an empty selection. */
    suspend fun startFresh() = transition.withLock {
        check(state.value.status == NativeHostStatus.RESTORE_FAILED)
        currentCoroutineContext().ensureActive()
        withContext(NonCancellable) {
            try { withContext(dispatcher) { store.preserveAndStartFresh() } }
            catch (failure: Exception) { throw NativeHostException(failure) }
            catalog = NativeHostCatalog()
            initialized = true
            publish(NativeHostStatus.EMPTY)
        }
    }

    private fun requireUsable() {
        check(initialized && state.value.status in setOf(NativeHostStatus.EMPTY, NativeHostStatus.READY))
    }

    private fun publish(status: NativeHostStatus, advance: Boolean = false) {
        mutableState.value = NativeHostState(status, catalog.summaries(), catalog.active,
            state.value.generation + if (advance) 1 else 0)
    }

    private suspend fun adopt(next: NativeHostCatalog, persist: Boolean = true,
                              supplied: WireDriving? = null, create: () -> WireDriving) {
        val previousStatus = state.value.status
        var candidate: WireDriving? = supplied
        var candidateInputs: CompanionInputState? = null
        var committed = false
        publish(NativeHostStatus.SWITCHING)
        try {
            if (inputs.persistence.value != InputPersistenceStatus.RESTORE_FAILED) inputs.flush()
            if (candidate == null) withContext(dispatcher) { candidate = create() }
            candidateInputs = inputFactory(checkNotNull(next.selected()))
            currentCoroutineContext().ensureActive()
            withContext(NonCancellable) {
                if (persist) withContext(dispatcher) { store.save(next) }
                committed = true
                initialized = true
                catalog = next
                val priorInputs = inputs
                inputs = checkNotNull(candidateInputs)
                candidateInputs = null
                val adopted = checkNotNull(candidate)
                candidate = null
                try {
                    try { switchingWire.replaceAndAwait(adopted) }
                    finally { priorInputs.retireAndAwait() }
                    publish(NativeHostStatus.READY, advance = true)
                } catch (failure: Exception) {
                    publish(NativeHostStatus.RETIREMENT_FAILED, advance = true)
                    throw NativeHostException(failure)
                }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { throw NativeHostException(failure) }
        finally {
            if (!committed) publish(previousStatus)
            withContext(NonCancellable) {
                try { candidate?.closeAndAwait() }
                finally { candidateInputs?.retireAndAwait() }
            }
        }
    }

    /** Call after model producers stop. Serialized retirement cannot race durable adoption. */
    suspend fun closeAndAwait() = transition.withLock {
        withContext(NonCancellable) {
            initialized = true
            publish(NativeHostStatus.CLOSED)
            try { switchingWire.closeAndAwait() }
            finally { inputs.retireAndAwait() }
        }
    }
}

private class UnselectedNativeWire : WireDriving {
    override suspend fun call(method: String, args: Map<String, ai.deepseek.dsh.link.WireValue>): ai.deepseek.dsh.link.WireValue =
        error("no Host selected")
    override fun stream(endpoint: String, payload: Map<String, ai.deepseek.dsh.link.WireValue>): kotlinx.coroutines.flow.Flow<ai.deepseek.dsh.link.WireValue> =
        error("no Host selected")
}
