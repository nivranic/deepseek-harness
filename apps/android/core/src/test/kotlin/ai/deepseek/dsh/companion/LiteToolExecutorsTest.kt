package ai.deepseek.dsh.companion

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType

private fun tempDir(): java.io.File =
    java.nio.file.Files.createTempDirectory("lite-executors").toFile()

/** The Lite on-device executors: the calculator table, the artifact write face, and the url_fetch outbound face. */
class LiteToolExecutorsTest {

    @Test
    fun evaluatesTheArithmeticTable() {
        val table = mapOf(
            // * and % bind tighter than + and -.
            "2 + 3 * 4" to "14",
            "20 - 6 / 2" to "17",
            // Parentheses nest arbitrarily.
            "((2 + 3) * (4 - 1))" to "15",
            "(2 + 3) * 4" to "20",
            // Modulo is the dividend-signed remainder.
            "10 % 3" to "1",
            "-7 % 3" to "-1",
            // Division keeps a fixed 16-digit context.
            "10 / 4" to "2.5",
            "1 / 3" to "0.3333333333333333",
            // Whitespace anywhere between tokens is skipped.
            "  1 +\n2  " to "3",
            // BigDecimal stays exact where binary doubles drift.
            "0.1 + 0.2" to "0.3",
            "1.10 * 3" to "3.30",
            // Unary signs, including against a parenthesized operand.
            "-7 + 10" to "3",
            "2 * -3" to "-6",
            "-(2 + 3)" to "-5",
        )
        for ((expression, expected) in table) {
            val outcome = LiteToolExecutors.calculator("""{"expression":"$expression"}""")
            assertTrue(outcome.ok, expression)
            assertEquals(expected, outcome.text, expression)
        }
    }

    @Test
    fun divisionAndRemainderByZeroFailSoft() {
        for (expression in listOf("1 / 0", "5 % 0", "0 / 0", "1 / (2 - 2)")) {
            val outcome = LiteToolExecutors.calculator("""{"expression":"$expression"}""")
            assertFalse(outcome.ok, expression)
            assertEquals("除数为零", outcome.text, expression)
        }
    }

    @Test
    fun malformedExpressionsFailSoft() {
        for (expression in listOf("", "   ", "1 +", "abc", "(1 + 2", "1..2", "1 2", "1e3", ".5", "5.", "1 + * 2", "0x10")) {
            val outcome = LiteToolExecutors.calculator("""{"expression":"$expression"}""")
            assertFalse(outcome.ok, "expression <$expression> parsed")
            assertEquals("表达式不合法", outcome.text, expression)
        }
    }

    @Test
    fun malformedCalculatorArgumentsFailSoft() {
        for (arguments in listOf("not json", "3", """{"expression": 3}""", """{"other": "1 + 1"}""", """{"expression": null}""")) {
            val outcome = LiteToolExecutors.calculator(arguments)
            assertFalse(outcome.ok, "arguments <$arguments> parsed")
            assertEquals("参数必须是含 expression 字符串的 JSON 对象", outcome.text)
        }
    }

    @Test
    fun anArtifactCreateWritesAndTheReadingFaceRendersIt() {
        val store = LiteFileArtifactStore(tempDir())
        val outcome = LiteToolExecutors.artifactCreate(
            store,
            """{"id":"spec","kind":"markdown","content":"# 报告\n正文。","note":"future fields stay tolerated"}""",
        )
        assertTrue(outcome.ok)
        assertEquals(LiteArtifactFact(id = "spec", kind = "markdown"), outcome.artifact)

        // The written bytes read back through the reading face as a textual kind.
        val content = readLiteArtifact(store, LiteArtifact(id = "spec", kind = "markdown", title = "spec", status = "ready"))!!
        assertEquals(LiteArtifactContent.Presentation.Text("# 报告\n正文。"), content.presentation)
    }

