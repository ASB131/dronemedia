package com.asbservers.dronemediacompanion.data

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Path
import kotlin.io.path.deleteIfExists

class LocalFileAccess(private val context: Context) {
    private val cacheDir = File(context.cacheDir, "media_access").apply { mkdirs() }

    /** Returns a readable path; may copy content:// into cache (caller can delete temp copies). */
    fun resolvePath(item: LocalMediaItem): Pair<Path, Boolean> {
        if (item.contentUri.scheme == "file") {
            return File(item.contentUri.path!!).toPath() to false
        }
        val out = File(cacheDir, "${item.id}_${item.displayName}")
        if (!out.exists() || out.length() != item.sizeBytes) {
            context.contentResolver.openInputStream(item.contentUri)?.use { input ->
                FileOutputStream(out).use { output -> input.copyTo(output) }
            } ?: error("Cannot read ${item.displayName}")
        }
        return out.toPath() to true
    }

    fun cleanupTemp(path: Path, wasTemp: Boolean) {
        if (wasTemp) path.deleteIfExists()
    }

    /** Hash without copying whole media files into cache (important for large videos). */
    fun hashItem(item: LocalMediaItem): String {
        if (item.contentUri.scheme == "file") {
            return XxHash64.hashFile(File(item.contentUri.path!!).toPath())
        }
        val stream = context.contentResolver.openInputStream(item.contentUri)
            ?: error("Cannot read ${item.displayName}")
        return stream.use { XxHash64.hashInputStream(it) }
    }
}
