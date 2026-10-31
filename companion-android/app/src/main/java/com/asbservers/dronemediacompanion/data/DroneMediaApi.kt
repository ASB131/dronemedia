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
    private val sessionToken: String = "",
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    private fun url(path: String): String = baseUrl.trimEnd('/') + path

    private fun Request.Builder.withSession(): Request.Builder {
        if (sessionToken.isNotBlank()) {
            header("Authorization", "Bearer $sessionToken")
        }
        return this
    }

    fun fetchServerInfo(): Result<Unit> = runCatching {
        val response = client.newCall(
            Request.Builder().url(url("/api/companion/info")).get().build(),
        ).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            error(JsonResponses.errorMessage(body) ?: "HTTP ${response.code}")
        }
        val json = JsonResponses.parseObject(body, response.code)
        if (json.optString("service") != "dronemedia") {
            error("This site does not look like Drone Media")
        }
    }

    data class LoginResult(val sessionToken: String, val username: String)

    fun login(username: String, password: String): Result<LoginResult> = runCatching {
        val payload = JSONObject()
            .put("username", username)
            .put("password", password)
        val response = client.newCall(
            Request.Builder()
                .url(url("/api/companion/login"))
                .post(payload.toString().toRequestBody(jsonType))
                .build(),
        ).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            error(JsonResponses.errorMessage(body) ?: "Sign in failed")
        }
        val json = JsonResponses.parseObject(body, response.code)
        LoginResult(
            sessionToken = json.getString("sessionToken"),
            username = json.getString("username"),
        )
    }

    fun logout(): Result<Unit> = runCatching {
        if (sessionToken.isBlank()) return@runCatching
        val response = client.newCall(
            Request.Builder()
                .url(url("/api/companion/logout"))
                .post("{}".toRequestBody(jsonType))
                .withSession()
                .build(),
        ).execute()
        if (!response.isSuccessful) {
            val body = response.body?.string().orEmpty()
            error(JsonResponses.errorMessage(body) ?: "Sign out failed")
        }
    }

    fun ping(): Result<String> = runCatching {
        val response = client.newCall(
            Request.Builder()
                .url(url("/api/companion/ping"))
                .get()
                .withSession()
                .build(),
        ).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            error(JsonResponses.errorMessage(body) ?: "HTTP ${response.code}")
        }
        val json = JsonResponses.parseObject(body, response.code)
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
            Request.Builder()
                .url(url("/api/upload/duplicates"))
                .post(payload.toString().toRequestBody(jsonType))
                .withSession()
                .build(),
        ).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            error(JsonResponses.errorMessage(body) ?: "Duplicate lookup failed")
        }
        val json = JsonResponses.parseObject(body, response.code)
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
            Request.Builder()
                .url(url("/api/upload/batch"))
                .post(payload.toString().toRequestBody(jsonType))
                .withSession()
                .build(),
        ).execute()
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            error(JsonResponses.errorMessage(body) ?: "Batch init failed")
        }
        val json = JsonResponses.parseObject(body, response.code)
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
            Request.Builder()
                .url(url("/api/upload/files/$fileId/chunks/$index"))
                .put(bytes.toRequestBody("application/octet-stream".toMediaType()))
                .withSession()
                .build(),
        ).execute()
        if (!response.isSuccessful) {
            val body = response.body?.string().orEmpty()
            error(JsonResponses.errorMessage(body) ?: "Chunk upload failed")
        }
    }

    fun completeFile(fileId: String): Result<Unit> = runCatching {
        val response = client.newCall(
            Request.Builder()
                .url(url("/api/upload/files/$fileId/complete"))
                .post("{}".toRequestBody(jsonType))
                .withSession()
                .build(),
        ).execute()
        if (!response.isSuccessful) {
            val body = response.body?.string().orEmpty()
            error(JsonResponses.errorMessage(body) ?: "Complete failed")
        }
    }

    fun commitBatch(batchId: String): Result<Unit> = runCatching {
        val response = client.newCall(
            Request.Builder()
                .url(url("/api/upload/batch/$batchId/commit"))
                .post("{}".toRequestBody(jsonType))
                .withSession()
                .build(),
        ).execute()
        if (!response.isSuccessful) {
            val body = response.body?.string().orEmpty()
            error(JsonResponses.errorMessage(body) ?: "Commit failed")
        }
    }
}
