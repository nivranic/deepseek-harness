package ai.deepseek.dsh.companion

import ai.deepseek.dsh.contract.ToolDescriptor
import ai.deepseek.dsh.link.LinkClientException

/**
 * One refresh outcome of the paired Host's live tool-catalog fetch (§32):
 * the retained descriptors a Lite session assembles against, and whether the
 * last attempt caught the Host serving a catalog that violates the descriptor
 * schema. A null [descriptors] with no [badWire] is the normal no-capability
 * answer — the assembled session keeps the APK-frozen BUNDLED union.
 */
data class LiteHostCatalogObservation(
    /** The last successful fetch; null before the first success, never cleared by a later failure. */
    val descriptors: List<ToolDescriptor>? = null,
    /** The last attempt failed as [LinkClientException.BadWire]; the retained descriptors stay in force and stay assembled. */
    val badWire: Boolean = false,
)

/**
 * The retain-last-success state behind one displayed Host generation's
 * tool-catalog observation: a fetch that answers null or fails leaves the
 * last successful declaration in place. A replaced wire or Host generation
 * observes through a fresh watch, so it never assembles a stale Host's
 * declaration.
 */
class LiteHostCatalogWatch {
    private var retained: List<ToolDescriptor>? = null

    /**
     * Run one foreground refresh against [wire].
     * @param wire the paired wire whose live tool declaration the fetch reads.
     * @returns the observation after this attempt; a null answer keeps the retained declaration rather than clearing it.
     */
    suspend fun refresh(wire: WireDriving): LiteHostCatalogObservation {
        val fetched = try {
            wire.toolDescriptors()
        } catch (failure: LinkClientException.BadWire) {
            return LiteHostCatalogObservation(descriptors = retained, badWire = true)
        } catch (_: LinkClientException) {
            // A failed foreground fetch keeps the last successful declaration;
            // business operations still receive the Host's current signed-admission decision.
            return LiteHostCatalogObservation(descriptors = retained)
        }
        if (fetched != null) retained = fetched
        return LiteHostCatalogObservation(descriptors = retained)
    }
}
