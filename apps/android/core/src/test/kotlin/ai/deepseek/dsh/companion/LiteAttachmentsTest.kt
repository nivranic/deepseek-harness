package ai.deepseek.dsh.companion

import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun tempDir(): java.io.File =
    java.nio.file.Files.createTempDirectory("lite-attachments").toFile()

/** The local attachment retention channel and its typed intake. */
class LiteAttachmentsTest {
    @Test
    fun attachmentBytesAndMediaTypeRoundTripThroughTheStore() {
        val store = LiteFileAttachmentStore(tempDir())
        assertNull(store.get("photo.jpg"))

        val bytes = "图片字节".encodeToByteArray()
        store.put("photo.jpg", bytes, "image/png")
        assertContentEquals(bytes, store.get("photo.jpg"))

        store.remove("photo.jpg")
        assertNull(store.get("photo.jpg"))
        assertTrue(store.list().isEmpty())
    }

    @Test
    fun listReportsSortedEntriesWithNamesMediaTypesAndSizes() {
        val store = LiteFileAttachmentStore(tempDir())
        store.put("b.txt", "两个字节".encodeToByteArray(), "text/plain")
        store.put("a.png", "png".encodeToByteArray(), "image/png")

        assertEquals(
            listOf(
                LiteAttachmentEntry(name = "a.png", mediaType = "image/png", sizeBytes = 3),
                LiteAttachmentEntry(name = "b.txt", mediaType = "text/plain", sizeBytes = "两个字节".encodeToByteArray().size.toLong()),
            ),
            store.list(),
        )
    }

    @Test
    fun puttingTheSameNameReplacesThePriorAttachment() {
        val store = LiteFileAttachmentStore(tempDir())
        store.put("draft.md", "旧内容".encodeToByteArray(), "text/markdown")
        store.put("draft.md", "新内容".encodeToByteArray(), "text/markdown")

        assertEquals(1, store.list().size)
        assertContentEquals("新内容".encodeToByteArray(), store.get("draft.md"))
        assertEquals("新内容".encodeToByteArray().size.toLong(), store.list().single().sizeBytes)
    }

    @Test
    fun aCorruptSidecarFailsTheListLoud() {
        val directory = tempDir()
        val store = LiteFileAttachmentStore(directory)
        store.put("broken.png", "png".encodeToByteArray(), "image/png")
        java.io.File(directory, "broken.png.attachment.json").writeText("不是 JSON")

        assertFailsWith<IllegalStateException> { store.list() }
    }

    @Test
    fun aSidecarWithoutBytesReadsAsAbsentFromTheList() {
        val directory = tempDir()
        val store = LiteFileAttachmentStore(directory)
        store.put("kept.png", "png".encodeToByteArray(), "image/png")
        store.put("gone.png", "png".encodeToByteArray(), "image/png")
        java.io.File(directory, "gone.png.attachment").delete()

        assertEquals(listOf("kept.png"), store.list().map { it.name })
    }

    @Test
    fun theStoreNameTakesTheFinalPathSegmentOfADisplayName() {
        assertEquals("photo.jpg", LiteAttachmentIntake.storeName("dir/sub/photo.jpg"))
        assertEquals("img.png", LiteAttachmentIntake.storeName("""C:\Users\host\img.png"""))
        assertEquals("报告.pdf", LiteAttachmentIntake.storeName("  报告.pdf  "))
        assertNull(LiteAttachmentIntake.storeName(null))
        assertNull(LiteAttachmentIntake.storeName("   "))
        assertNull(LiteAttachmentIntake.storeName("a/b/"))
    }

    @Test
    fun intakeAdmitsADocumentUnderItsDerivedStoreName() {
        val store = LiteFileAttachmentStore(tempDir())
        val bytes = "附件内容".encodeToByteArray()

        val outcome = LiteAttachmentIntake.intake(store, "content/seed/notes.md", bytes, "text/markdown")

        assertEquals(
            LiteAttachmentIntake.Outcome.Stored(
                LiteAttachmentEntry(name = "notes.md", mediaType = "text/markdown", sizeBytes = bytes.size.toLong()),
            ),
            outcome,
        )
        assertContentEquals(bytes, store.get("notes.md"))
    }

    @Test
    fun intakeFallsBackToAGeneratedNameAndTheUnstatedMediaType() {
        val store = LiteFileAttachmentStore(tempDir())

        val outcome = LiteAttachmentIntake.intake(store, null, "内容".encodeToByteArray(), null)

        val entry = (outcome as LiteAttachmentIntake.Outcome.Stored).entry
        assertTrue(entry.name.startsWith("attachment-"), "got ${entry.name}")
        assertEquals(LiteAttachmentIntake.UNSTATED_MEDIA_TYPE, entry.mediaType)
        assertEquals(store.list().single(), entry)
    }

    @Test
    fun intakeRejectsBytesOverTheCapAndStoresNothing() {
        val store = LiteFileAttachmentStore(tempDir())
        val over = ByteArray(LiteAttachmentIntake.CONTENT_LIMIT_BYTES + 1)

        assertEquals(
            LiteAttachmentIntake.Outcome.Failure.TOO_LARGE,
            LiteAttachmentIntake.intake(store, "huge.bin", over, "application/octet-stream"),
        )
        assertTrue(store.list().isEmpty())
        assertNull(store.get("huge.bin"))
    }

    @Test
    fun aStoreWriteFailureAnswersStoreFailed() {
        val refusing = object : LiteAttachmentStoring by LiteFileAttachmentStore(tempDir()) {
            override fun put(name: String, data: ByteArray, mediaType: String) {
                throw IOException("disk full")
            }
        }

        assertEquals(
            LiteAttachmentIntake.Outcome.Failure.STORE_FAILED,
            LiteAttachmentIntake.intake(refusing, "any.md", "内容".encodeToByteArray(), "text/markdown"),
        )
    }
}
