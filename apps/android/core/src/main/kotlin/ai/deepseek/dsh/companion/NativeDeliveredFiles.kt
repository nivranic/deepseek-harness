package ai.deepseek.dsh.companion

import ai.deepseek.dsh.link.WireValue

/** One current Host delivery declaration, identified by durable event and original file index. */
data class NativeDeliveredFile(val seq: Long, val index: Int, val path: String, val description: String?)

/** Project current deliverables/presented events; descriptions and paths never grant filesystem access. */
fun nativeDeliveredFiles(records: List<WireValue>): List<NativeDeliveredFile> = records.flatMap { record ->
    val event = WireShape.objectValue(record, "event") ?: return@flatMap emptyList()
    if (WireShape.string(event, "type") != "deliverables/presented") return@flatMap emptyList()
    val data = WireShape.objectValue(event, "data") ?: return@flatMap emptyList()
    val turn = WireShape.number(data, "turn") ?: return@flatMap emptyList()
    if (!turn.isFinite() || turn < 1 || turn > 9_007_199_254_740_991.0 || turn != kotlin.math.floor(turn) ||
        WireShape.string(data, "callId").isNullOrEmpty()) return@flatMap emptyList()
    val seq = WireShape.number(event, "seq") ?: return@flatMap emptyList()
    if (!seq.isFinite() || seq < 0 || seq > 9_007_199_254_740_991.0 || seq != kotlin.math.floor(seq)) return@flatMap emptyList()
    (WireShape.array(data, "files") ?: emptyList()).mapIndexedNotNull { index, file ->
        val path = WireShape.string(file, "path")?.takeIf(String::isNotBlank) ?: return@mapIndexedNotNull null
        val fields = (file as? WireValue.ObjectValue)?.entries ?: return@mapIndexedNotNull null
        if (fields.containsKey("description") && WireShape.string(file, "description") == null) return@mapIndexedNotNull null
        NativeDeliveredFile(seq.toLong(), index, path, WireShape.string(file, "description"))
    }
}
