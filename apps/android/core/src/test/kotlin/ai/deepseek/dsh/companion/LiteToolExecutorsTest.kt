package ai.deepseek.dsh.companion

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun tempDir(): java.io.File =
    java.nio.file.Files.createTempDirectory("lite-executors").toFile()

/** The Lite on-device executors: the calculator table and the artifact write face. */
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
}
