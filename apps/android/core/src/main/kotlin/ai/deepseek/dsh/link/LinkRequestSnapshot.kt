package ai.deepseek.dsh.link

/** Current local request ownership and saturated lifetime counts; no remote health or authorization claim. */
data class LinkRequestSnapshot(val closed: Boolean, val pendingRequests: Int, val startedRequests: Long, val finishedRequests: Long)
