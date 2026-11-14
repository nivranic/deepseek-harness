package ai.deepseek.dsh.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/**
 * The verify half of the real upgrade-path qualification: after the seed
 * phase stored a probe-preset selection through the real face and the lane
 * replace-installed the current APK over it — `adb install -r`, the app data
 * and its Keystore entries surviving — this class holds the real residue to
 * the dropped-preset contract: the stale line renders naming the stored id
 * and the carried ids, no conversation assembles over the failed identity,
 * and the in-face reconfiguration recovers by reselecting a carried preset.
 * The `dshUpgradeLane=verify` instrumentation argument gates the run; this
 * class never wipes persisted state — the whole point is what survived.
 */
class LiteUpgradeVerifyNativeTest {
    @get:Rule(order = 0)
    val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun theRealUpgradeSurfacesTheStoredDroppedPresetAndRecoversByReselecting() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("dshUpgradeLane") == "verify")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(LiteAssets.load(context).presets.preset(LiteUpgradeSeedNativeTest.PROBE_PRESET_ID) == null) {
            "upgrade verify lane: the upgraded APK must drop the probe preset"
        }
        // The precondition is the real surviving residue, not a store this
        // process wrote: the seed phase's selection, carried across the
        // replace-install by the platform.
        val stored = LiteFileConfigStore(
            liteConfigFile(),
            AndroidKeystoreCipher(LiteUpgradeSeedNativeTest.CONFIG_CIPHER_ALIAS),
        ).load()
        assertNotNull("upgrade verify lane: the seed selection must have survived the replace-install", stored)
        assertEquals(LiteUpgradeSeedNativeTest.PROBE_PRESET_ID, stored!!.presetId)

        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-entry")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-entry").assertIsDisplayed().performClick()

        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-preset-stale")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-preset-stale").assertIsDisplayed()
            .assertTextContains(LiteUpgradeSeedNativeTest.PROBE_PRESET_ID, substring = true)
            .assertTextContains("minimal", substring = true)
        compose.onNodeWithTag("lite-config-edit").assertIsDisplayed()
        compose.onNodeWithTag("lite-conversation").assertDoesNotExist()

        // The recovery is the face's own reconfiguration path over the
        // surviving store: the form prefills from the stored config, the
        // carried preset replaces the dropped pick, and the same assembly
        // identity re-runs assembled.
        compose.onNodeWithTag("lite-config-edit").performClick()
        compose.onNodeWithTag("lite-config-preset").performClick()
        compose.onNodeWithTag("lite-preset-option-minimal").performClick()
        compose.onNodeWithTag("lite-config-save").performClick()

        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-conversation")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-preset-stale").assertDoesNotExist()
        val healed = LiteFileConfigStore(
            liteConfigFile(),
            AndroidKeystoreCipher(LiteUpgradeSeedNativeTest.CONFIG_CIPHER_ALIAS),
        ).load()
        assertEquals("minimal", healed?.presetId)
    }

    private fun liteConfigFile() = java.io.File(
        InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "lite-config.enc",
    )
}
