package ai.deepseek.dsh.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test

/**
 * The seed half of the real upgrade-path qualification: on the lane's older
 * APK — the same tree whose frozen preset projection carries the probe
 * preset — this class stores a real selection made through the real config
 * face. The verify half then replace-installs the current APK over that
 * state and holds the dropped-preset line to what gen-71's injected case
 * claimed. The `dshUpgradeLane=seed` instrumentation argument gates the run;
 * without it the test skips, so a normal connected lane never touches it.
 */
class LiteUpgradeSeedNativeTest {
    @get:Rule(order = 0)
    val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun theSeedRunSelectsTheProbePresetThroughTheRealFaceAndStoresIt() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("dshUpgradeLane") == "seed")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val catalog = LiteAssets.load(context).presets
        checkNotNull(catalog.preset(PROBE_PRESET_ID)) {
            "upgrade seed lane: the installed APK must bundle the probe preset"
        }

        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-entry")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-entry").assertIsDisplayed().performClick()

        compose.onNodeWithTag("lite-config-endpoint")
            .performTextInput("https://lite-upgrade.invalid/v1/chat/completions")
        compose.onNodeWithTag("lite-config-api-key").performTextInput("sk-instrumented")
        compose.onNodeWithTag("lite-config-model").performTextInput("deepseek-chat")
        // The pick is an explicit selection of the probe entry, never the
        // default a null selection would resolve to — the stored config must
        // name the id the upgraded APK is about to drop.
        compose.onNodeWithTag("lite-config-preset").performClick()
        compose.onNodeWithTag("lite-preset-option-$PROBE_PRESET_ID").performClick()
        compose.onNodeWithTag("lite-config-save").performClick()

        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-conversation")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-config-edit").assertIsDisplayed()

        // The durable fact the replace-install must carry: the Keystore-sealed
        // file names the probe preset, written by the face's own save path.
        val stored = LiteFileConfigStore(
            liteConfigFile(),
            AndroidKeystoreCipher(CONFIG_CIPHER_ALIAS),
        ).load()
        assertEquals(PROBE_PRESET_ID, stored?.presetId)
    }

    companion object {
        /** The lane's probe preset id: bundled by the older APK, dropped by the current projection. */
        const val PROBE_PRESET_ID = "vanished-preset"

        /** The config cipher alias the shell's own store reads. */
        const val CONFIG_CIPHER_ALIAS = "dsh-lite-config"

        // The seed must start from a clean slate so the stored selection is
        // exactly what this run picked — never residue from an earlier lane.
        @BeforeClass
        @JvmStatic
        fun resetPersistedLiteState() {
            liteConfigFile().delete()
            liteSessionsDirectory().deleteRecursively()
        }

        private fun liteConfigFile() = java.io.File(
            InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "lite-config.enc",
        )

        private fun liteSessionsDirectory() = java.io.File(
            InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "lite-sessions",
        )
    }
}
