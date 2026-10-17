package ai.deepseek.dsh.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
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
 * The unpaired shell's Lite entry (§31's closing generation): the entry stays
 * reachable without a paired Host, the Lite face discloses the literal
 * runtimeMode word, and the endpoint-less default path gates sending behind
 * an explicit empty state — the runner cannot inject an endpoint, so the
 * blocked composer is the default path the assertion observes. The config
 * form closes the loop on-device: saving through the real Keystore cipher
 * re-reads the store and replaces the empty state with the assembled chat.
 * A stored journal closes the §67 relaunch loop: assembly over the real
 * filesDir store replays it in as the restored conversation.
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
        compose.onNodeWithTag("lite-endpoint-missing").assertIsDisplayed()
        compose.onNodeWithTag("lite-composer-send").assertIsNotEnabled()
        compose.onNodeWithTag("lite-exit").assertIsDisplayed()
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
        // The default assembly now publishes the preset id actually in effect
        // (the agent-preset/selected observability precedent): the bundled
        // projection's lowest order resolves to minimal.
        assertEquals(LiteSessionFacts(presetId = "minimal"), model.facts)
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
