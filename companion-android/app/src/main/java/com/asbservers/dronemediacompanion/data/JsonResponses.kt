package com.asbservers.dronemediacompanion.data

import org.json.JSONObject

object JsonResponses {
    fun parseObject(body: String, httpCode: Int): JSONObject {
        val trimmed = body.trimStart()
        if (trimmed.startsWith("<!DOCTYPE", ignoreCase = true) ||
            trimmed.startsWith("<html", ignoreCase = true)
        ) {
            error(
                "Server returned a web page, not the Drone Media API. " +
                    "Check the URL and deploy the latest server version.",
            )
        }
        return try {
            JSONObject(body)
        } catch (_: Exception) {
            error("Invalid response from server (HTTP $httpCode)")
        }
    }

    fun errorMessage(body: String): String? {
        if (body.isBlank()) return null
        return runCatching {
            parseObject(body, 0).optString("error").takeIf { it.isNotBlank() }
        }.getOrNull()
    }
}
