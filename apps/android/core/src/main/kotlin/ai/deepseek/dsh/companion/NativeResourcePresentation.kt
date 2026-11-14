package ai.deepseek.dsh.companion

/** Application-selected rendering budgets independent of the transport's retained byte budget. */
data class NativeResourcePresentationLimits(val maxTextChars: Int, val maxImagePixels: Long) {
    init { require(maxTextChars > 0 && maxImagePixels > 0) }
}

/** Conservative signatures select inert image decoders; unknown bytes never enable active content. */
fun nativeResourceMedia(bytes: ByteArray): String? {
    fun at(offset: Int, vararg signature: Int) = signature.indices.all { index ->
        offset + index < bytes.size && bytes[offset + index].toInt() and 255 == signature[index]
    }
    return when {
        at(0, 0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10) -> "image/png"
        at(0, 255, 216, 255) -> "image/jpeg"
        at(0, 71, 73, 70, 56) && (at(4, 55, 97) || at(4, 57, 97)) -> "image/gif"
        at(0, 82, 73, 70, 70) && at(8, 87, 69, 66, 80) -> "image/webp"
        at(0, 66, 77) -> "image/bmp"
        at(0, 0, 0, 1, 0) -> "image/x-icon"
        at(0, 80, 75) && (at(2, 3, 4) || at(2, 5, 6) || at(2, 7, 8)) -> "application/zip"
        else -> null
    }
}

/** Decode complete UTF-8 text only; binary controls and malformed sequences remain a byte preview. */
fun nativeResourceText(bytes: ByteArray): String? {
    val text = try { bytes.decodeToString(throwOnInvalidSequence = true) }
    catch (_: java.nio.charset.CharacterCodingException) { return null }
    return text.takeIf { value -> value.none { it.code < 32 && it != '\n' && it != '\r' && it != '\t' } }
}

/** Hexadecimal rows for an already bounded prefix; offsets remain byte-based. */
fun nativeResourceHex(bytes: ByteArray): String = bytes.asList().chunked(16).mapIndexed { index, row ->
    (index * 16).toString(16).padStart(8, '0') + "  " + row.joinToString(" ") { (it.toInt() and 255).toString(16).padStart(2, '0') }
}.joinToString("\n")