    @Test
    fun invalidArtifactArgumentsFailSoftWithoutWriting() {
        val store = LiteFileArtifactStore(tempDir())
        val cases = mapOf(
            "malformed json" to Pair("not json", "参数必须是含 id、kind、content 字符串的 JSON 对象"),
            "missing content" to Pair("""{"id":"a","kind":"text"}""", "参数必须是含 id、kind、content 字符串的 JSON 对象"),
            "blank id" to Pair("""{"id":"  ","kind":"text","content":"x"}""", "id 必须是不含路径分隔符的非空文件名"),
            "path-separator id" to Pair("""{"id":"../escape","kind":"text","content":"x"}""", "id 必须是不含路径分隔符的非空文件名"),
            "backslash id" to Pair("""{"id":"a\\b","kind":"text","content":"x"}""", "id 必须是不含路径分隔符的非空文件名"),
            "unknown kind" to Pair("""{"id":"a","kind":"image","content":"x"}""", "kind 必须是 markdown、text、report、patch 之一"),
        )
        for ((name, case) in cases) {
            val outcome = LiteToolExecutors.artifactCreate(store, case.first)
            assertFalse(outcome.ok, name)
            assertEquals(case.second, outcome.text, name)
            assertNull(outcome.artifact, name)
        }
        assertTrue(store.get("../escape") == null && store.get("a") == null, "no rejected invocation wrote bytes")
    }

    @Test
    fun oversizedContentFailsSoftAtTheCapBoundary() {
        val store = LiteFileArtifactStore(tempDir())
        // The executor's own 256 KiB cap: ASCII content makes bytes equal chars.
        val cap = 256 * 1024
        val atCap = LiteToolExecutors.artifactCreate(
            store,
            """{"id":"at-cap","kind":"text","content":"${"x".repeat(cap)}"}""",
        )
        assertTrue(atCap.ok)
        assertEquals(cap, store.get("at-cap")!!.size)

        val overCap = LiteToolExecutors.artifactCreate(
            store,
            """{"id":"over-cap","kind":"text","content":"${"x".repeat(cap + 1)}"}""",
        )
        assertFalse(overCap.ok)
        assertEquals("content 超过 $cap 字节上限", overCap.text)
        assertNull(store.get("over-cap"))
    }

    @Test
    fun malformedUrlFetchArgumentsFailSoft() = runTest {
        for (arguments in listOf("not json", "3", "\"https://example.com\"", """{"url": 3}""", """{"other":"https://example.com"}""", """{"url":null}""")) {
            val outcome = LiteToolExecutors.urlFetch(arguments)
            assertFalse(outcome.ok, "arguments <$arguments> parsed")
            assertEquals("参数必须是含 url 字符串的 JSON 对象", outcome.text)
        }
    }

    @Test
    fun nonHttpsAndUnparseableUrlsAreRefusedBeforeAnyRequest() = runTest {
        // OkHttp parses only http/https URLs, so the https gate compares against
        // http alone; every other scheme already answers the unparseable reason.
        val cases = mapOf(
            "cleartext http" to Pair("""{"url":"http://example.com/a"}""", "仅支持 https URL"),
            "other scheme" to Pair("""{"url":"ftp://example.com/a"}""", "URL 不合法"),
            "blank" to Pair("""{"url":""}""", "URL 不合法"),
            "plain text" to Pair("""{"url":"example.com/a"}""", "URL 不合法"),
        )
        for ((name, case) in cases) {
            val outcome = LiteToolExecutors.urlFetch(case.first)
            assertFalse(outcome.ok, name)
            assertEquals(case.second, outcome.text, name)
        }
    }

    @Test
    fun privateNetworkHostsAreRefusedBeforeAnyRequest() = runTest {
        // Literal addresses resolve without DNS, so every refusal is offline-deterministic.
        // HttpUrl reports IPv6 hosts bare (bracketed in the URL) and normalizes an
        // IPv4-mapped literal to its embedded IPv4, so the message names that form.
        val hosts = listOf(
            "127.0.0.1" to "127.0.0.1", // loopback
            "10.0.0.1" to "10.0.0.1", "172.16.0.1" to "172.16.0.1", "192.168.1.1" to "192.168.1.1", // site-local
            "169.254.169.254" to "169.254.169.254", // link-local, the metadata endpoint
            "0.0.0.0" to "0.0.0.0", // wildcard
            "::1" to "::1", // IPv6 loopback
            "fe80::1" to "fe80::1", // IPv6 link-local
            "fec0::1" to "fec0::1", // IPv6 site-local
            "fc00::1" to "fc00::1", "fd12::1" to "fd12::1", // IPv6 unique-local fc00::/7
            "::ffff:127.0.0.1" to "127.0.0.1", "::ffff:169.254.0.1" to "169.254.0.1", // IPv4-mapped
        )
        for ((urlHost, messageHost) in hosts) {
            val url = if (':' in urlHost) "https://[$urlHost]/a" else "https://$urlHost/a"
            val outcome = LiteToolExecutors.urlFetch("""{"url":"$url"}""")
            assertFalse(outcome.ok, urlHost)
            assertEquals("拒绝访问私网地址：$messageHost", outcome.text, urlHost)
        }
    }

