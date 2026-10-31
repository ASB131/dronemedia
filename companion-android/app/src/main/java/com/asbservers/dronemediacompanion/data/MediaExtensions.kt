package com.asbservers.dronemediacompanion.data

private val VIDEO = setOf("mp4", "mov", "mkv", "avi", "m4v", "webm", "insv")
private val PHOTO = setOf("jpg", "jpeg", "png", "dng", "raw", "tif", "tiff", "heic", "heif")
private val TELEMETRY = setOf("srt")
private val PROXY = setOf("lrf")

fun extensionOf(name: String): String {
    val dot = name.lastIndexOf('.')
    if (dot < 0 || dot == name.length - 1) return ""
    return name.substring(dot + 1).lowercase()
}

fun isUploadCandidate(name: String): Boolean {
    val ext = extensionOf(name)
    return ext in VIDEO || ext in PHOTO || ext in TELEMETRY || ext in PROXY
}

fun parseBasename(filename: String): Pair<String, String> {
    val base = filename.substringAfterLast('/').substringAfterLast('\\')
    val ext = extensionOf(base)
    val nameWithoutExt = if (ext.isEmpty()) base else base.dropLast(ext.length + 1)
    return nameWithoutExt.lowercase() to ext
}
