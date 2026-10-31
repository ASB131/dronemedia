package com.asbservers.dronemediacompanion.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SettingsStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "companion_settings",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER, "") ?: ""
        set(value) {
            prefs.edit().putString(KEY_SERVER, value.trim().trimEnd('/')).apply()
        }

    var sessionToken: String
        get() = prefs.getString(KEY_SESSION, "") ?: ""
        set(value) {
            prefs.edit().putString(KEY_SESSION, value.trim()).apply()
        }

    var username: String
        get() = prefs.getString(KEY_USERNAME, "") ?: ""
        set(value) {
            prefs.edit().putString(KEY_USERNAME, value.trim()).apply()
        }

    var wifiOnlyUpload: Boolean
        get() = prefs.getBoolean(KEY_WIFI_ONLY, true)
        set(value) {
            prefs.edit().putBoolean(KEY_WIFI_ONLY, value).apply()
        }

    fun clearSession() {
        prefs.edit()
            .remove(KEY_SESSION)
            .remove(KEY_USERNAME)
            .apply()
    }

    companion object {
        private const val KEY_SERVER = "server_url"
        private const val KEY_SESSION = "session_token"
        private const val KEY_USERNAME = "username"
        private const val KEY_WIFI_ONLY = "wifi_only"
    }
}
