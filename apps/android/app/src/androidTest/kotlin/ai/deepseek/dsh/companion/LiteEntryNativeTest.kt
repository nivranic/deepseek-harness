package ai.deepseek.dsh.companion

import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.After
import org.junit.BeforeClass
import org.junit.Rule
import org.junit.Test

/** One journal event object from its JSON text. */
private fun journalEvent(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

/**
 * The shell's Lite entry (§31's closing generation): the shared entry button
 * renders the locale-owned label and opens the Lite face from both shell
 * branches — asserted here over the paired branch's own composable, because
 * rendering the paired shell itself needs a paired Host — and once open the
 * Lite face discloses the literal runtimeMode word, with the endpoint-less
 * default path gating sending behind an explicit empty state — the runner
 * cannot inject an endpoint, so the blocked composer is the default path the
 * assertion observes. The config form closes the loop on-device: saving
 * through the real Keystore cipher re-reads the store and replaces the empty
 * state with the assembled chat. A stored preset id the re-bundled projection
 * no longer carries — what an APK upgrade leaves behind — renders the
 * assembly's fail-loud text as the face's own line instead of a crash, with
 * the reconfiguration entry as the recovery. A stored journal closes the §67
 * relaunch loop: assembly over the real filesDir store replays it in as the
 * restored conversation.
 */
class LiteEntryNativeTest {
    @get:Rule(order = 0)
    val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun theLiteFaceDisclosesTheRuntimeModeAndGatesOnTheMissingEndpoint() {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-entry")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-entry").assertIsDisplayed().performClick()

        compose.onNodeWithTag("lite-disclosure").assertIsDisplayed()
            .assertTextContains("runtimeMode = lite", substring = true)
        // The in-face catalog refresh entry renders beside the disclosure line
        // with no paired Host — the wired bump is a no-op observation re-run.
        compose.onNodeWithTag("lite-catalog-refresh").assertIsDisplayed()
        compose.onNodeWithTag("lite-endpoint-missing").assertIsDisplayed()
        compose.onNodeWithTag("lite-composer-send").assertIsNotEnabled()
        compose.onNodeWithTag("lite-exit").assertIsDisplayed()
    }

    @Test
    fun thePairedShellEntryRendersTheLocaleLabelAndOpensOnTap() {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("support-export")).fetchSemanticsNodes().isNotEmpty()
        }
        var opened = false
        // The paired shell itself needs a paired Host to render; the entry
        // both branches share is the paired face's own composable surface.
        compose.runOnUiThread { compose.activity.setContent { LiteEntryButton(onOpen = { opened = true }) } }
        compose.onNodeWithTag("lite-entry").assertIsDisplayed()
            .assertTextEquals(compose.activity.getString(R.string.lite_entry))
        compose.onNodeWithTag("lite-entry").performClick()
        compose.runOnIdle { check(opened) }
    }

    @Test
    fun theBadWireLineRendersInFaceAndItsRefreshRetriesWithoutLeavingIt() {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("support-export")).fetchSemanticsNodes().isNotEmpty()
        }
        // A raised badWire flag needs a paired Host serving a schema-violating
        // catalog; the bad-wire face is the Lite entry's own composable over
        // the observation pair a paired shell passes, scripted here with the
        // flag raised and the refresh bump clearing it — what one successful
        // re-observation renders.
        var refreshes = 0
        compose.runOnUiThread {
            compose.activity.setContent {
                var badWire by remember { mutableStateOf(true) }
                LiteEntry(
                    scope = CoroutineScope(Dispatchers.Unconfined),
                    sessionId = "lite-badwire-test",
                    endpoint = "",
                    apiKey = "",
                    model = "",
                    execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
                    liveHostCatalogBadWire = badWire,
                    onCatalogRefresh = { badWire = false; refreshes++ },
                )
            }
        }
        compose.onNodeWithTag("lite-catalog-badwire").assertIsDisplayed()
            .assertTextEquals(compose.activity.getString(R.string.lite_catalog_bad_wire))
        compose.onNodeWithTag("lite-catalog-refresh").assertIsDisplayed().performClick()
        // One click is one bump through the lambda the shell wires to the
        // shared description-refresh epoch; the refreshed observation clears
        // the line without leaving the Lite face.
        compose.onNodeWithTag("lite-catalog-badwire").assertDoesNotExist()
        compose.runOnIdle { check(refreshes == 1) }
    }

    @Test
    fun savingTheConfigFormReplacesTheEmptyStateWithTheAssembledChat() {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-entry")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-entry").assertIsDisplayed().performClick()

        compose.onNodeWithTag("lite-endpoint-missing").assertIsDisplayed()
        compose.onNodeWithTag("lite-config-endpoint")
            .performTextInput("https://lite-config.invalid/v1/chat/completions")
        compose.onNodeWithTag("lite-config-api-key").performTextInput("sk-instrumented")
        compose.onNodeWithTag("lite-config-model").performTextInput("deepseek-chat")
        compose.onNodeWithTag("lite-config-save").performClick()

        // The save re-reads the Keystore-sealed file: the empty state gives
        // way to the assembled chat and its reconfiguration entry. A fresh
        // conversation holds no rows, so its LazyColumn measures zero-width —
        // presence, not display, is its assertion.
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-conversation")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-conversation").assertExists()
        compose.onNodeWithTag("lite-config-edit").assertIsDisplayed()
        // The assembled session discloses its dispatch-catalog source: with no
        // paired Host the unpaired face assembles the APK-frozen BUNDLED union.
        compose.onNodeWithTag("lite-catalog-source").assertIsDisplayed()
            .assertTextEquals(compose.activity.getString(R.string.lite_catalog_source_bundled))
        compose.onNodeWithTag("lite-composer-send").assertIsDisplayed()
        compose.onNodeWithTag("lite-endpoint-missing").assertDoesNotExist()
    }

    @Test
    fun theConfigFormNamesTheBundledDefaultPreset() {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-entry")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-entry").assertIsDisplayed().performClick()

        // The selection row names the preset the next assembly would run: the
        // bundled projection carries exactly minimal, so a null selection
        // already displays its id — the one-option catalog rendered honestly.
        compose.onNodeWithTag("lite-config-preset").assertIsDisplayed()
            .assertTextContains("预设", substring = true)
            .assertTextContains("minimal", substring = true)
    }

    @Test
    fun aStaleStoredPresetIdRendersTheAssemblyFailureLineInsteadOfCrashing() {
        // The store carries a preset id the bundled projection does not — the
        // exact residue an APK upgrade that re-bundles the preset projection
        // leaves on a configured device — written through the same Keystore
        // cipher the activity's own store reads.
        LiteFileConfigStore(
            liteConfigFile(),
            AndroidKeystoreCipher("dsh-lite-config"),
        ).save(
            LiteConfig(
                endpoint = "https://lite-config.invalid/v1/chat/completions",
                apiKey = "sk-instrumented",
                model = "deepseek-chat",
                presetId = "vanished-preset",
            ),
        )
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(hasTestTag("lite-entry")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("lite-entry").assertIsDisplayed().performClick()

        // Resolve fails loud without guessing a substitute, and that text —
        // the stale id and the carried ids — is the face's line, not a crash;
        // the reconfiguration entry stays reachable as the recovery, and no
        // chat surface assembles over the failed identity.
        compose.onNodeWithTag("lite-preset-stale").assertIsDisplayed()
            .assertTextContains("vanished-preset", substring = true)
            .assertTextContains("minimal", substring = true)
        compose.onNodeWithTag("lite-config-edit").assertIsDisplayed()
        compose.onNodeWithTag("lite-conversation").assertDoesNotExist()
    }

    @Test
    fun theAssemblerProducesExactlyTheDefaultSessionFacts() {
        val model = LiteSessionAssembler.assemble(
            context = InstrumentationRegistry.getInstrumentation().targetContext,
            scope = CoroutineScope(Dispatchers.Unconfined),
            sessionId = "lite-entry-facts-test",
            endpoint = "https://lite-entry.invalid/chat/completions",
            apiKey = "unused",
            model = "unused",
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
        )
        // The default assembly publishes the preset id actually in effect (the
        // agent-preset/selected observability precedent): the bundled
        // projection's lowest order resolves to minimal. Its dispatch catalog is
        // the APK-frozen BUNDLED union, not the pre-declaration FALLBACK the
        // facts' field default still names for projection-less construction.
        assertEquals(LiteSessionFacts(toolCatalogSource = LiteToolSource.BUNDLED, presetId = "minimal"), model.facts)
    }

    @Test
    fun aStoredJournalRestoresItsConversationThroughTheAssembler() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = LiteFileSessionStore(liteSessionsDirectory())
        val stored = LiteSession("lite-main")
        stored.record(journalEvent("""{"type":"prompt/accepted","requestId":"r1","content":"重启后还在吗"}"""))
        stored.record(journalEvent("""{"type":"message/completed","text":"在的，历史已经恢复。"}"""))
        stored.record(journalEvent("""{"type":"turn/completed"}"""))
        store.save(stored)

        // A relaunch assembles over the same real filesDir store: the
        // constructor replays the stored journal in, so the conversation
        // crosses the process boundary without any UI-side restore code.
        val model = LiteSessionAssembler.assemble(
            context = context,
            scope = CoroutineScope(Dispatchers.Unconfined),
            sessionId = "lite-main",
            endpoint = "https://lite-entry.invalid/chat/completions",
            apiKey = "unused",
            model = "unused",
            execute = { _, _, _ -> LiteToolOutcome(ok = false, text = "") },
            store = store,
        )
        assertEquals(
            listOf(
                LiteMessage(role = "user", text = "重启后还在吗"),
                LiteMessage(role = "assistant", text = "在的，历史已经恢复。"),
            ),
            model.state.conversation,
        )
    }

    @After
    fun leaveNoPersistedLiteState() {
        liteConfigFile().delete()
        liteSessionsDirectory().deleteRecursively()
    }

    companion object {
        // The persisted config and journal survive process death; wiping them
        // before the rule launches the activity keeps the empty-state and
        // restore assertions honest across reruns and method order.
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
