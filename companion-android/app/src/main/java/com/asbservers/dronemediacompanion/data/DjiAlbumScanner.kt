package com.asbservers.dronemediacompanion.data

import android.content.ContentUris
import android.content.Context
import android.net.Uri
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
    val contentUri: Uri,
)

class DjiAlbumScanner(private val context: Context) {

    fun scan(): List<LocalMediaItem> {
        val fromStore = queryMediaStore()
        val fromDisk = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            scanLegacyFolders()
        } else {
            emptyList()
        }
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

    private fun isDjiAlbumPath(relativePath: String, displayName: String, dataPath: String?): Boolean {
        val combined = buildString {
            append(relativePath)
            if (!dataPath.isNullOrBlank()) append(' ').append(dataPath)
            append(' ').append(displayName)
        }.lowercase()
        return combined.contains("dji") && combined.contains("album")
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
            MediaStore.Files.FileColumns.MEDIA_TYPE,
        )

        val selection = buildString {
            append("(")
            append("${MediaStore.Files.FileColumns.MEDIA_TYPE}=${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}")
            append(" OR ")
            append("${MediaStore.Files.FileColumns.MEDIA_TYPE}=${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO}")
            append(" OR ")
            append("${MediaStore.Files.FileColumns.MEDIA_TYPE}=0")
            append(")")
        }

        val cursor = context.contentResolver.query(
            collection,
            projection,
            selection,
            null,
            "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC",
        ) ?: return results

        cursor.use {
            val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val nameCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
            val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
            val modCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
            val relCol = it.getColumnIndex(MediaStore.Files.FileColumns.RELATIVE_PATH)
            val dataCol = it.getColumnIndex(MediaStore.Files.FileColumns.DATA)

            while (it.moveToNext()) {
                val name = it.getString(nameCol) ?: continue
                if (!isUploadCandidate(name)) continue

                val rel = when {
                    relCol >= 0 -> it.getString(relCol)?.replace('\\', '/')?.trimStart('/')
                    else -> null
                }
                val dataPath = if (dataCol >= 0) it.getString(dataCol) else null
                val pathForCheck = rel ?: dataPath?.replace('\\', '/') ?: ""
                if (!isDjiAlbumPath(pathForCheck, name, dataPath)) continue

                val relativePath = rel
                    ?: dataPath?.replace('\\', '/')?.substringAfter("DCIM/", "DJI Album/$name")
                    ?: "DJI Album/$name"

                val size = it.getLong(sizeCol)
                if (size <= 0) continue
                val id = it.getLong(idCol)
                val uri = ContentUris.withAppendedId(collection, id)
                val modifiedSec = it.getLong(modCol)
                results += LocalMediaItem(
                    id = id,
                    displayName = name,
                    relativePath = relativePath,
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
        val root = File(dcim, "DJI Album")
        if (!root.isDirectory) return emptyList()
        val results = mutableListOf<LocalMediaItem>()
        root.walkTopDown().maxDepth(8).filter { it.isFile }.forEach { file ->
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
                contentUri = Uri.fromFile(file),
            )
        }
        return results
    }
}
