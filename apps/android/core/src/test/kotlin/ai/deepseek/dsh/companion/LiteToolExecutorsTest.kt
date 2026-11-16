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

/** A fixed bounds answer: the JVM face standing in for the app module's BitmapFactory reader. */
private class FixedBounds(private val bounds: LiteImageBounds?) : LiteImageBoundsReading {
    override fun readBounds(bytes: ByteArray): LiteImageBounds? = bounds
}

/** The Lite on-device executors: the calculator table, the artifact write face, the url_fetch outbound face, and the attachment readers. */
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

    @Test
    fun malformedAttachmentReadArgumentsFailSoft() {
        for (arguments in listOf("not json", "3", "\"notes.txt\"", """{"name": 3}""", """{"other":"notes.txt"}""", """{"name":null}""")) {
            val outcome = LiteToolExecutors.attachmentRead(LiteFileAttachmentStore(tempDir()), arguments)
            assertFalse(outcome.ok, "arguments <$arguments> parsed")
            assertEquals("参数必须是含 name 字符串的 JSON 对象", outcome.text)
        }
    }

    @Test
    fun absentAttachmentsFailSoftByNameOnBothReaders() {
        val store = LiteFileAttachmentStore(tempDir())
        store.put("kept.txt", "x".encodeToByteArray(), "text/plain")
        val reads = listOf<(String) -> LiteToolOutcome>(
            { arguments -> LiteToolExecutors.attachmentRead(store, arguments) },
            { arguments -> LiteToolExecutors.imageInspect(store, FixedBounds(LiteImageBounds(1, 1)), arguments) },
        )
        for (read in reads) {
            val outcome = read("""{"name":"gone.txt"}""")
            assertFalse(outcome.ok)
            assertEquals("附件不存在：gone.txt", outcome.text)
        }
    }

    @Test
    fun aTextualAttachmentReadsBackItsContentInTheDeclaredCharset() {
        val store = LiteFileAttachmentStore(tempDir())
        store.put("notes.txt", "正文内容".encodeToByteArray(), "text/plain; charset=utf-8")
        assertEquals(
            LiteToolOutcome(ok = true, text = "正文内容"),
            LiteToolExecutors.attachmentRead(store, """{"name":"notes.txt"}"""),
        )
        // A declared non-UTF-8 charset decodes through it — the url_fetch body face's form.
        store.put("utf16.txt", "你好".toByteArray(Charsets.UTF_16BE), "text/plain; charset=utf-16be")
        assertEquals(
            LiteToolOutcome(ok = true, text = "你好"),
            LiteToolExecutors.attachmentRead(store, """{"name":"utf16.txt"}"""),
        )
        // An unstated charset defaults to UTF-8.
        store.put("bare.txt", "默认".encodeToByteArray(), "text/plain")
        assertEquals(
            LiteToolOutcome(ok = true, text = "默认"),
            LiteToolExecutors.attachmentRead(store, """{"name":"bare.txt"}"""),
        )
        // The textual application vocabulary url_fetch already owns carries attachments too.
        for ((suffix, type) in listOf("json" to "application/json", "xhtml" to "application/xhtml+xml", "yaml" to "application/yaml")) {
            val name = "doc.$suffix"
            store.put(name, "{}".encodeToByteArray(), type)
            assertEquals(
                LiteToolOutcome(ok = true, text = "{}"),
                LiteToolExecutors.attachmentRead(store, """{"name":"$name"}"""),
                type,
            )
        }
    }

    @Test
    fun binaryAttachmentsAreRefusedWithTheirRetainedMediaType() {
        val store = LiteFileAttachmentStore(tempDir())
        val cases = listOf(
            "shot.png" to "image/png",
            "blob.bin" to "application/octet-stream", // intake's unstated default
            "doc.pdf" to "application/pdf",
            "malformed" to "not a media type", // a retained type okhttp cannot parse reads as binary
        )
        for ((name, type) in cases) {
            store.put(name, byteArrayOf(0, 1), type)
            val outcome = LiteToolExecutors.attachmentRead(store, """{"name":"$name"}""")
            assertFalse(outcome.ok, name)
            assertEquals("附件是二进制类型：$type，attachment_read 只读文本附件", outcome.text, name)
        }
    }

    @Test
    fun oversizedAttachmentTextFailsSoftAtTheCapBoundary() {
        val store = LiteFileAttachmentStore(tempDir())
        val cap = 64 * 1024
        store.put("at-cap.txt", "x".repeat(cap).encodeToByteArray(), "text/plain")
        assertEquals(
            LiteToolOutcome(ok = true, text = "x".repeat(cap)),
            LiteToolExecutors.attachmentRead(store, """{"name":"at-cap.txt"}"""),
        )
        store.put("over-cap.txt", "x".repeat(cap + 1).encodeToByteArray(), "text/plain")
        val overCap = LiteToolExecutors.attachmentRead(store, """{"name":"over-cap.txt"}""")
        assertFalse(overCap.ok)
        assertEquals("附件超过 $cap 字节上限", overCap.text)
    }

    @Test
    fun malformedImageInspectArgumentsFailSoft() {
        for (arguments in listOf("not json", "3", "\"shot.png\"", """{"name": 3}""", """{"other":"shot.png"}""", """{"name":null}""")) {
            val outcome = LiteToolExecutors.imageInspect(LiteFileAttachmentStore(tempDir()), FixedBounds(null), arguments)
            assertFalse(outcome.ok, "arguments <$arguments> parsed")
            assertEquals("参数必须是含 name 字符串的 JSON 对象", outcome.text)
        }
    }

    @Test
    fun imageSignaturesSniffToTheirMediaTypes() {
        fun ftyp(brand: String): ByteArray =
            byteArrayOf(0, 0, 0, 0x18) + "ftyp$brand".encodeToByteArray() + ByteArray(8)
        val table = mapOf(
            "png" to (byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) + ByteArray(16) to "image/png"),
            "jpeg" to (byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + ByteArray(16) to "image/jpeg"),
            "gif87a" to ("GIF87a".encodeToByteArray() + ByteArray(10) to "image/gif"),
            "gif89a" to ("GIF89a".encodeToByteArray() + ByteArray(10) to "image/gif"),
            "webp" to ("RIFF".encodeToByteArray() + byteArrayOf(0, 0, 0, 0) + "WEBP".encodeToByteArray() + ByteArray(10) to "image/webp"),
            "heic" to (ftyp("heic") to "image/heif"),
            "mif1" to (ftyp("mif1") to "image/heif"),
        )
        for ((name, case) in table) {
            assertEquals(case.second, LiteToolExecutors.sniffImageMediaType(case.first), name)
        }
        val negatives = mapOf(
            "text bytes" to "附件不是图片".encodeToByteArray(),
            "truncated gif header" to "GIF8".encodeToByteArray(),
            "riff container without webp" to ("RIFF".encodeToByteArray() + byteArrayOf(0, 0, 0, 0) + "WAVE".encodeToByteArray()),
            "ftyp brand outside the family" to ftyp("isom"),
            "empty bytes" to ByteArray(0),
        )
        for ((name, bytes) in negatives) {
            assertNull(LiteToolExecutors.sniffImageMediaType(bytes), name)
        }
    }

    @Test
    fun aSniffedImageAnswersItsMetadataThroughTheBoundsReader() {
        val store = LiteFileAttachmentStore(tempDir())
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) + ByteArray(24)
        // The retained media type may state anything; the sniff is the reported fact.
        store.put("shot.png", png, "image/jpeg")
        assertEquals(
            LiteToolOutcome(ok = true, text = "格式 image/png、宽 800×高 600 像素、${png.size} 字节"),
            LiteToolExecutors.imageInspect(store, FixedBounds(LiteImageBounds(width = 800, height = 600)), """{"name":"shot.png"}"""),
        )
        // A reader that decodes nothing answers the unrecognized refusal even past the sniff.
        assertEquals(
            LiteToolOutcome(ok = false, text = "不是可识别的图片"),
            LiteToolExecutors.imageInspect(store, FixedBounds(null), """{"name":"shot.png"}"""),
        )
        // A non-image attachment answers the same refusal before any read: the reader holds valid bounds.
        store.put("notes.txt", "text".encodeToByteArray(), "text/plain")
        assertEquals(
            LiteToolOutcome(ok = false, text = "不是可识别的图片"),
            LiteToolExecutors.imageInspect(store, FixedBounds(LiteImageBounds(1, 1)), """{"name":"notes.txt"}"""),
        )
    }
}
