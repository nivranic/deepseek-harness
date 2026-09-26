package ai.deepseek.dsh.companion

import android.net.LocalServerSocket
import android.graphics.Bitmap
import android.util.Base64
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.rules.ExternalResource
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
    @get:Rule(order = 1) val notifications = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 2) val compose = createAndroidComposeRule<MainActivity>()

    private fun waitFor(matcher: SemanticsMatcher) {
        compose.waitUntil(20_000) { compose.onAllNodes(matcher).fetchSemanticsNodes(false).isNotEmpty() }
    }

    private fun companionModel(): CompanionViewModel {
        lateinit var model: CompanionViewModel
        compose.runOnIdle { model = androidx.lifecycle.ViewModelProvider(compose.activity)[CompanionViewModel::class.java] }
        return model
    }

    @Test fun pairAnswerAndReadPages() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        check(instrumentation.targetContext.packageName.endsWith(".nativeacceptance"))
        val name = requireNotNull(InstrumentationRegistry.getArguments().getString("dshSocket"))
        require(name.matches(Regex("dsh-native-[a-f0-9-]+")))
        var paired = false
        var failed = false
        LocalServerSocket(name).use { server ->
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
                    try {
                        when (op) {
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
                            "openSession" -> {
                                compose.onNodeWithTag("native-tab-0").performClick()
                                val sessionId = command.getValue("sessionId").jsonPrimitive.content
                                val model = companionModel().session
                                if (model.open.value?.sessionId != sessionId) {
                                    if (model.open.value != null) compose.onNodeWithTag("session-return-list").performClick()
                                    val tag = "session-open-$sessionId"
                                    waitFor(hasTestTag(tag))
                                    compose.onNodeWithTag(tag).performScrollTo().performClick()
                                }
                                waitFor(hasTestTag("session-draft") and isEnabled())
                            }
                            "assertPromptDraft" -> {
                                compose.onNodeWithTag("native-tab-0").performClick()
                                waitFor(hasTestTag("session-draft") and isEnabled() and hasText(command.getValue("text").jsonPrimitive.content))
                                compose.onNodeWithTag("session-draft").assertTextContains(command.getValue("text").jsonPrimitive.content)
                            }
                            "assertEmptyPromptDraft" -> {
                                check(compose.onNodeWithTag("session-draft").fetchSemanticsNode().config[SemanticsProperties.EditableText].text.isEmpty())
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
                                compose.activityRule.scenario.recreate()
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
                            "replacePromptDraft" -> compose.onNodeWithTag("session-draft")
                                .performTextReplacement(command.getValue("text").jsonPrimitive.content)
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
                    } catch (_: Throwable) {
                        // Compose exceptions can embed the pairing field in the semantics tree.
                        failed = true
                        type = "error"
                        value = buildJsonObject { put("code", "android-ui-operation-failed"); put("operation", stage) }
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
