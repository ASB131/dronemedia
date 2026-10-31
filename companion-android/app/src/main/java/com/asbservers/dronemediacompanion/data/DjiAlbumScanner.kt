package com.asbservers.dronemediacompanion.data

import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

data class LocalMediaItem(
    val id: Long,
    val displayName: String,
    val relativePath: String,
    val sizeBytes: Long,
    val lastModifiedMs: Long,
    val contentUri: android.net.Uri,
)

class DjiAlbumScanner(private val context: Context) {

    fun scan(): List<LocalMediaItem> {
        val fromStore = queryMediaStore()
        val fromDisk = scanLegacyFolders()
        return mergeByKey(fromStore + fromDisk)
    }

    private fun mergeByKey(items: List<LocalMediaItem>): List<LocalMediaItem> {
        val map = linkedMapOf<String, LocalMediaItem>()
        for (item in items) {
            val key = "${item.relativePath}::${item.sizeBytes}::${item.lastModifiedMs}"
            map[key] = item
        }
        return map.values.sortedByDescending { it.lastModifiedMs }
    }

    private fun queryMediaStore(): List<LocalMediaItem> {
        val results = mutableListOf<LocalMediaItem>()
        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Files.getContentUri("external")
        }

        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.DATE_MODIFIED,
            MediaStore.Files.FileColumns.RELATIVE_PATH,
            MediaStore.Files.FileColumns.DATA,
        )

        val selection = buildString {
            append("(")
            append("${MediaStore.Files.FileColumns.MEDIA_TYPE}=${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}")
            append(" OR ")
            append("${MediaStore.Files.FileColumns.MEDIA_TYPE}=${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO}")
            append(" OR ")
            append("${MediaStore.Files.FileColumns.MEDIA_TYPE}=0")
            append(")")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                append(" AND (")
                append("${MediaStore.Files.FileColumns.RELATIVE_PATH} LIKE ?")
                append(" OR ${MediaStore.Files.FileColumns.RELATIVE_PATH} LIKE ?")
                append(")")
            }
        }

        val selectionArgs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            arrayOf("%DCIM/DJI Album/%", "%DCIM/DJI%Album/%")
        } else {
            null
        }

        context.contentResolver.query(
            collection,
            projection,
            selection,
            selectionArgs,
            "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC",
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
            val modCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
            val relCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.RELATIVE_PATH)
            val dataCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATA)

            while (cursor.moveToNext()) {
                val name = cursor.getString(nameCol) ?: continue
                if (!isUploadCandidate(name)) continue
                val rel = cursor.getString(relCol)?.replace('\\', '/')?.trimStart('/')
                    ?: cursor.getString(dataCol)?.let { path ->
                        path.replace('\\', '/').substringAfter("DCIM/", "DJI Album/$name")
                    }
                    ?: "DJI Album/$name"
                if (!rel.contains("DJI", ignoreCase = true)) continue

                val size = cursor.getLong(sizeCol)
                if (size <= 0) continue
                val id = cursor.getLong(idCol)
                val uri = ContentUris.withAppendedId(collection, id)
                val modifiedSec = cursor.getLong(modCol)
                results += LocalMediaItem(
                    id = id,
                    displayName = name,
                    relativePath = rel,
                    sizeBytes = size,
                    lastModifiedMs = modifiedSec * 1000L,
                    contentUri = uri,
                )
            }
        }
        return results
    }

    private fun scanLegacyFolders(): List<LocalMediaItem> {
        val dcim = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM)
        val candidates = listOf(
            File(dcim, "DJI Album"),
            File(dcim, "DJI Album/"),
        )
        val results = mutableListOf<LocalMediaItem>()
        for (root in candidates) {
            if (!root.isDirectory) continue
            root.walkTopDown().maxDepth(6).filter { it.isFile }.forEach { file ->
                if (!isUploadCandidate(file.name)) return@forEach
                val rel = file.absolutePath
                    .replace('\\', '/')
                    .substringAfter("/DCIM/", "DJI Album/${file.name}")
                results += LocalMediaItem(
                    id = file.absolutePath.hashCode().toLong(),
                    displayName = file.name,
                    relativePath = rel,
                    sizeBytes = file.length(),
                    lastModifiedMs = file.lastModified(),
                    contentUri = android.net.Uri.fromFile(file),
                )
            }
        }
        return results
    }
}