    @Test
    fun anUnresolvableHostAnswersDnsFailure() = runTest {
        // The conformance fixture's shape: a name that cannot resolve answers the DNS reason.
        val outcome = LiteToolExecutors.urlFetch("""{"url":"https://example.invalid/a"}""")
        assertFalse(outcome.ok)
        assertEquals("DNS 解析失败", outcome.text)
    }

    @Test
    fun aTextualTwoHundredAnswersTheDecodedBodyInTheDeclaredCharset() {
        val plain = LiteToolExecutors.urlFetchResponseOutcome(
            200, "text/plain; charset=utf-8".toMediaType(), null, "hello".byteInputStream(),
        )
        assertEquals(LiteToolOutcome(ok = true, text = "hello"), plain)

        val declared = LiteToolExecutors.urlFetchResponseOutcome(
            200, "text/plain; charset=utf-16be".toMediaType(), null, "你好".toByteArray(Charsets.UTF_16BE).inputStream(),
        )
        assertEquals(LiteToolOutcome(ok = true, text = "你好"), declared)

        for (type in listOf("application/json", "application/xml", "application/xhtml+xml")) {
            val textual = LiteToolExecutors.urlFetchResponseOutcome(200, type.toMediaType(), null, "{}".byteInputStream())
            assertEquals(LiteToolOutcome(ok = true, text = "{}"), textual, type)
        }
    }

    @Test
    fun nonTextualOrMissingContentTypesAreRefused() {
        for (type in listOf("image/png", "audio/mpeg", "video/mp4", "application/octet-stream", "application/pdf", "application/zip")) {
            val outcome = LiteToolExecutors.urlFetchResponseOutcome(200, type.toMediaType(), null, byteArrayOf(0, 1).inputStream())
            assertFalse(outcome.ok, type)
            assertEquals("响应 Content-Type 不是文本类型：$type", outcome.text, type)
        }
        val missing = LiteToolExecutors.urlFetchResponseOutcome(200, null, null, "x".byteInputStream())
        assertFalse(missing.ok)
        assertEquals("响应 Content-Type 不是文本类型（缺失）", missing.text)
    }

    @Test
    fun redirectsAnswerTheirTargetUnfollowedAndOtherStatusesAnswerTheirCode() {
        assertEquals(
            LiteToolOutcome(ok = true, text = "HTTP 301 跳转未跟随，目标：https://example.com/b"),
            LiteToolExecutors.urlFetchResponseOutcome(301, null, "https://example.com/b", "".byteInputStream()),
        )
        assertEquals(
            LiteToolOutcome(ok = true, text = "HTTP 302 跳转未跟随，目标：响应未携带 Location"),
            LiteToolExecutors.urlFetchResponseOutcome(302, null, null, "".byteInputStream()),
        )
        assertEquals(
            LiteToolOutcome(ok = false, text = "HTTP 404 请求未成功"),
            LiteToolExecutors.urlFetchResponseOutcome(404, "text/plain".toMediaType(), null, "".byteInputStream()),
        )
        assertEquals(
            LiteToolOutcome(ok = false, text = "HTTP 503 请求未成功"),
            LiteToolExecutors.urlFetchResponseOutcome(503, null, null, "".byteInputStream()),
        )
    }

    @Test
    fun oversizedResponsesFailSoftAtTheCapBoundary() {
        val cap = 256 * 1024
        val atCap = LiteToolExecutors.urlFetchResponseOutcome(
            200, "text/plain".toMediaType(), null, "x".repeat(cap).byteInputStream(),
        )
        assertEquals(LiteToolOutcome(ok = true, text = "x".repeat(cap)), atCap)

        val overCap = LiteToolExecutors.urlFetchResponseOutcome(
            200, "text/plain".toMediaType(), null, "x".repeat(cap + 1).byteInputStream(),
        )
        assertFalse(overCap.ok)
        assertEquals("响应超过 $cap 字节上限", overCap.text)
    }
}
