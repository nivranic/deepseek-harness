package ai.deepseek.dsh.companion

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class SupportApplicationSourceTest {
    @Test fun absentSourceDoesNotInventAnApplicationBuild() {
        assertNull(SupportApplicationSource.fromMetadata(null, null))
        assertNull(SupportApplicationSource.fromMetadata("", ""))
        assertEquals(SupportApplicationSource("a".repeat(40), "b".repeat(40)),
            SupportApplicationSource.fromMetadata("a".repeat(40), "b".repeat(40)))
    }

    @Test fun partialOrUnresolvedApplicationMetadataRefusesExport() {
        for (invalid in listOf(null, "", 1, false, "a".repeat(39), "A".repeat(40), "a".repeat(40) + "\n", "\${sourceSha}")) {
            for ((source, tree) in listOf(invalid to "b".repeat(40), "a".repeat(40) to invalid)) {
                assertEquals(SupportExportFailure.INVALID_IDENTITY,
                    assertFailsWith<SupportExportException> { SupportApplicationSource.fromMetadata(source, tree) }.failure)
            }
        }
    }
}
