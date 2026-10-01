package ai.deepseek.dsh.companion

import android.net.LocalServerSocket
import android.graphics.Bitmap
import android.util.Base64
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.rule.ActivityTestRule
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.rules.ExternalResource
import org.junit.rules.TestRule
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/** Private ADB socket drives the installed Activity; no pairing text enters instrumentation output. */
class NativeCompanionAcceptanceTest {
    @get:Rule(order = 0) val optIn = object : ExternalResource() {
        override fun before() {
            val name = InstrumentationRegistry.getArguments().getString("dshSocket")
            assumeTrue("Requires the private Native Remote acceptance driver", name != null)
            require(name!!.matches(Regex("dsh-native-[a-f0-9-]+")))
            check(InstrumentationRegistry.getInstrumentation().targetContext.packageName.endsWith(".nativeacceptance"))
        }
    }
    @get:Rule(order = 1) val notifications: TestRule = when (
        InstrumentationRegistry.getArguments().getString("dshNotificationPermission")
    ) {
        null, "pregranted" -> GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
        "runtime" -> TestRule { base, _ -> base }
        else -> error("Unsupported notification permission test mode")
    }
    // ActivityScenario filters out lifecycle events after real share delivery changes getIntent().
    @Suppress("DEPRECATION")
    @get:Rule(order = 2) val compose = AndroidComposeTestRule(object : ActivityTestRule<MainActivity>(MainActivity::class.java) {
        override fun getActivityIntent(): android.content.Intent? {
            val link = InstrumentationRegistry.getArguments().getString("dshViewLink") ?: return super.getActivityIntent()
            return android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(link))
                .addCategory(android.content.Intent.CATEGORY_BROWSABLE)
        }
    }) { it.activity }

    private fun waitFor(matcher: SemanticsMatcher) {
        compose.waitUntil(20_000) { compose.onAllNodes(matcher).fetchSemanticsNodes(false).isNotEmpty() }
    }

    /** The private driver owns accessibility query flags until its socket server retires. */
    private fun withDriverServer(name: String, accept: (LocalServerSocket) -> Unit) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val originalFlags = automation.serviceInfo.flags
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        try { LocalServerSocket(name).use(accept) }
        finally {
            automation.serviceInfo = automation.serviceInfo.apply { flags = originalFlags }
        }
    }

    private fun companionModel(): CompanionViewModel {
        lateinit var model: CompanionViewModel
        compose.runOnIdle { model = androidx.lifecycle.ViewModelProvider(compose.activity)[CompanionViewModel::class.java] }
        return model
    }

    /** Background observations cannot wait for a visible Compose root or resume the Activity. */
    private fun foregroundSnapshot(): JsonObject {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        lateinit var result: JsonObject
        instrumentation.runOnMainSync {
            val activity = compose.activity
            val model = androidx.lifecycle.ViewModelProvider(activity)[CompanionViewModel::class.java]
            val hosts = CompanionRuntime.hostState.value
            val inputs = model.inputs.state.value
            val push = model.pushes.connectionSnapshot
            fun draft(value: SessionDraft) = buildJsonObject {
                put("text", value.text); put("requestId", value.requestId)
                put("attachments", JsonArray(value.attachments.map(::attachmentJson)))
            }
            result = buildJsonObject {
                put("pid", android.os.Process.myPid()); put("lifecycle", activity.lifecycle.currentState.name)
                put("focused", activity.hasWindowFocus()); put("generation", model.generation)
                put("hostId", hosts.selected?.hostId?.let(::JsonPrimitive) ?: JsonNull)
                put("hostKey", hosts.selected?.key?.value?.let(::JsonPrimitive) ?: JsonNull)
                put("pushOwner", System.identityHashCode(model.pushes)); put("sessionOwner", System.identityHashCode(model.session))
                put("sessionId", model.session.open.value?.sessionId?.let(::JsonPrimitive) ?: JsonNull)
                put("push", buildJsonObject {
                    put("state", push.state.wire); put("attempts", push.attempts); put("interruptions", push.interruptions)
                    put("lastFailure", push.lastFailure?.wire?.let(::JsonPrimitive) ?: JsonNull)
                    put("received", model.pushes.pushes.value.size)
                })
                put("input", buildJsonObject {
                    put("drafts", buildJsonObject { inputs.drafts.forEach { (id, value) -> put(id, draft(value)) } })
                    put("pending", buildJsonObject { inputs.pendingPrompts.forEach { (id, value) -> put(id, buildJsonObject {
                        put("sessionId", value.sessionId); put("draft", draft(value.draft))
                    }) } })
                    put("answerCount", inputs.answers.size)
                    put("lastSessionId", inputs.lastSessionId?.let(::JsonPrimitive) ?: JsonNull)
                })
            }
        }
        return JsonObject(result + ("windowPackage" to (instrumentation.uiAutomation.rootInActiveWindow?.packageName
            ?.toString()?.let(::JsonPrimitive) ?: JsonNull)))
    }

    private fun pushNotificationSnapshot(): JsonObject {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        val owned = manager.activeNotifications.filter { it.id == 70 && it.notification.channelId == "dsh-link-push" }
        return buildJsonObject {
            put("enabled", manager.areNotificationsEnabled())
            put("permission", context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED)
            put("count", owned.size)
            put("titles", JsonArray(owned.map { JsonPrimitive(it.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString()) }))
            put("bodies", JsonArray(owned.map { JsonPrimitive(it.notification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString()) }))
            put("postTimes", JsonArray(owned.map { JsonPrimitive(it.postTime) }))
        }
    }

    private fun descendants(node: android.view.accessibility.AccessibilityNodeInfo): List<android.view.accessibility.AccessibilityNodeInfo> =
        listOf(node) + (0 until node.childCount).flatMap { node.getChild(it)?.let(::descendants).orEmpty() }

    private fun permissionDialogNodes(): List<android.view.accessibility.AccessibilityNodeInfo> {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return emptyList()
        if (root.packageName.toString() !in setOf("com.android.permissioncontroller", "com.google.android.permissioncontroller")) return emptyList()
        val context = instrumentation.targetContext
        val label = context.applicationInfo.loadLabel(context.packageManager).toString()
        return descendants(root).takeIf { nodes -> nodes.any { it.text?.toString()?.contains(label) == true } }.orEmpty()
    }

    private fun notificationSettingsBar(): android.view.accessibility.AccessibilityNodeInfo? {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return null
        if (root.packageName.toString() != "com.android.settings") return null
        val context = instrumentation.targetContext
        val label = context.applicationInfo.loadLabel(context.packageManager).toString()
        val nodes = descendants(root)
        if (nodes.none { it.viewIdResourceName == "com.android.settings:id/entity_header_title" && it.text?.toString() == label }) return null
        val bar = nodes.singleOrNull { it.viewIdResourceName == "com.android.settings:id/main_switch_bar" } ?: return null
        return bar.takeIf { descendants(it).any { child ->
            child.viewIdResourceName == "com.android.settings:id/switch_text" && child.text?.toString()?.contains(label) == true
        } }
    }

    /** Permission and settings windows use only the instrumentation's existing UiAutomation owner. */
    private fun notificationPermissionSnapshot(): JsonObject {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        lateinit var projection: JsonObject
        instrumentation.runOnMainSync {
            val controller = (context.applicationContext as CompanionApplication).notificationGrant
            val state = controller.state.value
            projection = buildJsonObject {
                put("pid", android.os.Process.myPid()); put("controller", System.identityHashCode(controller))
                put("systemEnabled", PushNotifications.notificationsEnabled(context))
                put("permission", context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED)
                put("projectedEnabled", state.systemEnabled); put("requested", state.requested)
                put("lastAnswer", state.lastAnswer?.let(::JsonPrimitive) ?: JsonNull)
            }
        }
        val dialog = permissionDialogNodes()
        val bar = notificationSettingsBar()
        return JsonObject(projection + buildJsonObject {
            put("dialog", dialog.isNotEmpty())
            put("allow", dialog.any { it.viewIdResourceName?.endsWith(":id/permission_allow_button") == true })
            put("deny", dialog.any { it.viewIdResourceName?.endsWith(":id/permission_deny_button") == true })
            put("settings", bar != null)
            put("settingsEnabled", bar?.let { descendants(it).singleOrNull { child -> child.viewIdResourceName == "android:id/switch_widget" }?.isChecked }?.let(::JsonPrimitive) ?: JsonNull)
        })
    }

    private fun systemNotificationNodes(): List<android.view.accessibility.AccessibilityNodeInfo> {
        val root = InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow ?: return emptyList()
        if (root.packageName.toString() != "com.android.systemui") return emptyList()
        fun descend(node: android.view.accessibility.AccessibilityNodeInfo): List<android.view.accessibility.AccessibilityNodeInfo> =
            listOf(node) + (0 until node.childCount).flatMap { node.getChild(it)?.let(::descend).orEmpty() }
        return descend(root)
    }

    /** Click only the notification row containing this acceptance application's label and minimized copy. */
    private fun clickPushNotification() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val label = context.applicationInfo.loadLabel(context.packageManager).toString()
        val title = pushTitle(CompanionPush.ApprovalWaiting("fixture", "fixture"))
        val titleNode = systemNotificationNodes().single { it.text?.toString() == title }
        fun texts(node: android.view.accessibility.AccessibilityNodeInfo): List<String> =
            listOfNotNull(node.text?.toString()) + (0 until node.childCount).flatMap { node.getChild(it)?.let(::texts).orEmpty() }
        var row: android.view.accessibility.AccessibilityNodeInfo? = titleNode
        repeat(10) {
            val node = checkNotNull(row)
            val content = texts(node)
            if (node.isClickable && label in content && title in content && pushBody() in content) {
                check(node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
                return
            }
            row = node.parent
        }
        error("Owned notification has no clickable system row")
    }

    private fun documentNodes(): List<android.view.accessibility.AccessibilityNodeInfo> {
        val root = InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow ?: return emptyList()
        if (!root.packageName.toString().endsWith(".documentsui")) return emptyList()
        fun descend(node: android.view.accessibility.AccessibilityNodeInfo): List<android.view.accessibility.AccessibilityNodeInfo> =
            listOf(node) + (0 until node.childCount).flatMap { index -> node.getChild(index)?.let(::descend).orEmpty() }
        return descend(root)
    }

    private fun clickDocumentNode(node: android.view.accessibility.AccessibilityNodeInfo) {
        var target: android.view.accessibility.AccessibilityNodeInfo? = node
        repeat(6) {
            val current = target ?: error("system document action has no clickable owner")
            if (current.isClickable) {
                check(current.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
                return
            }
            target = current.parent
        }
        error("system document action is not clickable")
    }

    private fun photoNodes(): List<android.view.accessibility.AccessibilityNodeInfo> {
        val root = InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow ?: return emptyList()
        val owner = root.packageName.toString()
        if (!owner.contains("providers.media") && !owner.contains("photopicker")) return emptyList()
        fun descend(node: android.view.accessibility.AccessibilityNodeInfo): List<android.view.accessibility.AccessibilityNodeInfo> =
            listOf(node) + (0 until node.childCount).flatMap { index -> node.getChild(index)?.let(::descend).orEmpty() }
        return descend(root)
    }

    private fun cameraNodes(): List<android.view.accessibility.AccessibilityNodeInfo> {
        val root = InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow ?: return emptyList()
        if (root.packageName.toString() != "com.android.camera2") return emptyList()
        fun descend(node: android.view.accessibility.AccessibilityNodeInfo): List<android.view.accessibility.AccessibilityNodeInfo> =
            listOf(node) + (0 until node.childCount).flatMap { index -> node.getChild(index)?.let(::descend).orEmpty() }
        return descend(root)
    }

    private fun chooserNodes(): List<android.view.accessibility.AccessibilityNodeInfo> {
        val root = InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow ?: return emptyList()
        if (root.packageName.toString() !in setOf("android", "com.android.intentresolver")) return emptyList()
        fun descend(node: android.view.accessibility.AccessibilityNodeInfo): List<android.view.accessibility.AccessibilityNodeInfo> =
            listOf(node) + (0 until node.childCount).flatMap { index -> node.getChild(index)?.let(::descend).orEmpty() }
        return descend(root)
    }

    private fun longClickDocumentNode(node: android.view.accessibility.AccessibilityNodeInfo) {
        check(node.isVisibleToUser && node.packageName.toString().endsWith(".documentsui"))
        val bounds = android.graphics.Rect().also(node::getBoundsInScreen)
        check(!bounds.isEmpty)
        // The system file row exposes no accessibility long-click action.
        val x = bounds.centerX(); val y = bounds.centerY()
        val duration = android.view.ViewConfiguration.getLongPressTimeout() + 100
        val result = InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("input touchscreen swipe $x $y $x $y $duration")
        android.os.ParcelFileDescriptor.AutoCloseInputStream(result).use { it.readBytes() }
    }

    private fun attachmentJson(attachment: SessionAttachment) = buildJsonObject {
        put("type", if (attachment is SessionImageAttachment) "image" else "file")
        put("receiptId", attachment.receiptId); put("attachmentId", attachment.attachmentId)
        put("name", attachment.name?.let(::JsonPrimitive) ?: JsonNull); put("bytes", attachment.bytes)
        if (attachment is SessionImageAttachment) {
            put("mediaType", attachment.mediaType); put("width", attachment.width); put("height", attachment.height)
            attachment.originalDimensions?.let { dimensions -> put("originalDimensions", buildJsonObject {
                put("width", dimensions.width); put("height", dimensions.height)
            }) }
        }
    }

    private fun assertShareReviewVisible() {
        compose.waitUntil(20_000) {
            androidx.core.view.ViewCompat.getRootWindowInsets(compose.activity.window.decorView)
                ?.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) == false
        }
        for (tag in listOf("share-target-host", "share-target-session", "share-add-to-draft", "share-dismiss")) {
            compose.onNodeWithTag(tag).assertIsDisplayed()
        }
    }

    private fun attachmentReceiptRefusal(previous: PromptSubmissionFailure? = null): JsonObject {
        val model = companionModel().session
        compose.waitUntil(30_000) {
            val failure = model.sendFailure.value
            failure != null && failure !== previous && failure.attachmentReceiptUnavailable && !model.sending.value
        }
        val envelope = checkNotNull(model.sendFailure.value?.refusal)
        compose.onNodeWithTag("session-send-error")
            .assertTextEquals(compose.activity.getString(R.string.native_prompt_attachment_unavailable)).assertIsDisplayed()
        return buildJsonObject {
            put("code", envelope.code)
            put("reason", checkNotNull(envelope.details?.let { WireShape.string(it, "reason") }))
        }
    }

    @Test fun pairAnswerAndReadPages() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        check(instrumentation.targetContext.packageName.endsWith(".nativeacceptance"))
        val name = requireNotNull(InstrumentationRegistry.getArguments().getString("dshSocket"))
        require(name.matches(Regex("dsh-native-[a-f0-9-]+")))
        var paired = false
        var failed = false
        withDriverServer(name) { server ->
            server.accept().use { socket ->
                socket.soTimeout = 120_000
                val input = socket.inputStream.bufferedReader(Charsets.UTF_8)
                val output = socket.outputStream.bufferedWriter(Charsets.UTF_8)
                output.write("{\"ready\":true}\n"); output.flush()
                while (true) {
                    val command = input.readLine()?.let { Json.parseToJsonElement(it).jsonObject } ?: break
                    val id = command.getValue("id").jsonPrimitive.content
                    val op = command.getValue("op").jsonPrimitive.content
                    var value: JsonElement = JsonNull
                    var type = "ok"
                    var stage = op
                    var failureDiagnostics: (() -> JsonObject)? = null
                    try {
                        when (op) {
                            "foregroundSnapshot" -> value = foregroundSnapshot()
                            "pushNotificationSnapshot" -> value = pushNotificationSnapshot()
                            "notificationPermissionSnapshot" -> value = notificationPermissionSnapshot()
                            "answerNotificationPermission" -> {
                                val action = command.getValue("answer").jsonPrimitive.content
                                check(action in setOf("allow", "deny"))
                                val button = permissionDialogNodes().single { it.viewIdResourceName?.endsWith(":id/permission_${action}_button") == true }
                                check(button.isEnabled && button.isClickable && button.isVisibleToUser)
                                check(button.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
                            }
                            "openNotificationSettings" -> {
                                compose.onNodeWithTag("native-notification-disabled").assertIsDisplayed()
                                compose.onNodeWithTag("native-notification-settings").performClick()
                            }
                            "enableNotificationsInSettings" -> {
                                val bar = checkNotNull(notificationSettingsBar())
                                val switch = descendants(bar).single { it.viewIdResourceName == "android:id/switch_widget" }
                                check(!switch.isChecked && bar.isEnabled && bar.isClickable && bar.isVisibleToUser)
                                check(bar.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
                            }
                            "assertNotificationEnabled" -> {
                                compose.waitUntil(20_000) {
                                    (instrumentation.targetContext.applicationContext as CompanionApplication).notificationGrant.state.value.systemEnabled
                                }
                                compose.onNodeWithTag("native-notification-disabled").assertDoesNotExist()
                            }
                            "clearPushNotification" -> {
                                val manager = instrumentation.targetContext.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                                manager.cancel(70)
                            }
                            "systemHome" -> check(instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME))
                            "openNotificationShade" -> check(instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS))
                            "notificationShadeReady" -> value = JsonPrimitive(systemNotificationNodes().any {
                                it.text?.toString() == pushTitle(CompanionPush.ApprovalWaiting("fixture", "fixture"))
                            })
                            "clickPushNotification" -> clickPushNotification()
                            "dismissSystemOverlay" -> check(instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
                            "subagentCatalog" -> {
                                compose.onNodeWithTag("native-tab-6").performClick()
                                if (command["refresh"]?.jsonPrimitive?.boolean == true) {
                                    waitFor(hasTestTag("native-subagent-refresh") and isEnabled())
                                    compose.onNodeWithTag("native-subagent-refresh").performClick()
                                }
                                val model = companionModel().subagents
                                val expected = command.getValue("state").jsonPrimitive.content
                                when (expected) {
                                    "ready" -> compose.waitUntil(20_000) { model.listing.value.state == SubagentListState.Ready }
                                    "failed" -> waitFor(hasTestTag("native-subagent-list-error"))
                                    "empty" -> waitFor(hasTestTag("native-subagent-empty"))
                                    "no-parent" -> waitFor(hasTestTag("native-subagent-no-parent"))
                                    else -> error("unknown catalog state")
                                }
                                command["rows"]?.jsonArray?.forEach { id ->
                                    val tag = "subagent-row-${id.jsonPrimitive.content}"
                                    compose.onNodeWithTag("native-subagent-list").performScrollToNode(hasTestTag(tag))
                                    compose.onNodeWithTag(tag).assertIsDisplayed()
                                }
                                value = buildJsonObject {
                                    val listing = model.listing.value
                                    put("parent", listing.parentSessionId?.let(::JsonPrimitive) ?: JsonNull)
                                    put("parentAvailable", listing.parentAvailable?.let(::JsonPrimitive) ?: JsonNull)
                                    put("rows", JsonArray(listing.rows.map { JsonPrimitive(it.id) }))
                                }
                            }
                            "openSubagent" -> {
                                val child = command.getValue("child").jsonPrimitive.content
                                val tag = "subagent-open-$child"
                                compose.onNodeWithTag("native-subagent-list").performScrollToNode(hasTestTag(tag))
                                compose.onNodeWithTag(tag).performClick()
                                waitFor(hasTestTag("native-child-timeline"))
                                val model = companionModel().subagents
                                compose.waitUntil(20_000) { model.childTimeline.value?.let { it.row.id == child && it.history.value.ready } == true }
                                for (control in listOf("session-draft", "session-send", "session-cancel")) {
                                    compose.onNodeWithTag(control).assertDoesNotExist()
                                }
                                val text = command.getValue("text").jsonPrimitive.content
                                compose.onNodeWithTag("native-child-rows").performScrollToNode(hasText(text, substring = true))
                                compose.onNodeWithText(text, substring = true).assertIsDisplayed()
                            }
                            "childLoadOlder" -> {
                                val view = checkNotNull(companionModel().subagents.childTimeline.value)
                                val before = checkNotNull(view.open.value).state.items.first().seq
                                compose.onNodeWithTag("native-child-load-older").performClick()
                                compose.waitUntil(20_000) { !view.history.value.loading && view.open.value!!.state.items.first().seq < before }
                                value = JsonPrimitive(view.open.value!!.state.items.first().seq)
                            }
                            "childBack" -> {
                                val view = checkNotNull(companionModel().subagents.childTimeline.value)
                                compose.onNodeWithTag("native-child-back").performClick()
                                waitFor(hasTestTag("native-subagent-list"))
                                compose.waitUntil(20_000) { view.open.value == null }
                            }
                            "childPageFailure" -> {
                                val view = checkNotNull(companionModel().subagents.childTimeline.value)
                                val before = checkNotNull(view.open.value).state.items.toList()
                                compose.onNodeWithTag("native-child-load-older").performClick()
                                waitFor(hasTestTag("native-child-error"))
                                check(view.open.value!!.state.items == before)
                            }
                            "childReconnect" -> {
                                compose.onNodeWithTag("native-child-reconnect").performClick()
                                val view = checkNotNull(companionModel().subagents.childTimeline.value)
                                compose.waitUntil(20_000) { view.history.value.ready && view.history.value.failure == null }
                            }
                            "assertOperationVisibility" -> {
                                compose.onNodeWithTag("native-tab-${command.getValue("tab").jsonPrimitive.int}").performClick()
                                command["entry"]?.jsonPrimitive?.content?.let { path ->
                                    val tag = "file-entry-$path"
                                    waitFor(hasTestTag(tag))
                                    compose.onNodeWithTag(tag).performScrollTo()
                                }
                                compose.waitForIdle()
                                for ((tag, visible) in command.getValue("visible").jsonObject) {
                                    if (visible.jsonPrimitive.boolean) {
                                        waitFor(hasTestTag(tag))
                                        compose.onNodeWithTag(tag).assertExists()
                                    } else compose.onNodeWithTag(tag).assertDoesNotExist()
                                }
                            }
                            "assertStoredPromptDraft" -> {
                                val sessionId = command.getValue("sessionId").jsonPrimitive.content
                                val expected = command.getValue("text").jsonPrimitive.content
                                val model = companionModel()
                                compose.runOnIdle { check(model.session.input.value.drafts[sessionId]?.text == expected) }
                            }
                            "probeUnsupportedOperations" -> {
                                val codes = mutableListOf<String>()
                                runBlocking {
                                    kotlinx.coroutines.withTimeout(5_000) {
                                        for (endpoint in command.getValue("calls").jsonArray) {
                                            try {
                                                CompanionRuntime.wire.call(endpoint.jsonPrimitive.content)
                                                error("unsupported unary operation dispatched")
                                            } catch (failure: ai.deepseek.dsh.link.LinkClientException.Refused) { codes.add(failure.code) }
                                        }
                                        for (endpoint in command.getValue("streams").jsonArray) {
                                            try {
                                                CompanionRuntime.wire.stream(endpoint.jsonPrimitive.content).collect { error("unsupported stream opened") }
                                                error("unsupported stream completed")
                                            } catch (failure: ai.deepseek.dsh.link.LinkClientException.Refused) { codes.add(failure.code) }
                                        }
                                    }
                                }
                                value = JsonArray(codes.map(::JsonPrimitive))
                            }
                            "expectCancelRefusal" -> {
                                compose.onNodeWithTag("native-tab-0").performClick()
                                waitFor(hasTestTag("session-cancel") and isEnabled())
                                compose.onNodeWithTag("session-cancel").performClick()
                                waitFor(hasTestTag("session-cancel-error"))
                                compose.onNodeWithTag("session-cancel-error").assertIsDisplayed()
                            }
                            "capabilityDetails" -> {
                                check(paired)
                                if (compose.onAllNodesWithTag("native-capabilities-state").fetchSemanticsNodes(false).isEmpty()) {
                                    compose.onNodeWithTag("native-capabilities-open").performClick()
                                }
                                if (command["refresh"]?.jsonPrimitive?.boolean == true) {
                                    waitFor(hasTestTag("native-capabilities-refresh") and isEnabled())
                                    compose.onNodeWithTag("native-capabilities-refresh").performClick()
                                }
                                val expected = when (command.getValue("state").jsonPrimitive.content) {
                                    "available" -> R.string.native_capabilities_available
                                    "failed" -> R.string.native_capabilities_failed
                                    else -> error("unknown expected capability state")
                                }
                                waitFor(hasTestTag("native-capabilities-state") and hasText(instrumentation.targetContext.getString(expected)))
                                val texts = compose.onAllNodes(hasAnyAncestor(hasTestTag("native-capabilities-content")), useUnmergedTree = true)
                                    .fetchSemanticsNodes().flatMap { it.config.getOrElse(SemanticsProperties.Text) { emptyList() } }.map { it.text }
                                value = buildJsonObject {
                                    put("texts", JsonArray(texts.map(::JsonPrimitive)))
                                    if (command["screenshot"]?.jsonPrimitive?.boolean == true) {
                                        val bytes = ByteArrayOutputStream()
                                        compose.waitForIdle()
                                        // Dialogs have their own Android window; Compose root capture reads the Activity underneath.
                                        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                                        try { bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes) }
                                        finally { bitmap.recycle() }
                                        put("screenshot", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                                    }
                                }
                            }
                            "closeCapabilityDetails" -> compose.onNodeWithTag("native-capabilities-close").performClick()
                            "supportDocument" -> {
                                val model = companionModel()
                                command["minimumAttempts"]?.jsonPrimitive?.long?.let { attempts ->
                                    compose.waitUntil(20_000) {
                                        model.session.connectionSnapshot.let { it.attempts >= attempts && it.state == ConnectionState.OPEN }
                                    }
                                }
                                if (command["refresh"]?.jsonPrimitive?.boolean == true) {
                                    runBlocking { CompanionRuntime.wire.refreshHostDescription() }
                                }
                                lateinit var snapshot: SupportLocalSnapshot
                                compose.runOnIdle { snapshot = model.supportSnapshot() }
                                val context = instrumentation.targetContext
                                val application = context.applicationContext as CompanionApplication
                                val approved = runBlocking {
                                    SupportDocumentExporter(AndroidSupportScanner(context), SupportExportPolicy(1024 * 1024, 10_000))
                                        .prepare(application.supportProduct, snapshot)
                                }
                                value = Json.parseToJsonElement(approved.copyBytes().decodeToString())
                            }
                            "pair" -> {
                                waitFor(hasText("配对载荷（二维码内容）"))
                                compose.onNodeWithText("配对载荷（二维码内容）").performTextInput(command.getValue("payload").toString())
                                compose.onNodeWithText("设备名称").performScrollTo().performTextInput("Android acceptance")
                                compose.onNodeWithText("配对", substring = false).performScrollTo().performClick()
                                waitFor(hasText("审批"))
                                paired = true
                                value = JsonPrimitive(android.os.Process.myPid())
                            }
                            "assertRestored" -> {
                                waitFor(hasText("审批"))
                                compose.onNodeWithText("配对载荷（二维码内容）").assertDoesNotExist()
                                paired = true
                                value = JsonPrimitive(android.os.Process.myPid())
                            }
                            "watchInteractions" -> {
                                compose.onNodeWithTag("native-tab-1").performClick()
                                compose.waitForIdle()
                            }
                            "answerQuestion" -> {
                                waitFor(hasText("Blue"))
                                compose.onNodeWithText("Blue").performScrollTo().performClick()
                                compose.onNodeWithText("自定义回答").performScrollTo().performTextInput(command.getValue("custom").jsonPrimitive.content)
                                compose.onNodeWithText("提交回答").performScrollTo().performClick()
                                compose.waitUntil(20_000) { compose.onAllNodesWithText("提交回答").fetchSemanticsNodes(false).isEmpty() }
                            }
                            "fillQuestionDraft" -> {
                                waitFor(hasText("Blue"))
                                compose.onNodeWithText("Blue").performScrollTo().performClick()
                                compose.onNodeWithText("自定义回答").performScrollTo().performTextInput(command.getValue("custom").jsonPrimitive.content)
                            }
                            "assertQuestionDraft" -> {
                                compose.onNodeWithTag("native-tab-1").performClick()
                                waitFor(hasText("Blue"))
                                compose.onNodeWithText("Blue").performScrollTo().assertIsOn()
                                compose.onNodeWithText("自定义回答").performScrollTo().assertTextContains(command.getValue("custom").jsonPrimitive.content)
                                waitFor(hasText("提交回答") and isEnabled())
                            }
                            "assertNoQuestion" -> {
                                compose.onNodeWithTag("native-tab-1").performClick()
                                val interactions = companionModel().interactions
                                compose.waitUntil(20_000) { interactions.clientId.value.isNotEmpty() }
                                compose.waitUntil(20_000) { compose.onAllNodesWithText("提交回答").fetchSemanticsNodes(false).isEmpty() }
                                compose.runOnIdle {
                                    assert(interactions.inbox.value.isEmpty()) { "pending interactions must stay scoped to their own Host" }
                                }
                                val absent = command.getValue("absent").jsonPrimitive.content
                                assert(compose.onAllNodesWithText(absent).fetchSemanticsNodes(false).isEmpty()) { "question content must stay scoped to its own Host: $absent" }
                            }
                            "submitQuestionDraft" -> {
                                compose.onNodeWithText("提交回答").performScrollTo().performClick()
                                try {
                                    compose.waitUntil(20_000) { compose.onAllNodesWithText("提交回答").fetchSemanticsNodes(false).isEmpty() }
                                } finally {
                                    val model = companionModel().interactions
                                    val failure = model.replyFailure.value
                                    stage = when (failure?.refusal?.code) {
                                        "interaction-closed" -> "reply-interaction-closed"
                                        "revision-conflict" -> "reply-revision-conflict"
                                        "gateway/input-invalid" -> "reply-input-invalid"
                                        "gateway/permission-denied" -> "reply-permission-denied"
                                        "device/replay-detected" -> "reply-proof-replayed"
                                        else -> when {
                                            failure != null -> "reply-" + failure.category.wire
                                            model.answering.value -> "reply-pending"
                                            model.clientId.value.isEmpty() -> "reply-no-client"
                                            model.inbox.value.isEmpty() -> "reply-completed"
                                            model.lastRefusal.value != null -> "reply-local-refusal"
                                            else -> "reply-unsettled"
                                        }
                                    }
                                }
                            }
                            "failQuestionDraft" -> {
                                compose.onNodeWithText("提交回答").performScrollTo().performClick()
                                val model = companionModel().interactions
                                compose.waitUntil(30_000) { model.lastRefusal.value != null && !model.answering.value }
                                compose.onNodeWithText("提交回答").assertExists()
                                compose.onNodeWithText("自定义回答").performScrollTo().assertTextContains(command.getValue("custom").jsonPrimitive.content)
                            }
                            "switchSessionTab" -> compose.onNodeWithTag("native-tab-0").performClick()
                            "fillPromptDraft" -> {
                                compose.onNodeWithTag("session-draft").performTextInput(command.getValue("text").jsonPrimitive.content)
                            }
                            "submitPromptDraft" -> compose.onNodeWithText("发送").performClick()
                            "submitPromptSteer" -> compose.onNodeWithTag("session-steer").performClick()
                            "openSystemFileShare" -> {
                                val names = command.getValue("names").jsonArray.map { it.jsonPrimitive.content }
                                require(names.size in 1..2 && names.all { it.matches(Regex("dsh-native-share-[a-f0-9-]+-(image\\.png|file\\.bin)")) })
                                stage = "share-open-downloads"
                                compose.runOnIdle {
                                    compose.activity.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW)
                                        .setDataAndType(android.net.Uri.parse("content://com.android.providers.downloads.documents/root/downloads"), "vnd.android.document/root")
                                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                                }
                                stage = "share-select-first-source"
                                compose.waitUntil(20_000) { documentNodes().any { it.text?.toString() == names.first() } }
                                documentNodes().firstOrNull { it.contentDescription?.toString() in setOf("Cancel", "取消") }
                                    ?.let(::clickDocumentNode)
                                compose.waitUntil(20_000) { documentNodes().none { it.contentDescription?.toString() in setOf("Cancel", "取消") } }
                                longClickDocumentNode(documentNodes().first { it.text?.toString() == names.first() })
                                compose.waitUntil(20_000) { documentNodes().any { it.text?.toString() == "1 selected" } }
                                for ((index, name) in names.drop(1).withIndex()) {
                                    stage = "share-select-next-source"
                                    compose.waitUntil(20_000) { documentNodes().any { it.text?.toString() == name } }
                                    clickDocumentNode(documentNodes().first { it.text?.toString() == name })
                                    compose.waitUntil(20_000) { documentNodes().any { it.text?.toString() == "${index + 2} selected" } }
                                }
                                fun share() = documentNodes().firstOrNull {
                                    it.isVisibleToUser && (it.contentDescription?.toString() in setOf("Share", "分享", "共享") ||
                                        it.text?.toString() in setOf("Share", "分享", "共享"))
                                }
                                stage = "share-open-chooser"
                                compose.waitUntil(20_000) { share() != null }
                                clickDocumentNode(checkNotNull(share()))
                                stage = "share-find-acceptance-receiver"
                                compose.waitUntil(20_000) { chooserNodes().any { it.text?.toString() == "DSH Companion (acceptance)" } }
                                val bytes = ByteArrayOutputStream()
                                val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                                try { bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes) } finally { bitmap.recycle() }
                                value = buildJsonObject {
                                    put("package", chooserNodes().first().packageName.toString())
                                    put("screenshot", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                                }
                            }
                            "chooseShareReceiver" -> {
                                val node = chooserNodes().first { it.text?.toString() == "DSH Companion (acceptance)" }
                                clickDocumentNode(node)
                                waitFor(hasTestTag("share-intake"))
                                compose.waitUntil(20_000) { compose.activity.shareIntake.phase == NativeSharePhase.REVIEW }
                                assertShareReviewVisible()
                            }
                            "deliverSharedText" -> {
                                val text = command.getValue("text").jsonPrimitive.content
                                compose.runOnIdle {
                                    compose.activity.startActivity(android.content.Intent(android.content.Intent.ACTION_SEND)
                                        .setClass(compose.activity, MainActivity::class.java).setType("text/plain")
                                        .putExtra(android.content.Intent.EXTRA_TEXT, text))
                                }
                                waitFor(hasTestTag("share-intake"))
                                compose.waitUntil(20_000) { compose.activity.shareIntake.phase == NativeSharePhase.REVIEW }
                                assertShareReviewVisible()
                            }
                            "shareIntakeSnapshot" -> {
                                compose.runOnIdle {
                                    val intake = compose.activity.shareIntake
                                    value = buildJsonObject {
                                        put("phase", intake.phase.name); put("arrival", intake.arrival)
                                        put("text", intake.payload?.text?.let(::JsonPrimitive) ?: JsonNull)
                                        put("count", intake.payload?.items?.size ?: 0)
                                    }
                                }
                            }
                            "confirmSharedDraft" -> {
                                waitFor(hasTestTag("share-add-to-draft") and isEnabled())
                                compose.onNodeWithTag("share-add-to-draft").assertIsDisplayed().performClick()
                            }
                            "dismissSharedDraft" -> compose.onNodeWithTag("share-dismiss").assertIsDisplayed().performClick()
                            "shareSourceNames" -> {
                                check(compose.activity.shareIntake.phase == NativeSharePhase.IMPORTING)
                                val items = checkNotNull(compose.activity.shareIntake.payload).items
                                value = JsonArray(items.map { JsonPrimitive(checkNotNull(AndroidNativeFileAttachmentSource(
                                    instrumentation.targetContext.contentResolver, it.uri).name())) })
                            }
                            "shareDraftSnapshot" -> {
                                val model = companionModel().session
                                val id = checkNotNull(model.open.value).sessionId
                                val draft = model.input.value.drafts[id]
                                value = buildJsonObject {
                                    put("requestId", draft?.requestId?.let(::JsonPrimitive) ?: JsonNull)
                                    put("text", draft?.text.orEmpty())
                                    put("attachments", JsonArray(draft?.attachments.orEmpty().map(::attachmentJson)))
                                }
                            }
                            "assertShareSubmissionBlocked" -> {
                                check(compose.activity.shareIntake.phase == NativeSharePhase.IMPORTING)
                                val model = companionModel().session
                                runBlocking { check(!model.sendDraft()) }
                                check(!model.sending.value && model.input.value.pendingPrompts.isEmpty())
                            }
                            "openCamera" -> {
                                waitFor(hasTestTag("session-attach") and isEnabled())
                                compose.onNodeWithTag("session-attach").performClick()
                                waitFor(hasTestTag("session-attach-camera"))
                                compose.onNodeWithTag("session-attach-camera").performClick()
                                compose.waitUntil(20_000) { cameraNodes().isNotEmpty() }
                                val bytes = ByteArrayOutputStream()
                                val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                                try { bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes) } finally { bitmap.recycle() }
                                value = buildJsonObject {
                                    put("package", cameraNodes().first().packageName.toString())
                                    put("screenshot", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                                }
                            }
                            "finishCameraCapture" -> {
                                fun shutter() = cameraNodes().firstOrNull {
                                    it.viewIdResourceName == "com.android.camera2:id/shutter_button" && it.isEnabled && it.isVisibleToUser
                                }
                                compose.waitUntil(20_000) { shutter() != null }
                                clickDocumentNode(checkNotNull(shutter()))
                                fun done() = cameraNodes().firstOrNull {
                                    it.viewIdResourceName in setOf("com.android.camera2:id/done_button", "com.android.camera2:id/btn_done") && it.isEnabled && it.isVisibleToUser
                                }
                                compose.waitUntil(20_000) { done() != null }
                                clickDocumentNode(checkNotNull(done()))
                                compose.waitUntil(20_000) { cameraNodes().isEmpty() }
                                waitFor(hasTestTag("session-attach"))
                            }
                            "cancelCamera" -> {
                                check(cameraNodes().isNotEmpty())
                                check(instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
                                compose.waitUntil(20_000) { cameraNodes().isEmpty() }
                                waitFor(hasTestTag("session-attach") and isEnabled())
                            }
                            "cameraTemporaryFiles" -> {
                                val root = java.io.File(instrumentation.targetContext.cacheDir, "native-camera/captures")
                                val files = root.listFiles().orEmpty().sortedBy { it.name }
                                value = JsonArray(files.map { file ->
                                    check(file.canonicalFile.parentFile == root.canonicalFile && file.isFile)
                                    check(file.name.matches(Regex("capture-[a-f0-9-]+\\.jpg")))
                                    val bytes = file.readBytes()
                                    val dimensions = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, dimensions)
                                    buildJsonObject {
                                        put("name", file.name); put("bytes", bytes.size)
                                        put("sha256", MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) })
                                        put("width", dimensions.outWidth); put("height", dimensions.outHeight)
                                    }
                                })
                            }
                            "decodeCameraImage" -> {
                                val bytes = Base64.decode(command.getValue("data").jsonPrimitive.content, Base64.NO_WRAP)
                                require(bytes.size in 1..1_048_576)
                                val metadata = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, metadata)
                                check(metadata.outWidth > 0 && metadata.outHeight > 0)
                                value = buildJsonObject {
                                    put("width", metadata.outWidth); put("height", metadata.outHeight); put("mediaType", metadata.outMimeType)
                                }
                            }
                            "assertAttachmentSendBlocked" -> {
                                val model = companionModel().session
                                check(companionModel().attachments.state.value.phase == NativeFileAttachmentPhase.UPLOADING)
                                compose.onNodeWithText("发送").assertIsNotEnabled()
                                val id = checkNotNull(model.open.value).sessionId
                                val draft = checkNotNull(model.input.value.drafts[id])
                                runBlocking { check(!model.sendDraft()) }
                                check(!model.sending.value && model.input.value.pendingPrompts.isEmpty())
                                check(model.input.value.drafts[id] == draft)
                            }
                            "stageTestPhoto" -> {
                                val filename = command.getValue("name").jsonPrimitive.content
                                require(filename.matches(Regex("dsh-native-photo-[A-Za-z0-9-]+\\.png")))
                                val data = Base64.decode(command.getValue("data").jsonPrimitive.content, Base64.NO_WRAP)
                                require(data.size in 8..524_288 && data.take(8) == listOf(137, 80, 78, 71, 13, 10, 26, 10).map(Int::toByte))
                                val dateTaken = System.currentTimeMillis()
                                val resolver = instrumentation.targetContext.contentResolver
                                val properties = android.content.ContentValues().apply {
                                    put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, filename)
                                    put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
                                    put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/DSHNativeAcceptance")
                                    put(android.provider.MediaStore.Images.Media.DATE_TAKEN, dateTaken)
                                    put(android.provider.MediaStore.Images.Media.IS_PENDING, 1)
                                }
                                val uri = checkNotNull(resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, properties))
                                try {
                                    checkNotNull(resolver.openOutputStream(uri, "w")).use { it.write(data) }
                                    check(resolver.update(uri, android.content.ContentValues().apply {
                                        put(android.provider.MediaStore.Images.Media.IS_PENDING, 0)
                                    }, null, null) == 1)
                                    check(instrumentation.targetContext.getSharedPreferences("native-test-photos", android.content.Context.MODE_PRIVATE)
                                        .edit().putString(uri.toString(), filename).commit())
                                } catch (failure: Exception) { resolver.delete(uri, null, null); throw failure }
                                value = buildJsonObject { put("uri", uri.toString()); put("name", filename); put("dateTaken", dateTaken) }
                            }
                            "cleanupTestPhoto" -> {
                                val uri = android.net.Uri.parse(command.getValue("uri").jsonPrimitive.content)
                                val owned = instrumentation.targetContext.getSharedPreferences("native-test-photos", android.content.Context.MODE_PRIVATE)
                                val filename = checkNotNull(owned.getString(uri.toString(), null))
                                check(uri.scheme == "content" && uri.authority == "media" && filename.matches(Regex("dsh-native-photo-[A-Za-z0-9-]+\\.png")))
                                check(instrumentation.targetContext.contentResolver.delete(uri, null, null) == 1)
                                check(owned.edit().remove(uri.toString()).commit())
                            }
                            "openPhotoPicker" -> {
                                waitFor(hasTestTag("session-attach") and isEnabled())
                                compose.onNodeWithTag("session-attach").performClick()
                                waitFor(hasTestTag("session-attach-photo"))
                                compose.onNodeWithTag("session-attach-photo").performClick()
                                compose.waitUntil(20_000) { photoNodes().isNotEmpty() }
                                val bytes = ByteArrayOutputStream()
                                val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                                try { bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes) } finally { bitmap.recycle() }
                                value = buildJsonObject {
                                    put("screenshot", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                                    put("package", photoNodes().first().packageName.toString())
                                }
                            }
                            "finishPhotoPick" -> {
                                val description = command["contentDescription"]?.jsonPrimitive?.content
                                val index = command["index"]?.jsonPrimitive?.int ?: 0
                                require(index >= 0)
                                fun candidates() = photoNodes().filter { node ->
                                    if (description != null) node.contentDescription?.toString() == description
                                    else node.viewIdResourceName?.endsWith(":id/icon_thumbnail") == true ||
                                        node.contentDescription?.toString()?.let { it.startsWith("Photo taken") || it.startsWith("拍摄于") } == true
                                }
                                compose.waitUntil(20_000) { candidates().size > index }
                                clickDocumentNode(candidates()[index])
                                compose.waitUntil(20_000) { photoNodes().isEmpty() }
                                waitFor(hasTestTag("session-attach"))
                                value = buildJsonObject { put("selected", true) }
                            }
                            "cancelPhotoPicker" -> {
                                check(photoNodes().isNotEmpty())
                                check(instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
                                compose.waitUntil(20_000) { photoNodes().isEmpty() }
                                waitFor(hasTestTag("session-attach") and isEnabled())
                            }
                            "assertMixedAttachments" -> {
                                val model = companionModel()
                                compose.waitUntil(20_000) { model.attachments.state.value.phase == NativeFileAttachmentPhase.IDLE }
                                val sessionId = checkNotNull(model.session.open.value).sessionId
                                val draft = model.session.input.value.drafts[sessionId]
                                val attachments = draft?.attachments.orEmpty()
                                for (attachment in attachments) compose.onNodeWithTag("session-attachment-${attachment.receiptId}").assertExists()
                                value = buildJsonObject {
                                    put("requestId", draft?.requestId?.let(::JsonPrimitive) ?: JsonNull)
                                    put("text", draft?.text.orEmpty())
                                    put("attachments", JsonArray(attachments.map(::attachmentJson)))
                                }
                            }
                            "openAttachmentPicker" -> {
                                waitFor(hasTestTag("session-attach") and isEnabled())
                                compose.onNodeWithTag("session-attach").performClick()
                                waitFor(hasTestTag("session-attach-file"))
                                compose.onNodeWithTag("session-attach-file").performClick()
                                compose.waitUntil(20_000) { documentNodes().isNotEmpty() }
                                val bytes = ByteArrayOutputStream()
                                val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                                try { bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes) } finally { bitmap.recycle() }
                                value = JsonPrimitive(Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                            }
                            "finishAttachmentPick" -> {
                                val filename = command.getValue("filename").jsonPrimitive.content
                                if (documentNodes().none { it.text?.toString() == filename }) {
                                    val roots = documentNodes().firstOrNull { it.contentDescription?.toString() in setOf(
                                        "Show roots", "Show navigation drawer", "Open navigation drawer", "显示根目录", "打开导航抽屉", "显示导航抽屉") }
                                        ?: error("system document locations action unavailable")
                                    clickDocumentNode(roots)
                                    compose.waitUntil(20_000) { documentNodes().any { it.text?.toString() in setOf("Downloads", "下载") } }
                                    clickDocumentNode(documentNodes().first { it.text?.toString() in setOf("Downloads", "下载") })
                                }
                                compose.waitUntil(20_000) { documentNodes().any { it.text?.toString() == filename } }
                                clickDocumentNode(documentNodes().first { it.text?.toString() == filename })
                                compose.waitUntil(20_000) { documentNodes().isEmpty() }
                                waitFor(hasTestTag("session-attach"))
                            }
                            "cancelAttachmentPicker" -> {
                                check(documentNodes().isNotEmpty())
                                check(instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
                                compose.waitUntil(20_000) { documentNodes().isEmpty() }
                                waitFor(hasTestTag("session-attach") and isEnabled())
                            }
                            "assertAttachments" -> {
                                val model = companionModel().session
                                val sessionId = checkNotNull(model.open.value).sessionId
                                val expected = command.getValue("files").jsonArray.map { file ->
                                    file.jsonObject.getValue("name").jsonPrimitive.content to file.jsonObject.getValue("bytes").jsonPrimitive.long
                                }
                                compose.waitUntil(20_000) {
                                    model.input.value.drafts[sessionId]?.attachments.orEmpty().filterIsInstance<SessionFileAttachment>().map { it.name to it.bytes } == expected
                                }
                                val draft = model.input.value.drafts[sessionId]
                                val files = draft?.attachments.orEmpty().filterIsInstance<SessionFileAttachment>()
                                for (file in files) compose.onNodeWithTag("session-attachment-${file.receiptId}").assertExists()
                                value = buildJsonObject {
                                    put("requestId", draft?.requestId?.let(::JsonPrimitive) ?: JsonNull)
                                    put("files", JsonArray(files.map { file -> buildJsonObject {
                                        put("receiptId", file.receiptId); put("attachmentId", file.attachmentId)
                                        put("name", file.name); put("bytes", file.bytes)
                                    } }))
                                }
                            }
                            "assertAttachmentFailure" -> {
                                val model = companionModel().attachments
                                val issue = command.getValue("issue").jsonPrimitive.content
                                compose.waitUntil(20_000) { model.state.value.let {
                                    it.phase == NativeFileAttachmentPhase.FAILED && it.issue?.name == issue
                                } }
                                compose.onNodeWithTag("session-attachment-error").assertIsDisplayed()
                            }
                            "removeAttachment" -> {
                                val receiptId = command.getValue("receiptId").jsonPrimitive.content
                                compose.onNodeWithTag("session-attachment-remove-$receiptId").performScrollTo().performClick()
                                compose.waitUntil(20_000) { compose.onAllNodesWithTag("session-attachment-$receiptId").fetchSemanticsNodes(false).isEmpty() }
                            }
                            "assertAttachmentInputsEncrypted" -> {
                                val model = companionModel()
                                runBlocking { model.inputs.flush() }
                                check(model.inputs.persistence.value == InputPersistenceStatus.SAVED)
                                val sessionId = checkNotNull(model.session.open.value).sessionId
                                val draft = checkNotNull(model.session.input.value.drafts[sessionId])
                                check(draft.attachments.isNotEmpty())
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-input")
                                    .listFiles()!!.filter { it.extension == "state" }
                                check(stored.isNotEmpty())
                                val privateValues = (draft.attachments.flatMap { listOfNotNull(it.name, it.receiptId, it.attachmentId) } +
                                    listOf(draft.text, draft.requestId)).filter(String::isNotEmpty)
                                for (file in stored) {
                                    val raw = file.readBytes().toString(Charsets.UTF_8)
                                    check(privateValues.none(raw::contains))
                                }
                            }
                            "assertAttachmentMessage" -> {
                                val seq = command.getValue("seq").jsonPrimitive.long
                                val names = command.getValue("names").jsonArray.map { it.jsonPrimitive.content }
                                val model = companionModel().session
                                compose.waitUntil(20_000) { model.state.items.any { item -> item.seq == seq && names.all(item.text::contains) } }
                                val item = model.state.items.single { it.seq == seq }
                                compose.onNodeWithTag("session-rows").performScrollToNode(hasTestTag("session-event-$seq"))
                                compose.onNodeWithTag("session-event-$seq").assertIsDisplayed()
                                compose.onNodeWithText(item.text).assertIsDisplayed()
                                value = JsonPrimitive(item.text)
                            }
                            "openSession" -> {
                                stage = "open-session-tab"
                                compose.onNodeWithTag("native-tab-0").performClick()
                                val sessionId = command.getValue("sessionId").jsonPrimitive.content
                                val model = companionModel().session
                                var openedBy = "already-open"
                                if (model.open.value?.sessionId != sessionId) {
                                    if (model.open.value != null) compose.onNodeWithTag("session-return-list").performClick()
                                    val tag = "session-open-$sessionId"
                                    stage = "open-session-row-or-restored"
                                    compose.waitUntil(20_000) {
                                        model.open.value?.sessionId == sessionId || compose.onAllNodesWithTag(tag).fetchSemanticsNodes(false).isNotEmpty()
                                    }
                                    openedBy = "restored-during-wait"
                                    if (model.open.value?.sessionId != sessionId) {
                                        try { compose.onNodeWithTag(tag).performScrollTo().performClick(); openedBy = "row" }
                                        catch (missingRow: AssertionError) {
                                            // Restoration may remove the row between its observation and the UI action.
                                            if (model.open.value?.sessionId != sessionId) throw missingRow
                                        }
                                    }
                                }
                                stage = "open-session-draft-ready"
                                waitFor(hasTestTag("session-draft") and isEnabled())
                                check(model.open.value?.sessionId == sessionId)
                                value = buildJsonObject { put("openedBy", openedBy) }
                            }
                            "assertPromptDraft" -> {
                                compose.onNodeWithTag("native-tab-0").performClick()
                                waitFor(hasTestTag("session-draft") and isEnabled() and hasText(command.getValue("text").jsonPrimitive.content))
                                compose.onNodeWithTag("session-draft").assertTextContains(command.getValue("text").jsonPrimitive.content)
                            }
                            "loadOlderHistory" -> {
                                val model = companionModel().session
                                compose.waitUntil(20_000) { model.history.value.ready }
                                val before = model.state.items.first().seq
                                compose.onNodeWithTag("session-load-older").performClick()
                                compose.waitUntil(20_000) { !model.history.value.loading && model.state.items.first().seq < before }
                                value = JsonPrimitive(model.state.items.first().seq)
                            }
                            "assertSessionWindow" -> {
                                val model = companionModel().session
                                val first = command.getValue("first").jsonPrimitive.long
                                val last = command.getValue("last").jsonPrimitive.long
                                val attempts = command.getValue("attempts").jsonPrimitive.long
                                failureDiagnostics = {
                                    val snapshot = model.connectionSnapshot
                                    val history = model.history.value
                                    val sequences = model.state.items.map { it.seq }
                                    buildJsonObject {
                                        put("expectedFirst", first); put("expectedLast", last); put("expectedAttempts", attempts)
                                        put("first", sequences.firstOrNull()?.let(::JsonPrimitive) ?: JsonNull)
                                        put("last", sequences.lastOrNull()?.let(::JsonPrimitive) ?: JsonNull)
                                        put("count", sequences.size); put("attempts", snapshot.attempts)
                                        put("connection", snapshot.state.wire)
                                        put("connectionFailure", snapshot.lastFailure?.wire?.let(::JsonPrimitive) ?: JsonNull)
                                        put("ready", history.ready); put("loading", history.loading)
                                        put("historyFailure", history.failure?.wire?.let(::JsonPrimitive) ?: JsonNull)
                                        put("contiguous", sequences.zipWithNext().all { (left, right) -> right == left + 1 })
                                    }
                                }
                                stage = "session-window-ready"
                                compose.waitUntil(20_000) {
                                    model.connectionSnapshot.attempts >= attempts && model.history.value.ready &&
                                        model.state.items.firstOrNull()?.seq == first && model.state.items.lastOrNull()?.seq == last
                                }
                                stage = "session-window-contiguous"
                                check(model.state.items.map { it.seq } == (first..last).toList())
                                stage = "session-window-scroll"
                                compose.onNodeWithTag("session-rows").performScrollToNode(hasTestTag("session-event-$last"))
                                stage = "session-window-display"
                                compose.onNodeWithTag("session-event-$last").assertIsDisplayed()
                            }
                            "assertEmptyPromptDraft" -> {
                                check(compose.onNodeWithTag("session-draft").fetchSemanticsNode().config[SemanticsProperties.EditableText].text.isEmpty())
                            }
                            "openViewLocation", "rejectViewLocation" -> {
                                val before = companionModel().session.open.value?.sessionId
                                val attempts = companionModel().session.connectionSnapshot.attempts
                                compose.onNodeWithTag("native-tab-0").performClick()
                                compose.onNodeWithTag("session-view-import").performClick()
                                compose.onNodeWithTag("session-view-payload").performTextInput(command.getValue("payload").jsonPrimitive.content)
                                compose.onNodeWithTag("session-view-confirm").performClick()
                                if (op == "rejectViewLocation") {
                                    waitFor(hasTestTag("session-view-error"))
                                    if (command["unchanged"]?.jsonPrimitive?.boolean == true) {
                                        check(companionModel().session.open.value?.sessionId == before)
                                        check(companionModel().session.connectionSnapshot.attempts == attempts)
                                    }
                                    compose.onNodeWithTag("session-view-cancel").performClick()
                                } else {
                                    compose.waitUntil(20_000) { compose.onAllNodesWithTag("session-view-payload").fetchSemanticsNodes(false).isEmpty() }
                                    val seq = command.getValue("anchor").jsonPrimitive.long
                                    stage = "view-anchor-visible"
                                    waitFor(hasTestTag("session-event-$seq"))
                                    compose.onNodeWithTag("session-event-$seq").assertIsDisplayed()
                                    check(companionModel().session.viewAnchor.value?.seq == seq)
                                }
                            }
                            "viewLinkSnapshot" -> {
                                val session = companionModel().session
                                compose.runOnIdle {
                                    val owner = compose.activity.viewLinkIntake
                                    value = buildJsonObject {
                                        put("phase", owner.phase.name); put("arrival", owner.arrival); put("attempt", owner.attempt)
                                        put("issue", owner.issue?.name?.let(::JsonPrimitive) ?: JsonNull)
                                        put("incomingRejected", owner.incomingRejected)
                                        put("sessionId", session.open.value?.sessionId?.let(::JsonPrimitive) ?: JsonNull)
                                        put("anchor", session.viewAnchor.value?.seq?.let(::JsonPrimitive) ?: JsonNull)
                                    }
                                }
                            }
                            "awaitViewLink" -> {
                                val expected = command.getValue("phase").jsonPrimitive.content
                                compose.waitUntil(30_000) { compose.activity.viewLinkIntake.phase.name == expected }
                                if (expected == "OPENED") {
                                    val sessionId = command.getValue("sessionId").jsonPrimitive.content
                                    val seq = command.getValue("anchor").jsonPrimitive.long
                                    check(companionModel().session.open.value?.sessionId == sessionId)
                                    waitFor(hasTestTag("session-event-$seq"))
                                    compose.onNodeWithTag("session-event-$seq").assertIsDisplayed()
                                    check(companionModel().session.viewAnchor.value?.seq == seq)
                                }
                            }
                            "retryViewLink" -> compose.onNodeWithTag("view-link-retry").assertIsDisplayed().performClick()
                            "cancelViewLink" -> compose.onNodeWithTag("view-link-cancel").assertIsDisplayed().performClick()
                            "dismissViewLink" -> compose.onNodeWithTag("view-link-dismiss").assertIsDisplayed().performClick()
                            "copyViewDeepLink" -> {
                                compose.onNodeWithTag("session-view-link-copy").assertIsDisplayed().performClick()
                                compose.waitForIdle()
                                val clipboard = instrumentation.targetContext.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                value = JsonPrimitive(clipboard.primaryClip!!.getItemAt(0).text.toString())
                            }
                            "scrollSessionToLatest" -> {
                                val model = companionModel().session
                                val open = checkNotNull(model.open.value)
                                val seq = open.state.items.last().seq
                                val pending = model.input.value.pendingPrompts.values.count { it.sessionId == open.sessionId }
                                compose.onNodeWithTag("session-rows").performScrollToIndex(pending + open.state.items.lastIndex)
                                compose.onNodeWithTag("session-event-$seq").assertIsDisplayed()
                            }
                            "copyViewLocation" -> {
                                compose.onNodeWithTag("session-view-copy").performClick()
                                compose.waitForIdle()
                                val clipboard = instrumentation.targetContext.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                value = JsonPrimitive(clipboard.primaryClip!!.getItemAt(0).text.toString())
                            }
                            "failPromptDraft" -> {
                                compose.onNodeWithText("发送").performClick()
                                waitFor(hasTestTag("session-send-error"))
                                compose.onNodeWithTag("session-send-error").assertIsDisplayed()
                                compose.onNodeWithTag("session-draft").assertTextContains(command.getValue("text").jsonPrimitive.content)
                            }
                            "observeSession" -> {
                                stage = "session-navigation"
                                compose.onNodeWithTag("native-tab-0").performClick()
                                val tag = "session-open-" + command.getValue("sessionId").jsonPrimitive.content
                                stage = "session-list-entry"
                                if (companionModel().session.open.value?.sessionId != command.getValue("sessionId").jsonPrimitive.content) {
                                    if (companionModel().session.open.value != null) compose.onNodeWithTag("session-return-list").performClick()
                                    waitFor(hasTestTag(tag))
                                    compose.onNodeWithTag(tag).performScrollTo().performClick()
                                }
                                stage = "session-done-projection"
                                val model = companionModel().session
                                compose.waitUntil(20_000) { model.open.value?.state?.items?.any { it.text.contains("DONE") } == true }
                                compose.onNodeWithTag("session-rows").performScrollToNode(hasText("DONE", substring = true))
                                compose.onNode(hasText("DONE", substring = true)).assertIsDisplayed()
                                value = buildJsonObject { put("done", true) }
                            }
                            "readModelFile" -> {
                                compose.onNodeWithTag("native-tab-4").performClick()
                                val tag = "file-entry-" + command.getValue("path").jsonPrimitive.content
                                waitFor(hasTestTag(tag))
                                stage = "directory-entry"
                                compose.onNodeWithTag(tag).performScrollTo()
                                compose.onNode(hasText("查看") and hasAnyAncestor(hasTestTag(tag))).performClick()
                                waitFor(hasTestTag("file-content"))
                                stage = "first-file-page"
                                compose.onNodeWithText("已加载 1000 行").assertExists()
                                compose.onNodeWithText("加载更多").performClick()
                                waitFor(hasText("已加载 1001 行"))
                                stage = "complete-file-text"
                                val text = compose.onNodeWithTag("file-content").fetchSemanticsNode().config[SemanticsProperties.Text].single().text
                                val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
                                value = buildJsonObject { put("lines", 1001); put("digest", digest) }
                            }
                            "previewResource" -> {
                                compose.onNodeWithTag("native-tab-4").performClick()
                                val tag = "resource-open-" + command.getValue("path").jsonPrimitive.content
                                waitFor(hasTestTag("resource-file-list"))
                                compose.onNodeWithTag("resource-file-list").performScrollToNode(hasTestTag(tag))
                                compose.onNodeWithTag(tag).performClick()
                            }
                            "openResourceSave", "openDownloadSave" -> {
                                val tag = if (op == "openDownloadSave") "download-save" else "resource-save"
                                waitFor(hasTestTag(tag) and isEnabled())
                                compose.onNodeWithTag(tag).performClick()
                                compose.waitUntil(20_000) { documentNodes().any { it.isEditable } }
                                value = buildJsonObject {
                                    put("filename", documentNodes().first { it.isEditable }.text.toString())
                                    put("controls", JsonArray(documentNodes().filter { it.isClickable }.map { JsonPrimitive(it.viewIdResourceName ?: it.className.toString()) }))
                                    val bytes = ByteArrayOutputStream()
                                    val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
                                    try { bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes) } finally { bitmap.recycle() }
                                    put("screenshot", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                                }
                            }
                            "finishResourceSave" -> {
                                val expected = command.getValue("filename").jsonPrimitive.content
                                check(documentNodes().first { it.isEditable }.text.toString() == expected)
                                val save = documentNodes().firstOrNull { it.isClickable && it.text?.toString() in setOf("SAVE", "Save", "保存") }
                                    ?: error("system Save action unavailable")
                                check(save.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
                                val message = if (command["expired"]?.jsonPrimitive?.boolean == true) R.string.native_resource_save_expired else R.string.native_resource_saved
                                waitFor(hasTestTag("resource-save-status") and hasText(instrumentation.targetContext.getString(message)))
                            }
                            "cancelResourceSave" -> {
                                check(instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
                                waitFor(hasTestTag("resource-save-status") and hasText(instrumentation.targetContext.getString(R.string.native_resource_save_cancelled)))
                            }
                            "retireResourceDuringPicker" -> {
                                val model = companionModel()
                                compose.runOnUiThread { model.files.closeFile() }
                            }
                            "assertNoResourceSave" -> compose.onNodeWithTag("resource-save").assertDoesNotExist()
                            "previewDelivery" -> {
                                compose.onNodeWithTag("native-tab-5").performClick()
                                val tag = "resource-delivery-${command.getValue("seq").jsonPrimitive.long}-${command.getValue("index").jsonPrimitive.int}"
                                waitFor(hasTestTag("resource-delivery-list"))
                                compose.onNodeWithTag("resource-delivery-list").performScrollToNode(hasTestTag(tag))
                                compose.onNodeWithTag(tag).performClick()
                            }
                            "resumeDownload", "pauseDownload", "removeDownload" -> {
                                val tag = when (op) {
                                    "resumeDownload" -> "download-resume"
                                    "pauseDownload" -> "download-pause"
                                    else -> "download-remove"
                                }
                                waitFor(hasTestTag(tag) and isEnabled())
                                compose.onNodeWithTag(tag).performClick()
                                if (op == "removeDownload") {
                                    waitFor(hasTestTag("download-remove-confirm"))
                                    compose.onNodeWithTag("download-remove-confirm").performClick()
                                    val model = companionModel().downloads
                                    compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.controller == null }
                                }
                            }
                            "assertNoDownload" -> {
                                val model = companionModel()
                                val target = checkNotNull(model.files.resource.state.value).target
                                compose.waitUntil(20_000) { model.downloads.state.value.let { !it.busy && it.target == target && it.controller == null } }
                                waitFor(hasTestTag("download-resume") and isEnabled())
                                compose.onNodeWithTag("download-save").assertDoesNotExist()
                            }
                            "downloadProgress" -> {
                                val model = companionModel().downloads.state.value
                                val state = model.controller?.state?.value
                                value = buildJsonObject {
                                    put("busy", model.busy)
                                    put("phase", state?.phase?.name?.let(::JsonPrimitive) ?: JsonNull)
                                    put("received", state?.checkpoint?.receivedBytes ?: 0)
                                    put("complete", state?.checkpoint?.complete ?: false)
                                }
                            }
                            "assertDownload" -> {
                                val phase = NativeDownloadPhase.valueOf(command.getValue("phase").jsonPrimitive.content)
                                val model = companionModel().downloads
                                compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.controller?.state?.value?.phase == phase }
                                val state = checkNotNull(model.state.value.controller).state.value
                                value = buildJsonObject {
                                    put("phase", state.phase.name)
                                    put("received", state.checkpoint?.receivedBytes ?: 0)
                                    put("complete", state.checkpoint?.complete ?: false)
                                }
                                compose.onNodeWithTag("download-status").assertIsDisplayed()
                                if (phase == NativeDownloadPhase.CHANGED || phase == NativeDownloadPhase.UNAVAILABLE) {
                                    compose.onNodeWithTag("download-save").assertDoesNotExist()
                                    compose.onNodeWithTag("download-resume").assertDoesNotExist()
                                }
                            }
                            "assertResource" -> {
                                val phase = NativeResourcePhase.valueOf(command.getValue("phase").jsonPrimitive.content)
                                val reader = companionModel().files.resource
                                compose.waitUntil(20_000) { reader.state.value?.phase == phase }
                                val tag = command["tag"]?.jsonPrimitive?.content
                                if (tag != null) { waitFor(hasTestTag(tag)); compose.onNodeWithTag(tag).assertIsDisplayed() }
                                command["textChars"]?.jsonPrimitive?.int?.let { count ->
                                    check(compose.onNodeWithTag("resource-text").fetchSemanticsNode().config[SemanticsProperties.Text].single().text.length == count)
                                }
                                val state = checkNotNull(reader.state.value)
                                value = buildJsonObject {
                                    put("received", state.receivedBytes)
                                    put("prefix", Base64.encodeToString(state.prefix, Base64.NO_WRAP))
                                    state.content?.let { bytes -> put("sha256", MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }) }
                                }
                            }
                            "retryResource" -> compose.onNodeWithTag("resource-retry").performClick()
                            "restartResource" -> compose.onNodeWithTag("resource-restart").performClick()
                            "closeResource" -> compose.onNodeWithTag("resource-close").performClick()
                            "screenshot" -> {
                                check(paired)
                                compose.onNodeWithText("配对载荷（二维码内容）").assertDoesNotExist()
                                val bytes = ByteArrayOutputStream()
                                compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, bytes)
                                value = JsonPrimitive(Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                            }
                            "expectRefusal" -> {
                                compose.onNodeWithTag("native-tab-1").performClick()
                                waitFor(hasText("本地数据已过期，刷新后重试"))
                                compose.onNodeWithText("本地数据已过期，刷新后重试").assertIsDisplayed()
                                compose.onNodeWithText("重新连接").assertIsDisplayed().assertIsEnabled()
                            }
                            "rejectRepairAndCancel" -> {
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-hosts.enc")
                                val before = stored.readBytes()
                                compose.onNodeWithTag("native-repair").performClick()
                                waitFor(hasText("配对载荷（二维码内容）"))
                                compose.onNodeWithText("配对载荷（二维码内容）").performTextInput(command.getValue("payload").toString())
                                compose.onNodeWithText("设备名称").performScrollTo().performTextInput("Android replacement")
                                compose.onNodeWithText("配对", substring = false).performScrollTo().performClick()
                                waitFor(hasTestTag("pairing-error"))
                                check(before.contentEquals(stored.readBytes())) { "Rejected replacement changed stored identity" }
                                compose.onNodeWithText("取消").performScrollTo().performClick()
                                waitFor(hasTestTag("native-repair"))
                                compose.onNodeWithTag("file-content").assertDoesNotExist()
                                compose.onNodeWithTag("native-tab-0").performClick()
                                compose.waitUntil(20_000) { companionModel().session.open.value?.sessionId == command.getValue("sessionId").jsonPrimitive.content }
                                compose.onNodeWithTag("native-tab-4").performClick()
                                val entry = "file-entry-" + command.getValue("path").jsonPrimitive.content
                                waitFor(hasTestTag(entry))
                            }
                            "repair" -> {
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-hosts.enc")
                                val before = stored.readBytes()
                                compose.onNodeWithTag("native-repair").performClick()
                                waitFor(hasText("配对载荷（二维码内容）"))
                                compose.onNodeWithText("配对载荷（二维码内容）").performTextInput(command.getValue("payload").toString())
                                compose.onNodeWithText("设备名称").performScrollTo().performTextInput("Android replacement")
                                compose.onNodeWithText("配对", substring = false).performScrollTo().performClick()
                                waitFor(hasTestTag("native-repair"))
                                check(!before.contentEquals(stored.readBytes())) { "Successful replacement did not commit identity" }
                                compose.onNodeWithTag("file-content").assertDoesNotExist()
                            }
                            "recreate" -> {
                                val previous = compose.activity
                                compose.runOnIdle { previous.recreate() }
                                compose.waitUntil(20_000) {
                                    compose.activity !== previous && compose.activity.lifecycle.currentState == androidx.lifecycle.Lifecycle.State.RESUMED
                                }
                                waitFor(hasTestTag("native-repair"))
                                compose.onNodeWithText("配对载荷（二维码内容）").assertDoesNotExist()
                            }
                            "damageCredentials" -> {
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-hosts.enc")
                                check(stored.isFile)
                                when (command.getValue("damage").jsonPrimitive.content) {
                                    "malformed" -> stored.writeText("{invalid credential document", Charsets.UTF_8)
                                    "ciphertext" -> {
                                        val sealed = stored.readBytes()
                                        sealed[sealed.lastIndex] = (sealed.last().toInt() xor 1).toByte()
                                        stored.writeBytes(sealed)
                                    }
                                    "missing-key" -> java.security.KeyStore.getInstance("AndroidKeyStore").apply {
                                        load(null); deleteEntry("dsh-native-hosts")
                                    }
                                    else -> error("unsupported credential damage")
                                }
                                value = JsonPrimitive(MessageDigest.getInstance("SHA-256").digest(stored.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) })
                            }
                            "assertCredentialRecovery" -> {
                                waitFor(hasText("无法读取已保存的 Host，原文件已保留。请保留副本并重新建立目录。"))
                                compose.onNodeWithText("无法读取已保存的 Host，原文件已保留。请保留副本并重新建立目录。").assertIsDisplayed()
                                compose.onNodeWithTag("native-repair").assertDoesNotExist()
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-hosts.enc")
                                val digest = MessageDigest.getInstance("SHA-256").digest(stored.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) }
                                stage = "preserved-damaged-document"
                                check(digest == command.getValue("digest").jsonPrimitive.content)
                                if (command.getValue("damage").jsonPrimitive.content == "missing-key") {
                                    stage = "read-does-not-create-key"
                                    check(!java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                                        .containsAlias("dsh-native-hosts"))
                                }
                            }
                            "recoverHostCatalog" -> {
                                compose.onNodeWithTag("native-host-start-fresh").performClick()
                                waitFor(hasText("配对载荷（二维码内容）"))
                                val backups = instrumentation.targetContext.filesDir.listFiles()!!.filter {
                                    it.name.startsWith("native-hosts.enc.unavailable-")
                                }
                                check(backups.any { file -> MessageDigest.getInstance("SHA-256").digest(file.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) } == command.getValue("digest").jsonPrimitive.content })
                            }
                            "prepareLegacyImport" -> {
                                val directory = instrumentation.targetContext.filesDir
                                val catalogFile = java.io.File(directory, "native-hosts.enc")
                                val catalog = FileNativeHostStore(catalogFile, AndroidKeystoreCipher("dsh-native-hosts"), 1_048_576).load()!!
                                val legacyFile = java.io.File(directory, "native-gateway-credentials.json")
                                ai.deepseek.dsh.link.FileLinkCredentialsStore(legacyFile, AndroidKeystoreCipher()).save(catalog.selected()!!)
                                check(catalogFile.delete())
                                value = JsonPrimitive(MessageDigest.getInstance("SHA-256").digest(legacyFile.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) })
                            }
                            "importLegacyHost" -> {
                                waitFor(hasTestTag("native-host-import"))
                                compose.onNodeWithTag("native-repair").assertDoesNotExist()
                                check(CompanionRuntime.hostState.value.status == NativeHostStatus.EMPTY)
                                compose.onNodeWithTag("native-host-import").performClick()
                                waitFor(hasTestTag("native-repair"))
                                val legacyFile = java.io.File(instrumentation.targetContext.filesDir, "native-gateway-credentials.json")
                                check(MessageDigest.getInstance("SHA-256").digest(legacyFile.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) } == command.getValue("digest").jsonPrimitive.content)
                                paired = true
                            }
                            "selectHost" -> {
                                val hostId = command.getValue("hostId").jsonPrimitive.content
                                val selected = CompanionRuntime.hostState.value.hosts.single { it.hostId == hostId }
                                compose.onNodeWithTag("native-host-chooser").performClick()
                                compose.onNodeWithTag("native-host-select-${selected.key.value}").performScrollTo().performClick()
                                compose.waitUntil(20_000) { CompanionRuntime.hostState.value.let {
                                    it.status == NativeHostStatus.READY && it.selected?.hostId == hostId
                                } }
                                waitFor(hasTestTag("native-repair"))
                                compose.onNodeWithTag("native-host-current").assertTextEquals("当前 Host：${selected.name}")
                            }
                            "assertCurrentHost" -> {
                                val state = CompanionRuntime.hostState.value
                                check(state.status == NativeHostStatus.READY)
                                check(state.selected!!.hostId == command.getValue("hostId").jsonPrimitive.content)
                                check(state.hosts.size == command.getValue("count").jsonPrimitive.int)
                                compose.onNodeWithTag("native-host-current").assertTextEquals("当前 Host：${state.selected!!.name}")
                            }
                            "assertSessionListReady" -> {
                                val model = companionModel()
                                try { compose.waitUntil(20_000) {
                                    model.session.listState.value !in setOf(SessionListState.Idle, SessionListState.Loading)
                                } }
                                finally {
                                    stage = when (val state = model.session.listState.value) {
                                        SessionListState.Ready -> "session-list-ready"
                                        SessionListState.Idle -> "session-list-idle"
                                        SessionListState.Loading -> "session-list-loading"
                                        is SessionListState.Failed -> {
                                            val refusal = state.refusal
                                            if (refusal?.code == "device/replay-detected") {
                                                when (refusal.details?.let { WireShape.string(it, "reason") }) {
                                                    "timestamp-regressed" -> "session-list-replay-timestamp-regressed"
                                                    "nonce-reuse" -> "session-list-replay-nonce-reuse"
                                                    else -> "session-list-replay-other"
                                                }
                                            } else "session-list-failed-" + state.category.wire
                                        }
                                    }
                                }
                                check(model.session.listState.value == SessionListState.Ready)
                            }
                            "refreshSessions" -> compose.onNodeWithTag("session-list-refresh").performClick()
                            "assertSessionListFailure" -> {
                                waitFor(hasTestTag("session-list-error"))
                                compose.onNodeWithTag("session-list-error").assertIsDisplayed()
                                compose.onNodeWithTag("session-list-refresh").assertIsEnabled()
                                val state = companionModel().session.listState.value as SessionListState.Failed
                                value = JsonPrimitive(state.category.wire)
                            }
                            "assertNoSessionSend" -> {
                                waitFor(hasText("暂无会话"))
                                compose.onNodeWithText("暂无会话").assertIsDisplayed()
                                compose.onNodeWithTag("session-list-error").assertDoesNotExist()
                                compose.onNodeWithText("发送").assertIsNotEnabled()
                                compose.onNodeWithText("停止").assertIsNotEnabled()
                            }
                            "inputCheckpoint" -> {
                                val inputs = companionModel().inputs
                                runBlocking { inputs.flush() }
                                check(inputs.persistence.value == InputPersistenceStatus.SAVED)
                                value = JsonPrimitive(android.os.Process.myPid())
                            }
                            "pendingPrompt" -> {
                                val pending = companionModel().inputs.state.value.pendingPrompts.values.single()
                                check(pending.draft.text == command.getValue("text").jsonPrimitive.content)
                                value = JsonPrimitive(pending.draft.requestId)
                            }
                            "assertPromptTransportFailure" -> {
                                val model = companionModel().session
                                compose.waitUntil(30_000) {
                                    !model.sending.value && model.sendFailure.value?.category == ConnectionFailure.TRANSPORT
                                }
                                check(model.sendFailure.value?.refusal == null)
                                check(model.input.value.pendingPrompts.size == 1)
                                compose.onNodeWithTag("session-send-error").assertIsDisplayed()
                            }
                            "nativeHttpSnapshot" -> {
                                val wire = CompanionRuntime.wire
                                fun snapshot() = (wire.diagnosticSnapshot() as WireDiagnosticSnapshot.Native).value
                                compose.waitUntil(20_000) {
                                    snapshot().let { !it.closed && it.pendingHttpCallbacks == 0 &&
                                        it.descriptionState == ai.deepseek.dsh.gateway.NativeDescriptionState.AVAILABLE }
                                }
                                check(CompanionRuntime.wire === wire)
                                val observed = snapshot()
                                check(!observed.closed && observed.pendingHttpCallbacks == 0)
                                value = buildJsonObject {
                                    put("started", observed.startedHttpCalls)
                                    put("finished", observed.finishedHttpCalls)
                                    put("generation", CompanionRuntime.generation)
                                }
                            }
                            "replacePromptDraft" -> compose.onNodeWithTag("session-draft")
                                .performTextReplacement(command.getValue("text").jsonPrimitive.content)
                            "hidePromptKeyboard" -> {
                                fun keyboardVisible() = androidx.core.view.ViewCompat.getRootWindowInsets(compose.activity.window.decorView)
                                    ?.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) == true
                                if (keyboardVisible()) check(instrumentation.uiAutomation.performGlobalAction(
                                    android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
                                compose.waitUntil(20_000) { !keyboardVisible() }
                                compose.onNodeWithTag("session-draft").assertIsDisplayed()
                            }
                            "returnToSessionList" -> {
                                val model = companionModel().session
                                check(model.open.value != null)
                                compose.onNodeWithTag("session-return-list").performClick()
                                compose.waitUntil(20_000) {
                                    model.open.value == null && model.input.value.lastSessionId == null
                                }
                                compose.onNodeWithTag("session-list-refresh").assertIsDisplayed()
                            }
                            "awaitAttachmentReady" -> {
                                val model = companionModel()
                                compose.waitUntil(20_000) { model.attachments.state.value.phase == NativeFileAttachmentPhase.IDLE }
                                waitFor(hasTestTag("session-attach") and isEnabled())
                                compose.onNodeWithTag("session-attach").assertIsEnabled()
                            }
                            "assertAttachmentReceiptRefusal" -> value = attachmentReceiptRefusal()
                            "retryRejectedAttachmentPrompt" -> {
                                val model = companionModel().session
                                val requestId = command.getValue("requestId").jsonPrimitive.content
                                val pending = model.input.value.pendingPrompts.getValue(requestId)
                                check(model.input.value.pendingPrompts.size == 1)
                                val previous = model.sendFailure.value
                                check(previous == null || previous.attachmentReceiptUnavailable)
                                compose.onNodeWithText(compose.activity.getString(R.string.native_prompt_retry))
                                    .performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
                                value = attachmentReceiptRefusal(previous)
                                check(model.input.value.pendingPrompts.getValue(requestId) == pending)
                            }
                            "assertPendingPromptVisible" -> {
                                val model = companionModel().session
                                val pending = model.input.value.pendingPrompts.getValue(command.getValue("requestId").jsonPrimitive.content)
                                check(model.input.value.pendingPrompts.size == 1)
                                compose.onNodeWithTag("session-rows").performScrollToIndex(0)
                                compose.onNode(hasText(pending.draft.text, substring = false) and
                                    hasAnyAncestor(hasTestTag("session-rows"))).assertIsDisplayed()
                            }
                            "discardPendingPrompt" -> {
                                val model = companionModel().session
                                val requestId = command.getValue("requestId").jsonPrimitive.content
                                check(model.input.value.pendingPrompts.keys == setOf(requestId))
                                compose.onNodeWithText(compose.activity.getString(R.string.native_prompt_discard_notice))
                                    .performScrollTo().assertIsDisplayed()
                                compose.onNodeWithText(compose.activity.getString(R.string.native_prompt_discard))
                                    .performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()
                                compose.waitUntil(20_000) { requestId !in model.input.value.pendingPrompts }
                            }
                            "retryPendingPrompt" -> {
                                val model = companionModel().session
                                val requestId = command.getValue("requestId").jsonPrimitive.content
                                check(requestId in model.input.value.pendingPrompts)
                                compose.onNodeWithText("重试这条发送").performScrollTo().performClick()
                                compose.waitUntil(30_000) { requestId !in model.input.value.pendingPrompts && !model.sending.value }
                                check(requestId !in model.input.value.pendingPrompts)
                            }
                            "assertNoPendingPrompt" -> {
                                val model = companionModel().session
                                compose.waitUntil(20_000) { model.input.value.pendingPrompts.isEmpty() }
                                compose.onNodeWithText("待确认的发送").assertDoesNotExist()
                            }
                            "damageInputs" -> {
                                runBlocking { companionModel().inputs.flush() }
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-input")
                                    .listFiles()!!.single { it.extension == "state" }
                                when (command.getValue("damage").jsonPrimitive.content) {
                                    "ciphertext" -> {
                                        val bytes = stored.readBytes()
                                        bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
                                        stored.writeBytes(bytes)
                                    }
                                    "missing-key" -> java.security.KeyStore.getInstance("AndroidKeyStore").apply {
                                        load(null); deleteEntry("dsh-native-input")
                                    }
                                    else -> error("unsupported input damage")
                                }
                                value = JsonPrimitive(MessageDigest.getInstance("SHA-256").digest(stored.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) })
                            }
                            "assertInputRecovery" -> {
                                waitFor(hasTestTag("input-restore-failed"))
                                compose.onNodeWithTag("input-restore-failed").assertIsDisplayed()
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-input")
                                    .listFiles()!!.single { it.extension == "state" }
                                val digest = MessageDigest.getInstance("SHA-256").digest(stored.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) }
                                check(digest == command.getValue("digest").jsonPrimitive.content)
                                if (command.getValue("damage").jsonPrimitive.content == "missing-key") {
                                    check(!java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias("dsh-native-input"))
                                }
                            }
                            "recoverInputs" -> {
                                stage = "input-recovery-action"
                                compose.onNodeWithTag("input-start-fresh").performClick()
                                stage = "input-recovery-saved"
                                compose.waitUntil(20_000) { companionModel().inputs.persistence.value == InputPersistenceStatus.SAVED }
                                val files = java.io.File(instrumentation.targetContext.filesDir, "native-input").listFiles()!!
                                stage = "input-recovery-preserved-bytes"
                                check(files.filter { it.name.contains(".unavailable-") }.any { backup ->
                                    MessageDigest.getInstance("SHA-256").digest(backup.readBytes())
                                        .joinToString("") { "%02x".format(it.toInt() and 255) } == command.getValue("digest").jsonPrimitive.content
                                })
                                stage = "input-recovery-empty-state"
                                check(companionModel().inputs.state.value == CompanionInputSnapshot())
                            }
                            "close" -> runBlocking {
                                if (CompanionRuntime.inputs.persistence.value != InputPersistenceStatus.RESTORE_FAILED) CompanionRuntime.inputs.flush()
                                CompanionRuntime.wire.closeAndAwait()
                            }
                            else -> error("unsupported UI command")
                        }
                    } catch (error: Throwable) {
                        // Compose exceptions can embed the pairing field in the semantics tree.
                        failed = true
                        type = "error"
                        value = buildJsonObject {
                            put("code", "android-ui-operation-failed"); put("operation", stage)
                            put("exception", error.javaClass.simpleName)
                            failureDiagnostics?.let { put("diagnostics", it()) }
                            put("frames", buildJsonArray {
                                error.stackTrace.take(6).forEach { add("${it.className}.${it.methodName}:${it.lineNumber}") }
                            })
                        }
                    }
                    output.write(buildJsonObject { put("id", id); put("type", type); put("value", value) }.toString())
                    output.newLine(); output.flush()
                    if (failed || op == "close") break
                }
            }
        }
        check(!failed) { "Native companion UI operation failed; private driver has the operation name" }
    }
}
