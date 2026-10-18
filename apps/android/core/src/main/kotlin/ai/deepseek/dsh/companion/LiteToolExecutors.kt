package ai.deepseek.dsh.companion

import java.math.BigDecimal
import java.math.MathContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The Lite on-device tool executors (chapter 36's local face): pure, bundled
 * with the APK, and fail-soft — every rejected invocation answers one
 * [LiteToolOutcome] carrying its concise reason instead of throwing into the
 * loop.
 */
object LiteToolExecutors {

    /** Every calculator division evaluates under one context: 16 significant digits, HALF_EVEN rounding. */
    private val CALCULATOR_CONTEXT = MathContext.DECIMAL64

    /** The artifact content cap: 256 KiB of UTF-8-encoded bytes keeps one write inside a model-turn budget. */
    private const val ARTIFACT_CONTENT_LIMIT_BYTES = 256 * 1024

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
