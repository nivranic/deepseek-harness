package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.LinkClientException
import ai.deepseek.dsh.link.WireValue
import java.util.Base64

/** Accepted bytes from one fixed-version, Session-scoped request. */
internal data class NativeResourceWindow(val bytes: ByteArray, val eof: Boolean)
internal class NativeResourceChanged : Exception()

/** Shared parsing for bounded previews and disk downloads; no caller may splice changed descriptors. */
internal object NativeResourceWire {
    fun descriptor(value: WireValue): NativeFileDescriptor {
        val path = WireShape.string(value, "absolutePath")?.takeIf(String::isNotBlank) ?: invalid("resource path is missing")
        val version = WireShape.string(value, "version")?.takeIf(String::isNotBlank) ?: invalid("resource version is missing")
        val fields = (value as? WireValue.ObjectValue)?.entries ?: invalid("resource descriptor required")
        return NativeFileDescriptor(path, version, if (fields.containsKey("bytes")) integer(value, "bytes") else null)
    }

    fun window(value: WireValue, expected: NativeFileDescriptor, offset: Long, length: Int): NativeResourceWindow {
        if (descriptor(value) != expected) throw NativeResourceChanged()
        if (integer(value, "offset") != offset) invalid("resource byte offset differs")
        val eof = WireShape.boolean(value, "eof") ?: invalid("resource EOF is missing")
        val encoded = WireShape.string(value, "data") ?: invalid("resource bytes are missing")
        if (encoded.length.toLong() > ((length.toLong() + 2) / 3) * 4) invalid("resource window exceeds requested size")
        val bytes = try { Base64.getDecoder().decode(encoded) }
        catch (_: IllegalArgumentException) { invalid("resource base64 is invalid") }
        if (Base64.getEncoder().encodeToString(bytes) != encoded) invalid("resource base64 is not canonical")
        if (bytes.size > length || bytes.isEmpty() && !eof) invalid("resource window makes no bounded progress")
        val total = offset + bytes.size
        if (total > 9_007_199_254_740_991L) invalid("resource size exceeds a safe integer")
        if (expected.bytes != null && (total > expected.bytes || eof != (total == expected.bytes))) {
            invalid("resource EOF differs from its size")
        }
        return NativeResourceWindow(bytes, eof)
    }

    private fun integer(value: WireValue, field: String): Long {
        val number = WireShape.number(value, field) ?: invalid("resource $field is missing")
        if (!number.isFinite() || number < 0 || number > 9_007_199_254_740_991.0 || number != kotlin.math.floor(number)) {
            invalid("resource $field must be a nonnegative safe integer")
        }
        return number.toLong()
    }

    private fun invalid(message: String): Nothing = throw LinkClientException.BadWire(message)
}
