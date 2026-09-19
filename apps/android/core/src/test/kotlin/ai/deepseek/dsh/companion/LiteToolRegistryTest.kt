package ai.deepseek.dsh.companion

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The chapter-36 bundled tool set and its refusal of dynamic dispatch. */
class LiteToolRegistryTest {
    @Test
    fun bundlesTheChapterThirtySixToolSet() {
        assertEquals(
            listOf(
                "web_search",
                "url_fetch",
                "image_inspect",
                "attachment_read",
                "artifact_create",
                "calculator",
                "run_tests",
            ),
            LiteToolRegistry.bundled.map { it.name },
        )
        assertTrue(LiteToolRegistry.bundled.all { it.description.isNotEmpty() }, "every descriptor carries a description")
    }

    @Test
    fun looksUpBundledToolsByName() {
        val tool = LiteToolRegistry.tool("web_search")
        assertEquals("web_search", tool?.name)
        assertEquals("搜索网络并返回结果列表。", tool?.description)
        assertEquals(LiteToolDescriptor(name = "calculator", description = "求值一个算术表达式。"), LiteToolRegistry.tool("calculator"))
    }

    @Test
    fun onlyRunTestsHandsOffToTheFullRuntime() {
        assertEquals(LITE_REQUIRES_FULL_RUNTIME, LiteToolRegistry.handoffCapability("run_tests"))
        assertNull(LiteToolRegistry.handoffCapability("web_search"))
        assertNull(LiteToolRegistry.handoffCapability("calculator"))
    }

    @Test
    fun unknownNamesResolveToNothingNeverDynamically() {
        assertNull(LiteToolRegistry.tool("bash"))
        assertNull(LiteToolRegistry.tool("web_search_exec"))
        assertNull(LiteToolRegistry.handoffCapability("nonexistent"))
    }
}
