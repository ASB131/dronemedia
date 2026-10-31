package com.asbservers.dronemediacompanion.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class DroneMediaApi(
    private val baseUrl: String,
    private val apiKey: String,
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    private fun authed(path: String): Request.Builder {
        val url = baseUrl.trimEnd('/') + path
        return Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $apiKey")
    }

    fun ping(): Result<String> = runCatching {
        val response = client.newCall(
            authed("/api/companion/ping").get().build(),
        ).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            error(parseError(body) ?: "HTTP ${response.code}")
        }
        val json = JSONObject(body)
        json.optString("username", "ok")
    }

    data class DuplicateResult(
        val hashMatches: Set<String>,
        val softMatches: Set<String>,
    )

    fun lookupDuplicates(
        digests: List<String>,
        soft: List<Triple<String, String, Long>>,
    ): Result<DuplicateResult> = runCatching {
        val payload = JSONObject()
        if (digests.isNotEmpty()) {
            payload.put("digests", JSONArray(digests))
        }
        if (soft.isNotEmpty()) {
            val arr = JSONArray()
            for ((key, basename, size) in soft) {
                arr.put(
                    JSONObject()
                        .put("key", key)
                        .put("basename", basename)
                        .put("sizeBytes", size),
                )
            }
            payload.put("soft", arr)
        }
        val response = client.newCall(
            authed("/api/upload/duplicates")
                .post(payload.toString().toRequestBody(jsonType))
                .build(),
        ).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            error(parseError(body) ?: "Duplicate lookup failed")
        }
        val json = JSONObject(body)
        val hashMatches = mutableSetOf<String>()
        json.optJSONArray("hashMatches")?.let { arr ->
            for (i in 0 until arr.length()) {
                hashMatches += arr.getJSONObject(i).getString("digest")
            }
        }
        val softMatches = mutableSetOf<String>()
        json.optJSONArray("softMatches")?.let { arr ->
            for (i in 0 until arr.length()) {
                softMatches += arr.getJSONObject(i).getString("key")
            }
        }
        DuplicateResult(hashMatches, softMatches)
    }

    data class InitFile(
        val id: String,
        val chunkSizeBytes: Int,
        val totalChunks: Int,
        val uploadedChunkIndices: List<Int>,
    )

    data class BatchInit(
        val batchId: String,
        val chunkSizeBytes: Int,
        val files: List<InitFile>,
    )

    fun initBatch(files: List<LocalMediaItem>): Result<BatchInit> = runCatching {
        val arr = JSONArray()
        for (file in files) {
            arr.put(
                JSONObject()
                    .put("filename", file.displayName)
                    .put("sizeBytes", file.sizeBytes)
                    .put("lastModifiedMs", file.lastModifiedMs)
                    .put("relativePath", file.relativePath),
            )
        }
        val payload = JSONObject().put("files", arr)
        val response = client.newCall(
            authed("/api/upload/batch")
                .post(payload.toString().toRequestBody(jsonType))
                .build(),
        ).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            error(parseError(body) ?: "Batch init failed")
        }
        val json = JSONObject(body)
        val batchId = json.getString("batchId")
        val chunkSize = json.getInt("chunkSizeBytes")
        val outFiles = mutableListOf<InitFile>()
        val filesJson = json.getJSONArray("files")
        for (i in 0 until filesJson.length()) {
            val f = filesJson.getJSONObject(i)
            val uploaded = mutableListOf<Int>()
            f.optJSONArray("uploadedChunkIndices")?.let { u ->
                for (j in 0 until u.length()) uploaded += u.getInt(j)
            }
            outFiles += InitFile(
                id = f.getString("id"),
                chunkSizeBytes = f.getInt("chunkSizeBytes"),
                totalChunks = f.getInt("totalChunks"),
                uploadedChunkIndices = uploaded,
            )
        }
        BatchInit(batchId, chunkSize, outFiles)
    }

    fun uploadChunk(fileId: String, index: Int, bytes: ByteArray): Result<Unit> = runCatching {
        val response = client.newCall(
            authed("/api/upload/files/$fileId/chunks/$index")
                .put(bytes.toRequestBody("application/octet-stream".toMediaType()))
                .build(),
        ).execute()
        if (!response.isSuccessful) {
            val body = response.body?.string().orEmpty()
            error(parseError(body) ?: "Chunk upload failed")
        }
    }

    fun completeFile(fileId: String): Result<Unit> = runCatching {
        val response = client.newCall(
            authed("/api/upload/files/$fileId/complete").post("{}".toRequestBody(jsonType)).build(),
        ).execute()
        if (!response.isSuccessful) {
            val body = response.body?.string().orEmpty()
            error(parseError(body) ?: "Complete failed")
        }
    }

    fun commitBatch(batchId: String): Result<Unit> = runCatching {
        val response = client.newCall(
            authed("/api/upload/batch/$batchId/commit").post("{}".toRequestBody(jsonType)).build(),
        ).execute()
        if (!response.isSuccessful) {
            val body = response.body?.string().orEmpty()
            error(parseError(body) ?: "Commit failed")
        }
    }

    private fun parseError(body: String): String? {
        if (body.isBlank()) return null
        return runCatching { JSONObject(body).optString("error") }.getOrNull()?.takeIf { it.isNotBlank() }
    }
}
