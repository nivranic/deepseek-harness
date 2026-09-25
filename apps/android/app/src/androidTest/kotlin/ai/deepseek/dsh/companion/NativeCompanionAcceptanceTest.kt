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
                            "observeSession" -> {
                                stage = "session-navigation"
                                compose.onNodeWithTag("native-tab-0").performClick()
                                val tag = "session-open-" + command.getValue("sessionId").jsonPrimitive.content
                                stage = "session-list-entry"
                                waitFor(hasTestTag(tag))
                                compose.onNodeWithTag(tag).performScrollTo().performClick()
                                stage = "session-done-projection"
                                waitFor(hasText("DONE", substring = true))
                                compose.onNode(hasText("DONE", substring = true)).performScrollTo()
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
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-gateway-credentials.json")
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
                                val session = "session-open-" + command.getValue("sessionId").jsonPrimitive.content
                                waitFor(hasTestTag(session))
                                compose.onNodeWithTag(session).performScrollTo().performClick()
                                compose.onNodeWithTag("native-tab-4").performClick()
                                val entry = "file-entry-" + command.getValue("path").jsonPrimitive.content
                                waitFor(hasTestTag(entry))
                            }
                            "repair" -> {
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-gateway-credentials.json")
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
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-gateway-credentials.json")
                                check(stored.isFile)
                                when (command.getValue("damage").jsonPrimitive.content) {
                                    "malformed" -> stored.writeText("{invalid credential document", Charsets.UTF_8)
                                    "ciphertext" -> {
                                        val document = Json.parseToJsonElement(stored.readText()).jsonObject
                                        val sealed = Base64.decode(document.getValue("signingKeyBase64").jsonPrimitive.content, Base64.NO_WRAP)
                                        sealed[sealed.lastIndex] = (sealed.last().toInt() xor 1).toByte()
                                        stored.writeText(JsonObject(document + ("signingKeyBase64" to
                                            JsonPrimitive(Base64.encodeToString(sealed, Base64.NO_WRAP)))).toString(), Charsets.UTF_8)
                                    }
                                    "missing-key" -> java.security.KeyStore.getInstance("AndroidKeyStore").apply {
                                        load(null); deleteEntry("dsh-link-credentials")
                                    }
                                    else -> error("unsupported credential damage")
                                }
                                value = JsonPrimitive(MessageDigest.getInstance("SHA-256").digest(stored.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) })
                            }
                            "assertCredentialRecovery" -> {
                                waitFor(hasText("已有凭据无法用于当前原生连接，请重新配对。原凭据文件未删除。"))
                                compose.onNodeWithText("已有凭据无法用于当前原生连接，请重新配对。原凭据文件未删除。").assertIsDisplayed()
                                compose.onNodeWithTag("native-repair").assertDoesNotExist()
                                val stored = java.io.File(instrumentation.targetContext.filesDir, "native-gateway-credentials.json")
                                val digest = MessageDigest.getInstance("SHA-256").digest(stored.readBytes())
                                    .joinToString("") { "%02x".format(it.toInt() and 255) }
                                stage = "preserved-damaged-document"
                                check(digest == command.getValue("digest").jsonPrimitive.content)
                                if (command.getValue("damage").jsonPrimitive.content == "missing-key") {
                                    stage = "read-does-not-create-key"
                                    check(!java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                                        .containsAlias("dsh-link-credentials"))
                                }
                            }
                            "assertSessionListReady" -> {
                                lateinit var model: CompanionViewModel
                                compose.runOnIdle { model = androidx.lifecycle.ViewModelProvider(compose.activity)[CompanionViewModel::class.java] }
                                try { compose.waitUntil(20_000) { model.session.listState.value !in setOf("idle", "loading") } }
                                finally {
                                    stage = when (model.session.listState.value) {
                                        "ready" -> "session-list-ready"
                                        "idle" -> "session-list-idle"
                                        "loading" -> "session-list-loading"
                                        "failed:native HTTPS request failed" -> "session-list-transport"
                                        "failed:native HTTPS response interrupted" -> "session-list-response-interrupted"
                                        "failed:Job was cancelled", "failed:DeferredCoroutine was cancelled" -> "session-list-cancelled"
                                        else -> "session-list-failed"
                                    }
                                }
                                check(model.session.listState.value == "ready")
                            }
                            "close" -> runBlocking { CompanionRuntime.wire.closeAndAwait() }
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
