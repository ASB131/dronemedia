package com.asbservers.dronemediacompanion.data

enum class MediaKind {
    Photo,
    Video,
    Sidecar,
    Other,
}

fun mediaKindForFilename(name: String): MediaKind {
    val ext = extensionOf(name)
    return when {
        ext in setOf("mp4", "mov", "mkv", "avi", "m4v", "webm", "insv") -> MediaKind.Video
        ext in setOf("jpg", "jpeg", "png", "dng", "raw", "tif", "tiff", "heic", "heif") -> MediaKind.Photo
        ext in setOf("srt", "lrf") -> MediaKind.Sidecar
        else -> MediaKind.Other
    }
}

fun isPreviewableMedia(name: String): Boolean {
    return when (mediaKindForFilename(name)) {
        MediaKind.Photo, MediaKind.Video -> true
        else -> false
    }
}
