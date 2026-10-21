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
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * The Lite on-device tool executors (chapter 36's local face): bundled with
 * the APK and fail-soft — every rejected invocation answers one
 * [LiteToolOutcome] carrying its concise reason instead of throwing into the
 * loop. The local calculators stay pure; url_fetch owns its bounded outbound
 * transport.
 */
object LiteToolExecutors {

    /** Every calculator division evaluates under one context: 16 significant digits, HALF_EVEN rounding. */
    private val CALCULATOR_CONTEXT = MathContext.DECIMAL64

    /** The artifact content cap: 256 KiB of UTF-8-encoded bytes keeps one write inside a model-turn budget. */
    private const val ARTIFACT_CONTENT_LIMIT_BYTES = 256 * 1024

    /** The url_fetch response cap: 256 KiB of response bytes keeps one fetch inside a model-turn budget. */
    private const val URL_FETCH_CONTENT_LIMIT_BYTES = 256 * 1024

    /** The url_fetch application subtypes that carry textual documents; every other application subtype is binary. */
    private val URL_FETCH_TEXTUAL_APPLICATION_SUBTYPES = setOf("json", "xml", "yaml", "x-yaml", "javascript")

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
        "application" -> type.subtype in URL_FETCH_TEXTUAL_APPLICATION_SUBTYPES ||
            type.subtype.endsWith("+json") || type.subtype.endsWith("+xml")
        else -> false
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
