package com.asbservers.dronemediacompanion.data

object ServerUrlNormalizer {
    fun normalize(input: String): String {
        var value = input.trim().trimEnd('/')
        if (value.isEmpty()) return ""
        if (!value.contains("://")) {
            value = "https://$value"
        }
        return value.trimEnd('/')
    }
}
