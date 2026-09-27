package ai.deepseek.dsh.companion

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Process
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * Run each method in a separate instrumentation invocation after pm clear of the stopped
 * .nativeacceptance package. No permission rule or active-process revoke prepares these cases.
 * System dialogs use only this instrumentation's UiAutomation; injected-helper cases are separate evidence.
 */
class NotificationPermissionLifecycleTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val application get() = context.applicationContext as CompanionApplication
    private val automation get() = instrumentation.uiAutomation
    private var originalAccessibilityFlags: Int? = null
    private var launched = false
    private val permissionPackages = setOf("com.android.permissioncontroller", "com.google.android.permissioncontroller")
    private val activeStages = listOf(Stage.CREATED, Stage.STARTED, Stage.RESUMED, Stage.PAUSED, Stage.STOPPED, Stage.RESTARTED)

    private class ControlledLifecycle : LifecycleOwner {
        override val lifecycle = LifecycleRegistry(this)
    }

    private fun <T> onMain(action: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(action) }
        return checkNotNull(result).getOrThrow()
    }

    private fun activities(stages: List<Stage> = activeStages): List<MainActivity> = onMain {
        val monitor = ActivityLifecycleMonitorRegistry.getInstance()
        stages.flatMap { monitor.getActivitiesInStage(it) }.filterIsInstance<MainActivity>().distinct()
    }

    private fun awaitState(description: String, ready: () -> Boolean) = runBlocking {
        val reached = withTimeoutOrNull(15_000) {
            while (!ready()) delay(20)
            true
        }
        assertTrue(description, reached == true)
    }

    private fun permissionNodes(): List<AccessibilityNodeInfo> {
        fun descendants(node: AccessibilityNodeInfo): List<AccessibilityNodeInfo> =
            listOf(node) + (0 until node.childCount).flatMap { node.getChild(it)?.let(::descendants).orEmpty() }
        return automation.windows.mapNotNull { it.root }
            .filter { it.packageName?.toString() in permissionPackages }
            .flatMap(::descendants)
            .filter { it.isVisibleToUser }
    }

    private fun permissionButton(nodes: List<AccessibilityNodeInfo>, answer: Boolean): AccessibilityNodeInfo? {
        val label = context.applicationInfo.loadLabel(context.packageManager).toString()
        if (nodes.none { it.text?.toString()?.contains(label) == true }) return null
        val id = if (answer) "permission_allow_button" else "permission_deny_button"
        return nodes.filter { node -> permissionPackages.any { node.viewIdResourceName == "$it:id/$id" } }.singleOrNull()
    }

    private fun answerSystemDialog(granted: Boolean) {
        awaitState("The notification permission dialog must identify this acceptance app") {
            val nodes = permissionNodes()
            permissionButton(nodes, true) != null && permissionButton(nodes, false) != null
        }
        val button = checkNotNull(permissionButton(permissionNodes(), granted))
        check(button.isEnabled && button.isClickable && button.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            "The identified notification permission button did not accept its fixed action"
        }
        awaitState("The permission callback must retain the real system answer") {
            application.notificationGrant.state.value.lastAnswer == granted
        }
    }

    private fun foreground(): MainActivity {
        awaitState("The same app must regain a resumed focused window") {
            activities(listOf(Stage.RESUMED)).singleOrNull()?.let { onMain { it.hasWindowFocus() } } == true &&
                automation.rootInActiveWindow?.packageName?.toString() == context.packageName
        }
        compose.waitForIdle()
        return activities(listOf(Stage.RESUMED)).single()
    }

    private fun launchUntilDialog(): NotificationGrantController {
        val grant = application.notificationGrant
        assertEquals(NotificationGrantState(systemEnabled = false), grant.state.value)
        launched = true
        onMain { context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        awaitState("The first Activity entry must request notification permission") {
            permissionButton(permissionNodes(), false) != null
        }
        assertTrue(grant.state.value.requested)
        assertNull(grant.state.value.lastAnswer)
        return grant
    }

    private fun assertNoPermissionDialog() {
        assertFalse(permissionNodes().any { node -> permissionPackages.any {
            node.viewIdResourceName == "$it:id/permission_allow_button" || node.viewIdResourceName == "$it:id/permission_deny_button"
        } })
    }

    private fun launchAndDeny(): MainActivity {
        launchUntilDialog()
        answerSystemDialog(false)
        return foreground()
    }

    @Before fun requireFreshIsolatedPermissionState() {
        assertEquals("Permission tests must target only the isolated acceptance package",
            "com.deepseek.harness.companion.nativeacceptance", context.packageName)
        assertEquals("Run this method separately after clearing the stopped acceptance app",
            PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        assertFalse(PushNotifications.notificationsEnabled(context))
        assertEquals(NotificationGrantState(systemEnabled = false), application.notificationGrant.state.value)
        val info = automation.serviceInfo
        originalAccessibilityFlags = info.flags
        info.flags = info.flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        automation.serviceInfo = info
    }

    @After fun finishOwnedActivitiesAndRestoreAccessibility() {
        try {
            if (launched) {
                if (permissionButton(permissionNodes(), false) != null) {
                    check(automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK))
                }
                val owned = activities()
                onMain { owned.forEach { it.finishAndRemoveTask() } }
                instrumentation.waitForIdleSync()
                awaitState("Owned Activities must finish before instrumentation ends") { activities().isEmpty() }
            }
        } finally {
            originalAccessibilityFlags?.let { flags ->
                val info = automation.serviceInfo
                info.flags = flags
                automation.serviceInfo = info
            }
        }
    }

    /** Fresh denied permission with no user-set flags; the actual system Allow button supplies the answer. */
    @Test fun firstRealGrantUpdatesTheApplicationProjection() {
        val pid = Process.myPid()
        val grant = launchUntilDialog()
        answerSystemDialog(true)
        val activity = foreground()

        assertEquals(pid, Process.myPid())
        assertSame(application, activity.application)
        assertSame(grant, (activity.application as CompanionApplication).notificationGrant)
        assertTrue(PushNotifications.notificationsEnabled(context))
        assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        assertEquals(NotificationGrantState(systemEnabled = true, requested = true, lastAnswer = true), grant.state.value)
        compose.onNodeWithTag("native-notification-disabled").assertDoesNotExist()
        compose.onNodeWithTag("native-notification-settings").assertDoesNotExist()
        assertNoPermissionDialog()
    }

    /** Fresh permission; recreation and a real HOME and explicit Activity return follow the actual system Deny answer. */
    @Test fun realDenialKeepsTheProcessOwnerAcrossRecreationAndHomeReturn() {
        val pid = Process.myPid()
        val grant = launchUntilDialog()
        answerSystemDialog(false)
        val first = foreground()
        compose.onNodeWithTag("native-notification-disabled").assertIsDisplayed()
        compose.onNodeWithTag("native-notification-settings").assertIsDisplayed()

        onMain { first.recreate() }
        awaitState("Recreation must destroy the old Activity") { onMain { first.isDestroyed } }
        val rotated = foreground()
        assertNotSame(first, rotated)
        assertSame(application, rotated.application)
        assertSame(grant, (rotated.application as CompanionApplication).notificationGrant)
        assertNoPermissionDialog()

        check(automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME))
        awaitState("HOME must stop the acceptance Activity") {
            onMain { rotated.lifecycle.currentState == Lifecycle.State.CREATED && !rotated.hasWindowFocus() }
        }
        onMain { context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        assertSame(rotated, foreground())
        assertEquals(pid, Process.myPid())
        assertSame(grant, application.notificationGrant)
        assertFalse(PushNotifications.notificationsEnabled(context))
        assertEquals(NotificationGrantState(systemEnabled = false, requested = true, lastAnswer = false), grant.state.value)
        compose.onNodeWithTag("native-notification-disabled").assertIsDisplayed()
        assertNoPermissionDialog()
    }

    /** Fresh permission; recreating the owner while the system dialog is open must preserve its in-flight answer. */
    @Test fun recreationDuringTheRealDialogKeepsTheClaimAndReceivesItsAnswer() {
        val grant = launchUntilDialog()
        val first = activities().single()
        onMain { first.recreate() }
        awaitState("The original Activity must finish recreation") { onMain { first.isDestroyed } }
        assertSame(grant, application.notificationGrant)
        assertTrue(grant.state.value.requested)
        assertNull(grant.state.value.lastAnswer)

        answerSystemDialog(false)
        val rotated = foreground()
        assertNotSame(first, rotated)
        assertSame(grant, (rotated.application as CompanionApplication).notificationGrant)
        assertEquals(NotificationGrantState(systemEnabled = false, requested = true, lastAnswer = false), grant.state.value)
        compose.onNodeWithTag("native-notification-disabled").assertIsDisplayed()
        assertNoPermissionDialog()
    }

    /** Fresh permission is denied before installing controlled lifecycle owners; launcher counts are fixture evidence. */
    @Test fun startedObserversShareOneClaimAndDisposedObserversStopRefreshing() {
        val activity = launchAndDeny()
        var enabled = false
        val queries = AtomicInteger()
        val requests = AtomicInteger()
        val grant = NotificationGrantController { queries.incrementAndGet(); enabled }
        val owner = onMain { ControlledLifecycle().apply { lifecycle.currentState = Lifecycle.State.STARTED } }
        fun mount(consumers: Int) {
            onMain { activity.setContent {
                CompositionLocalProvider(LocalLifecycleOwner provides owner) {
                    repeat(consumers) { NativeNotificationGrantObserver(grant, { requests.incrementAndGet() }, { error("Unexpected launcher failure") }) }
                    Text("Notification lifecycle fixture")
                }
            } }
            compose.waitForIdle()
        }
        mount(2)
        assertEquals(1, requests.get())
        assertEquals(3, queries.get())
        assertEquals(NotificationGrantState(systemEnabled = false, requested = true), grant.state.value)

        onMain {
            owner.lifecycle.currentState = Lifecycle.State.CREATED
            enabled = true
            owner.lifecycle.currentState = Lifecycle.State.STARTED
        }
        compose.waitForIdle()
        assertEquals(1, requests.get())
        assertEquals(5, queries.get())
        assertTrue(grant.state.value.systemEnabled)

        onMain { activity.setContent { Text("Detached notification observers") } }
        compose.waitForIdle()
        onMain {
            owner.lifecycle.currentState = Lifecycle.State.CREATED
            enabled = false
            owner.lifecycle.currentState = Lifecycle.State.STARTED
        }
        compose.waitForIdle()
        assertEquals(5, queries.get())
        assertTrue(grant.state.value.systemEnabled)

        mount(1)
        assertEquals(6, queries.get())
        assertEquals(1, requests.get())
        assertEquals(NotificationGrantState(systemEnabled = false, requested = true), grant.state.value)
    }

    /** Fresh permission is denied before the fixture; unsupported launchers and settings retain explicit recovery state. */
    @Test fun anUnavailableLauncherConsumesItsClaimAndSettingsFailuresRemainVisible() {
        val activity = launchAndDeny()
        val grant = NotificationGrantController { false }
        val requests = AtomicInteger()
        val failures = AtomicInteger()
        val owner = onMain { ControlledLifecycle().apply { lifecycle.currentState = Lifecycle.State.STARTED } }
        var unavailable by mutableStateOf(false)
        var settingsFailure: RuntimeException = ActivityNotFoundException("Controlled settings destination")
        onMain { activity.setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalLifecycleOwner provides owner) {
                    val state by grant.state.collectAsState()
                    NativeNotificationGrantObserver(grant, {
                        requests.incrementAndGet()
                        throw ActivityNotFoundException("Controlled permission launcher")
                    }, { failures.incrementAndGet(); unavailable = true })
                    NativeNotificationGrantNotice(state, unavailable) { throw settingsFailure }
                }
            }
        } }
        compose.waitForIdle()
        assertEquals(1, requests.get())
        assertEquals(1, failures.get())
        assertEquals(NotificationGrantState(systemEnabled = false, requested = true), grant.state.value)
        compose.onNodeWithTag("native-notification-request-error").assertIsDisplayed()
        compose.onNodeWithTag("native-notification-settings").performClick()
        compose.onNodeWithTag("native-notification-settings-error").assertIsDisplayed()
        onMain { settingsFailure = SecurityException("Controlled settings refusal") }
        compose.onNodeWithTag("native-notification-settings").performClick()
        compose.onNodeWithTag("native-notification-settings-error").assertIsDisplayed()

        onMain {
            owner.lifecycle.currentState = Lifecycle.State.CREATED
            owner.lifecycle.currentState = Lifecycle.State.STARTED
        }
        compose.waitForIdle()
        assertEquals(1, requests.get())
        assertEquals(1, failures.get())
        assertFalse(grant.state.value.systemEnabled)
        assertNull(grant.state.value.lastAnswer)
    }
}
