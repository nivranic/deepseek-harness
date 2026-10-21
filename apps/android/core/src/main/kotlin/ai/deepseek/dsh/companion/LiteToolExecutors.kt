package ai.deepseek.dsh.companion

import java.io.IOException
import java.io.InputStream
import java.math.BigDecimal
import java.math.MathContext
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * The Lite on-device tool executors (chapter 36's local face): bundled with
 * the APK and fail-soft — every rejected invocation answers one
 * [LiteToolOutcome] carrying its concise reason instead of throwing into the
 * loop. The local calculators stay pure; url_fetch owns its bounded outbound
 * transport; the attachment readers open the retained attachment store, with
 * image_inspect's pixel bounds read through the injected
 * [LiteImageBoundsReading] face — the android side stays behind that seam so
 * every executor evaluates under JVM tests.
 */
object LiteToolExecutors {

    /** Every calculator division evaluates under one context: 16 significant digits, HALF_EVEN rounding. */
    private val CALCULATOR_CONTEXT = MathContext.DECIMAL64

    /** The artifact content cap: 256 KiB of UTF-8-encoded bytes keeps one write inside a model-turn budget. */
    private const val ARTIFACT_CONTENT_LIMIT_BYTES = 256 * 1024

    /** The url_fetch response cap: 256 KiB of response bytes keeps one fetch inside a model-turn budget. */
    private const val URL_FETCH_CONTENT_LIMIT_BYTES = 256 * 1024

    /**
     * The attachment_read text cap: 64 KiB of stored bytes keeps one read
     * inside a model-turn budget. Independent of intake's 8 MiB retention
     * cap — that bounds what the device keeps, this bounds what one tool
     * result feeds the model.
     */
    private const val ATTACHMENT_READ_CONTENT_LIMIT_BYTES = 64 * 1024

    /** The application subtypes that carry textual documents; every other application subtype is binary. */
    private val TEXTUAL_APPLICATION_SUBTYPES = setOf("json", "xml", "yaml", "x-yaml", "javascript")

    /**
     * The url_fetch transport: one independently owned client, never the
     * provider's endpoint-bound stream client, with the bounded unary
     * profile the stream shape forbids — connect 10 s fences a dead
     * endpoint and one 30 s read/call bound retires a stalled fetch.
     * Redirects are never followed and [PrivateNetworkRefusingDns] keeps a
     * rebound connect-time resolution from slipping past the pre-flight
     * address refusal.
     */
    private val urlFetchClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .dns(PrivateNetworkRefusingDns)
        .build()

    /**
     * Evaluate one calculator invocation: the arguments parse as one
     * `{"expression": string}` object, and the expression evaluates exactly
     * over `+ - * / %`, parentheses, unary signs, and decimal numbers.
     * @param arguments the tool call's arguments JSON.
     * @returns the plain decimal result, or the concise reason the invocation failed.
     */
    fun calculator(arguments: String): LiteToolOutcome {
        val expression = stringFields(arguments, "expression")?.get("expression")
            ?: return LiteToolOutcome(ok = false, text = "参数必须是含 expression 字符串的 JSON 对象")
        val value = try {
            evaluateArithmetic(expression)
        } catch (divided: ArithmeticException) {
            return LiteToolOutcome(ok = false, text = "除数为零")
        } catch (malformed: IllegalArgumentException) {
            return LiteToolOutcome(ok = false, text = "表达式不合法")
        }
        return LiteToolOutcome(ok = true, text = value.toPlainString())
    }

    /**
     * Run one artifact_create invocation against the resource channel: the
     * arguments parse as one `{"id", "kind", "content"}` string object, the
     * id must name one file (no separators), the kind must come from the
     * reading face's textual vocabulary, and the encoded content must fit
     * [ARTIFACT_CONTENT_LIMIT_BYTES]; a passing invocation writes the bytes
     * atomically through the store and reports the created reference.
     * @param store the artifact resource channel the bytes land in.
     * @param arguments the tool call's arguments JSON.
     * @returns the outcome with its [LiteToolOutcome.artifact] fact on success, or the concise reason the invocation failed.
     */
    fun artifactCreate(store: LiteArtifactStoring, arguments: String): LiteToolOutcome {
        val fields = stringFields(arguments, "id", "kind", "content")
            ?: return LiteToolOutcome(ok = false, text = "参数必须是含 id、kind、content 字符串的 JSON 对象")
        val id = fields.getValue("id")
        if (id.isBlank() || '/' in id || '\\' in id) {
            return LiteToolOutcome(ok = false, text = "id 必须是不含路径分隔符的非空文件名")
        }
        val kind = fields.getValue("kind")
        if (kind !in LiteArtifactTextKinds) {
            return LiteToolOutcome(ok = false, text = "kind 必须是 " + LiteArtifactTextKinds.joinToString("、") + " 之一")
        }
        val content = fields.getValue("content")
        if (content.encodeToByteArray().size > ARTIFACT_CONTENT_LIMIT_BYTES) {
            return LiteToolOutcome(ok = false, text = "content 超过 $ARTIFACT_CONTENT_LIMIT_BYTES 字节上限")
        }
        store.put(id, content.encodeToByteArray())
        return LiteToolOutcome(ok = true, text = "已创建 artifact $id（$kind）。", artifact = LiteArtifactFact(id = id, kind = kind))
    }

    /**
     * Run one url_fetch invocation: the arguments parse as one `{"url": string}`
     * object naming an https address (the app layer's clean refusal ahead of the
     * platform's cleartext ban), the resolved host must leave the private-network
     * vocabulary, and the response passes [urlFetchResponseOutcome]; the blocking
     * fetch runs on the IO dispatcher.
     * @param arguments the tool call's arguments JSON.
     * @returns the fetched text or the unfollowed redirect notice, or the concise reason the invocation failed.
     */
    suspend fun urlFetch(arguments: String): LiteToolOutcome = withContext(Dispatchers.IO) {
        val url = stringFields(arguments, "url")?.getValue("url")
            ?: return@withContext LiteToolOutcome(ok = false, text = "参数必须是含 url 字符串的 JSON 对象")
        val target = url.toHttpUrlOrNull()
            ?: return@withContext LiteToolOutcome(ok = false, text = "URL 不合法")
        if (!target.isHttps) {
            return@withContext LiteToolOutcome(ok = false, text = "仅支持 https URL")
        }
        val resolved = try {
            InetAddress.getAllByName(target.host)
        } catch (unresolved: UnknownHostException) {
            return@withContext LiteToolOutcome(ok = false, text = "DNS 解析失败")
        }
        if (resolved.any { isPrivateNetworkAddress(it) }) {
            return@withContext LiteToolOutcome(ok = false, text = "拒绝访问私网地址：" + target.host)
        }
        try {
            urlFetchClient.newCall(Request.Builder().url(target).build()).execute().use { response ->
                urlFetchResponseOutcome(response.code, response.body.contentType(), response.header("Location"), response.body.byteStream())
            }
        } catch (rebound: LitePrivateNetworkRefused) {
            LiteToolOutcome(ok = false, text = "拒绝访问私网地址：" + target.host)
        } catch (timedOut: SocketTimeoutException) {
            LiteToolOutcome(ok = false, text = "请求超时")
        } catch (unresolved: UnknownHostException) {
            LiteToolOutcome(ok = false, text = "DNS 解析失败")
        } catch (failure: IOException) {
            LiteToolOutcome(ok = false, text = "网络请求失败")
        }
    }

    /**
     * Run one attachment_read invocation against the retained attachment
     * store: the arguments parse as one `{"name": string}` object naming a
     * stored attachment, and the retained media type routes the bytes — a
     * textual type decodes its content under the declared charset inside
     * [ATTACHMENT_READ_CONTENT_LIMIT_BYTES], every other type refuses as
     * binary. The tool result is the model's only read face over the bytes:
     * admitted attachments never ride a provider request.
     * @param store the retained attachment channel the bytes read from.
     * @param arguments the tool call's arguments JSON.
     * @returns the decoded text, or the concise reason the invocation failed.
     */
    fun attachmentRead(store: LiteAttachmentStoring, arguments: String): LiteToolOutcome {
        val name = stringFields(arguments, "name")?.getValue("name")
            ?: return LiteToolOutcome(ok = false, text = "参数必须是含 name 字符串的 JSON 对象")
        val mediaType = try {
            store.list().firstOrNull { it.name == name }?.mediaType
        } catch (corrupt: IllegalStateException) {
            // The store fails loud past a corrupt sidecar; the executor answers
            // that refusal as its own fail-soft fact instead of throwing into
            // the loop.
            return LiteToolOutcome(ok = false, text = "附件读取失败：$name")
        } ?: return LiteToolOutcome(ok = false, text = "附件不存在：$name")
        val bytes = store.get(name) ?: return LiteToolOutcome(ok = false, text = "附件不存在：$name")
        val type = mediaType.toMediaTypeOrNull()
        if (type == null || !isTextualMediaType(type)) {
            return LiteToolOutcome(ok = false, text = "附件是二进制类型：$mediaType，attachment_read 只读文本附件")
        }
        if (bytes.size > ATTACHMENT_READ_CONTENT_LIMIT_BYTES) {
            return LiteToolOutcome(ok = false, text = "附件超过 $ATTACHMENT_READ_CONTENT_LIMIT_BYTES 字节上限")
        }
        return LiteToolOutcome(ok = true, text = String(bytes, type.charset(Charsets.UTF_8) ?: Charsets.UTF_8))
    }

    /**
     * Run one image_inspect invocation against the retained attachment
     * store: the arguments parse as one `{"name": string}` object naming a
     * stored attachment, the bytes pass the pure signature sniff, and the
     * injected bounds reader resolves the pixel dimensions without decoding
     * pixels. The sniffed format is the reported fact — the retained media
     * type never reaches this tool.
     * @param store the retained attachment channel the bytes read from.
     * @param bounds the pixel-bounds face over the image bytes.
     * @param arguments the tool call's arguments JSON.
     * @returns the image's metadata line, or the concise reason the invocation failed.
     */
    fun imageInspect(store: LiteAttachmentStoring, bounds: LiteImageBoundsReading, arguments: String): LiteToolOutcome {
        val name = stringFields(arguments, "name")?.getValue("name")
            ?: return LiteToolOutcome(ok = false, text = "参数必须是含 name 字符串的 JSON 对象")
        val bytes = store.get(name) ?: return LiteToolOutcome(ok = false, text = "附件不存在：$name")
        val mediaType = sniffImageMediaType(bytes)
            ?: return LiteToolOutcome(ok = false, text = "不是可识别的图片")
        return imageInspectOutcome(mediaType, bounds.readBounds(bytes), bytes.size.toLong())
    }

    /**
     * Parse one invocation's arguments as one JSON object and read the named
     * string fields strictly.
     * @returns the named fields, or null when the text or any named field is malformed.
     */
    private fun stringFields(arguments: String, vararg names: String): Map<String, String>? {
        val root = try {
            Json.parseToJsonElement(arguments)
        } catch (malformed: IllegalArgumentException) {
            // The parser rejects malformed JSON text; the caller answers the
            // fail-soft reason, so nothing else reaches this catch.
            return null
        } as? JsonObject ?: return null
        val values = mutableMapOf<String, String>()
        for (name in names) {
            values[name] = (root[name] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        }
        return values
    }

    /**
     * Evaluate one fetched response for the loop: a redirect answers its
     * Location target unfollowed (the model re-calls url_fetch itself), a
     * non-2xx answers its status, and a 2xx body passes the textual
     * Content-Type gate and the [URL_FETCH_CONTENT_LIMIT_BYTES] read before
     * its decoded text becomes the outcome.
     * @param code the response status code.
     * @param contentType the parsed Content-Type, or null when the response states none.
     * @param location the redirect's Location header, when a 3xx carries one.
     * @param body the response body stream, read at most one byte past the cap.
     * @returns the outcome for the loop, or the concise reason the response is refused.
     */
    internal fun urlFetchResponseOutcome(code: Int, contentType: MediaType?, location: String?, body: InputStream): LiteToolOutcome {
        if (code in 300..399) {
            return LiteToolOutcome(ok = true, text = "HTTP $code 跳转未跟随，目标：" + (location ?: "响应未携带 Location"))
        }
        if (code !in 200..299) {
            return LiteToolOutcome(ok = false, text = "HTTP $code 请求未成功")
        }
        if (contentType == null || !isTextualMediaType(contentType)) {
            return LiteToolOutcome(ok = false, text = "响应 Content-Type 不是文本类型" + (contentType?.let { "：$it" } ?: "（缺失）"))
        }
        val bytes = body.readNBytes(URL_FETCH_CONTENT_LIMIT_BYTES + 1)
        if (bytes.size > URL_FETCH_CONTENT_LIMIT_BYTES) {
            return LiteToolOutcome(ok = false, text = "响应超过 $URL_FETCH_CONTENT_LIMIT_BYTES 字节上限")
        }
        return LiteToolOutcome(ok = true, text = String(bytes, contentType.charset(Charsets.UTF_8) ?: Charsets.UTF_8))
    }

    /** Whether one media type carries textual content: any text subtype, or the textual application subtypes. */
    private fun isTextualMediaType(type: MediaType): Boolean = when (type.type) {
        "text" -> true
        "application" -> type.subtype in TEXTUAL_APPLICATION_SUBTYPES ||
            type.subtype.endsWith("+json") || type.subtype.endsWith("+xml")
        else -> false
    }

    /** The PNG file signature. */
    private val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

    /** The JPEG file signature. */
    private val JPEG_SIGNATURE = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())

    /** The HEIF family's ISO-BMFF major brands: the still-image and sequence brands under `ftyp`. */
    private val HEIF_BRANDS = setOf("heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1")

    /**
     * Identify the media type declared by a supported image file signature —
     * the host read_image sniffer's vocabulary (PNG, JPEG, GIF, WebP) plus
     * the HEIF family. Pure byte inspection: no decode, no retained media
     * type consulted.
     * @param bytes the stored attachment bytes.
     * @returns the sniffed media type, or null for other bytes.
     */
    internal fun sniffImageMediaType(bytes: ByteArray): String? {
        if (matchesSignature(bytes, 0, PNG_SIGNATURE)) return "image/png"
        if (matchesSignature(bytes, 0, JPEG_SIGNATURE)) return "image/jpeg"
        if (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a")) return "image/gif"
        if (matchesAscii(bytes, 0, "RIFF") && matchesAscii(bytes, 8, "WEBP")) return "image/webp"
        if (isHeifFamily(bytes)) return "image/heif"
        return null
    }

    /** Whether the bytes open an ISO-BMFF `ftyp` box whose major brand names the HEIF family. */
    private fun isHeifFamily(bytes: ByteArray): Boolean =
        bytes.size >= 12 && matchesAscii(bytes, 4, "ftyp") &&
            bytes.decodeToString(8, 12) in HEIF_BRANDS

    /** Whether the bytes carry the expected signature bytes at the offset. */
    private fun matchesSignature(bytes: ByteArray, offset: Int, signature: ByteArray): Boolean {
        if (bytes.size < offset + signature.size) return false
        return signature.indices.all { bytes[offset + it] == signature[it] }
    }

    /** Whether the bytes carry the ASCII text at the offset. */
    private fun matchesAscii(bytes: ByteArray, offset: Int, text: String): Boolean {
        if (bytes.size < offset + text.length) return false
        return text.indices.all { bytes[offset + it] == text[it].code.toByte() }
    }

    /**
     * Evaluate one image_inspect outcome from its resolved facts: a sniffed
     * format with read bounds answers the metadata line, and a null bounds
     * read — the reader decoded no image out of the sniffed bytes — answers
     * the unrecognized-image refusal.
     * @param mediaType the sniffed image media type.
     * @param bounds the read pixel bounds, or null when the bytes decode to no image.
     * @param sizeBytes the stored byte count.
     * @returns the metadata outcome, or the unrecognized-image refusal.
     */
    internal fun imageInspectOutcome(mediaType: String, bounds: LiteImageBounds?, sizeBytes: Long): LiteToolOutcome =
        if (bounds == null) {
            LiteToolOutcome(ok = false, text = "不是可识别的图片")
        } else {
            LiteToolOutcome(ok = true, text = "格式 $mediaType、宽 ${bounds.width}×高 ${bounds.height} 像素、$sizeBytes 字节")
        }

    /**
     * The private-network refusal vocabulary for one resolved address — the
     * URL is model-controlled, so every loopback, site-local
     * (10/8, 172.16/12, 192.168/16, fec0::/10), link-local, and wildcard
     * address is refused, plus the IPv6 unique-local fc00::/7 prefix and the
     * IPv4 tail of an IPv4-mapped or IPv4-compatible IPv6 address (the JVM
     * predicates do not see through the mapping).
     */
    private fun isPrivateNetworkAddress(address: InetAddress): Boolean {
        if (address.isAnyLocalAddress || address.isLoopbackAddress ||
            address.isSiteLocalAddress || address.isLinkLocalAddress
        ) {
            return true
        }
        val raw = address.address
        if (raw.size != 16) return false
        if ((raw[0].toInt() and 0xFE) == 0xFC) return true
        val embeddedIPv4 = ((0..9).all { raw[it].toInt() == 0 } &&
            (raw[10].toInt() and 0xFF) == 0xFF && (raw[11].toInt() and 0xFF) == 0xFF) ||
            (0..11).all { raw[it].toInt() == 0 }
        return embeddedIPv4 && isPrivateNetworkAddress(InetAddress.getByAddress(raw.copyOfRange(12, 16)))
    }

    /** The connect-time backstop of [isPrivateNetworkAddress]: a resolution that rebinds into the private vocabulary between the pre-flight check and the connection is refused on the exact addresses OkHttp dials. */
    private object PrivateNetworkRefusingDns : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val resolved = Dns.SYSTEM.lookup(hostname)
            val refused = resolved.firstOrNull { isPrivateNetworkAddress(it) }
            if (refused != null) throw LitePrivateNetworkRefused(refused.hostAddress ?: hostname)
            return resolved
        }
    }

    /** The connect-time private-address refusal raised by [PrivateNetworkRefusingDns]. */
    private class LitePrivateNetworkRefused(address: String) : IOException("url_fetch refuses the private network address $address")

    /**
     * Evaluate one arithmetic expression exactly over [BigDecimal].
     * @param expression the complete expression text; surrounding and interior whitespace is skipped.
     * @returns the exact value.
     * @throws IllegalArgumentException when any character or structure is outside the grammar.
     * @throws ArithmeticException on division or remainder by zero.
     */
    private fun evaluateArithmetic(expression: String): BigDecimal {
        val parser = LiteArithmeticParser(expression)
        val value = parser.expression()
        parser.expectEnd()
        return value
    }

    /** Recursive-descent parser over `+ - * / %`, parentheses, unary signs, and decimal numbers. */
    private class LiteArithmeticParser(private val text: String) {
        private var index = 0

        /** expression := term (('+'|'-') term)* */
        fun expression(): BigDecimal {
            var value = term()
            while (true) {
                skipWhitespace()
                val operator = peek() ?: return value
                if (operator != '+' && operator != '-') return value
                index++
                value = if (operator == '+') value.add(term()) else value.subtract(term())
            }
        }

        /** term := factor (('*'|'/'|'%') factor)* */
        private fun term(): BigDecimal {
            var value = factor()
            while (true) {
                skipWhitespace()
                val operator = peek() ?: return value
                if (operator != '*' && operator != '/' && operator != '%') return value
                index++
                val right = factor()
                value = when (operator) {
                    '*' -> value.multiply(right)
                    '/' -> value.divide(right, CALCULATOR_CONTEXT)
                    else -> value.rem(right)
                }
            }
        }

        /** factor := ('+'|'-')* primary */
        private fun factor(): BigDecimal {
            skipWhitespace()
            var negated = false
            while (peek() == '+' || peek() == '-') {
                if (peek() == '-') negated = !negated
                index++
                skipWhitespace()
            }
            val value = primary()
            return if (negated) value.negate() else value
        }

        /** primary := '(' expression ')' | number */
        private fun primary(): BigDecimal {
            if (peek() == '(') {
                index++
                val value = expression()
                skipWhitespace()
                if (peek() != ')') reject()
                index++
                return value
            }
            return number()
        }

        /** number := digits ('.' digits)?; no exponent form. */
        private fun number(): BigDecimal {
            val start = index
            while (peek()?.isDigit() == true) index++
            if (index > start && peek() == '.') {
                index++
                val fractionStart = index
                while (peek()?.isDigit() == true) index++
                if (index == fractionStart) reject()
            }
            if (index == start) reject()
            return BigDecimal(text.substring(start, index))
        }

        private fun skipWhitespace() {
            while (peek()?.isWhitespace() == true) index++
        }

        /** Consume trailing whitespace and reject any unconsumed input. */
        fun expectEnd() {
            skipWhitespace()
            if (index != text.length) reject()
        }

        private fun peek(): Char? = text.getOrNull(index)

        private fun reject(): Nothing = throw IllegalArgumentException("invalid arithmetic expression")
    }
}

/** One image's pixel dimensions as image_inspect reports them. */
data class LiteImageBounds(val width: Int, val height: Int)

/**
 * Reads one image's pixel bounds from its bytes: image_inspect's only
 * android-facing dependency. The executors' module is JVM-only, so the
 * BitmapFactory decodeBounds face — metadata only, no pixel decode — is
 * injected by the app module, and the JVM tests read through their own.
 */
fun interface LiteImageBoundsReading {
    /**
     * Read one image's pixel bounds.
     * @param bytes the complete image bytes.
     * @return the pixel bounds, or null when the bytes decode to no image.
     */
    fun readBounds(bytes: ByteArray): LiteImageBounds?
}
