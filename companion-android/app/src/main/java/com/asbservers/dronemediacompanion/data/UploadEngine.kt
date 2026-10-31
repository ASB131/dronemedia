package com.asbservers.dronemediacompanion.data

import android.content.Context
import java.io.RandomAccessFile

class UploadEngine(
    private val context: Context,
    private val api: DroneMediaApi,
) {
    private val fileAccess = LocalFileAccess(context)

    fun uploadItems(
        items: List<LocalMediaItem>,
        onFileProgress: (LocalMediaItem, Float) -> Unit,
    ): Result<String> = runCatching {
        if (items.isEmpty()) error("Nothing to upload")
        val init = api.initBatch(items).getOrThrow()

        init.files.zip(items).forEach { (session, item) ->
            val (path, temp) = fileAccess.resolvePath(item)
            try {
                uploadOne(session, path.toFile(), item, onFileProgress)
            } finally {
                fileAccess.cleanupTemp(path, temp)
            }
        }
        api.commitBatch(init.batchId).getOrThrow()
        init.batchId
    }

    private fun uploadOne(
        session: DroneMediaApi.InitFile,
        file: java.io.File,
        item: LocalMediaItem,
        onFileProgress: (LocalMediaItem, Float) -> Unit,
    ) {
        val uploaded = session.uploadedChunkIndices.toSet()
        val chunkSize = session.chunkSizeBytes
        val totalChunks = session.totalChunks
        val fileLen = file.length()
        RandomAccessFile(file, "r").use { raf ->
            var doneBytes = 0L
            for (index in 0 until totalChunks) {
                if (index in uploaded) {
                    doneBytes += chunkByteSize(fileLen, chunkSize, index)
                    continue
                }
                val start = index.toLong() * chunkSize
                val len = chunkByteSize(fileLen, chunkSize, index)
                raf.seek(start)
                val chunk = ByteArray(len)
                raf.readFully(chunk)
                var attempt = 0
                while (true) {
                    val result = api.uploadChunk(session.id, index, chunk)
                    if (result.isSuccess) break
                    attempt += 1
                    if (attempt >= 3) throw result.exceptionOrNull() ?: error("Chunk failed")
                    Thread.sleep(300L * attempt)
                }
                doneBytes += len
                onFileProgress(item, doneBytes.toFloat() / fileLen.coerceAtLeast(1))
            }
        }
        api.completeFile(session.id).getOrThrow()
        onFileProgress(item, 1f)
    }

    private fun chunkByteSize(fileSize: Long, chunkSize: Int, index: Int): Int {
        val start = index.toLong() * chunkSize
        val end = minOf(start + chunkSize, fileSize)
        return (end - start).toInt()
    }
}
