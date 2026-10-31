package com.asbservers.dronemediacompanion.ui

data class UploadStats(
    val bytesUploaded: Long,
    val bytesTotal: Long,
    val bytesPerSecond: Double,
    val etaSeconds: Long?,
    val currentFileName: String?,
    val filesDone: Int,
    val filesTotal: Int,
) {
    val progress: Float
        get() = if (bytesTotal <= 0) 0f else (bytesUploaded.toFloat() / bytesTotal).coerceIn(0f, 1f)
}

fun computeUploadStats(
    bytesUploaded: Long,
    bytesTotal: Long,
    currentFileName: String?,
    filesDone: Int,
    filesTotal: Int,
    speedSamples: List<Pair<Long, Long>>,
): UploadStats {
    val now = System.currentTimeMillis()
    val window = speedSamples.filter { now - it.first <= 5000 }
    var bytesPerSecond = 0.0
    if (window.size >= 2) {
        val first = window.first()
        val last = window.last()
        val dt = (last.first - first.first) / 1000.0
        if (dt > 0) {
            bytesPerSecond = ((last.second - first.second) / dt).coerceAtLeast(0.0)
        }
    }
    val remaining = (bytesTotal - bytesUploaded).coerceAtLeast(0)
    val etaSeconds = if (bytesPerSecond > 1024) {
        (remaining / bytesPerSecond).toLong()
    } else {
        null
    }
    return UploadStats(
        bytesUploaded = bytesUploaded,
        bytesTotal = bytesTotal,
        bytesPerSecond = bytesPerSecond,
        etaSeconds = etaSeconds,
        currentFileName = currentFileName,
        filesDone = filesDone,
        filesTotal = filesTotal,
    )
}

fun formatSpeed(bytesPerSecond: Double): String {
    if (bytesPerSecond <= 0) return "—"
    return "${formatBytes(bytesPerSecond.toLong())}/s"
}

fun formatEta(seconds: Long?): String {
    if (seconds == null || seconds < 0) return "—"
    if (seconds < 60) return "${seconds.coerceAtLeast(1)}s left"
    val mins = seconds / 60
    val secs = seconds % 60
    if (mins < 60) return "${mins}m ${secs}s left"
    val hours = mins / 60
    val remMins = mins % 60
    return "${hours}h ${remMins}m left"
}

fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    var v = bytes.toDouble()
    var u = 0
    while (v >= 1024 && u < units.lastIndex) {
        v /= 1024
        u++
    }
    return if (u == 0) "${bytes} B" else String.format("%.1f %s", v, units[u])
}
