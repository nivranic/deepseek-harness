package ai.deepseek.dsh.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * The unpaired shell's Lite entry (§31's closing generation): the entry stays
 * reachable without a paired Host, the Lite face discloses the literal
 * runtimeMode word, and the endpoint-less default path gates sending behind
 * an explicit empty state — the runner cannot inject an endpoint, so the
 * blocked composer is the default path the assertion observes.
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
        assertEquals(LiteSessionFacts(), model.facts)
    }
}
