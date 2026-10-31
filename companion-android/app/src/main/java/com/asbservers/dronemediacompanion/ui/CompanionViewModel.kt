package com.asbservers.dronemediacompanion.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.asbservers.dronemediacompanion.data.DjiAlbumScanner
import com.asbservers.dronemediacompanion.data.DroneMediaApi
import com.asbservers.dronemediacompanion.data.LocalFileAccess
import com.asbservers.dronemediacompanion.data.LocalMediaItem
import com.asbservers.dronemediacompanion.data.SettingsStore
import com.asbservers.dronemediacompanion.data.UploadEngine
import com.asbservers.dronemediacompanion.data.XxHash64
import com.asbservers.dronemediacompanion.data.parseBasename
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class LibraryStatus {
    Unknown,
    Hashing,
    New,
    InLibrary,
    SoftMatch,
}

data class MediaRow(
    val item: LocalMediaItem,
    val status: LibraryStatus = LibraryStatus.Unknown,
    val digest: String? = null,
    val selected: Boolean = true,
    val uploadProgress: Float = 0f,
)

data class CompanionUiState(
    val serverUrl: String = "",
    val apiKey: String = "",
    val wifiOnly: Boolean = true,
    val connectionMessage: String? = null,
    val busyMessage: String? = null,
    val error: String? = null,
    val rows: List<MediaRow> = emptyList(),
    val uploading: Boolean = false,
)

class CompanionViewModel(
    private val appContext: Context,
    private val settings: SettingsStore,
    private val scanner: DjiAlbumScanner,
    private val fileAccess: LocalFileAccess,
) : ViewModel() {

    private val _state = MutableStateFlow(
        CompanionUiState(
            serverUrl = settings.serverUrl,
            apiKey = settings.apiKey,
            wifiOnly = settings.wifiOnlyUpload,
        ),
    )
    val state: StateFlow<CompanionUiState> = _state.asStateFlow()

    fun updateServerUrl(value: String) {
        _state.update { it.copy(serverUrl = value) }
    }

    fun updateApiKey(value: String) {
        _state.update { it.copy(apiKey = value) }
    }

    fun updateWifiOnly(value: Boolean) {
        settings.wifiOnlyUpload = value
        _state.update { it.copy(wifiOnly = value) }
    }

    fun saveSettings() {
        settings.serverUrl = _state.value.serverUrl
        settings.apiKey = _state.value.apiKey
    }

    fun testConnection() {
        viewModelScope.launch {
            _state.update { it.copy(busyMessage = "Testing connection…", error = null) }
            saveSettings()
            val result = withContext(Dispatchers.IO) {
                api().ping()
            }
            _state.update {
                it.copy(
                    busyMessage = null,
                    connectionMessage = result.fold(
                        onSuccess = { user -> "Connected as $user" },
                        onFailure = { e -> null },
                    ),
                    error = result.exceptionOrNull()?.message,
                )
            }
        }
    }

    fun scanAndCheck() {
        viewModelScope.launch {
            _state.update { it.copy(busyMessage = "Scanning DJI Album…", error = null) }
            saveSettings()
            val scanned = withContext(Dispatchers.IO) { scanner.scan() }
            val rows = scanned.map { MediaRow(it) }
            _state.update { it.copy(rows = rows, busyMessage = "Checking library…") }
            classifyRows(rows)
        }
    }

    private suspend fun classifyRows(initial: List<MediaRow>) {
        val api = api()
        val batchSize = 50
        val updated = initial.toMutableList()
        for (chunk in updated.indices.chunked(batchSize)) {
            val digests = mutableListOf<String>()
            val soft = mutableListOf<Triple<String, String, Long>>()
            val indexMap = mutableListOf<Int>()
            for (i in chunk) {
                val row = updated[i]
                _state.update { s ->
                    s.copy(rows = s.rows.map { r ->
                        if (r.item.id == row.item.id) r.copy(status = LibraryStatus.Hashing) else r
                    })
                }
                val digest = withContext(Dispatchers.IO) {
                    val (path, temp) = fileAccess.resolvePath(row.item)
                    try {
                        XxHash64.hashFile(path)
                    } finally {
                        fileAccess.cleanupTemp(path, temp)
                    }
                }
                val (basename, _) = parseBasename(row.item.displayName)
                val softKey = "${row.item.relativePath}::${row.item.sizeBytes}"
                digests += digest
                soft += Triple(softKey, basename, row.item.sizeBytes)
                indexMap += i
                updated[i] = row.copy(digest = digest)
            }
            val dup = api.lookupDuplicates(digests, soft).getOrElse { e ->
                _state.update { it.copy(busyMessage = null, error = e.message) }
                return
            }
            for ((j, i) in indexMap.withIndex()) {
                val digest = digests[j]
                val softKey = soft[j].first
                val status = when {
                    digest in dup.hashMatches -> LibraryStatus.InLibrary
                    softKey in dup.softMatches -> LibraryStatus.SoftMatch
                    else -> LibraryStatus.New
                }
                val selected = status == LibraryStatus.New
                updated[i] = updated[i].copy(status = status, selected = selected)
            }
            _state.update { it.copy(rows = updated.toList()) }
        }
        val newCount = updated.count { it.status == LibraryStatus.New }
        _state.update {
            it.copy(
                busyMessage = null,
                connectionMessage = "$newCount new · ${updated.size - newCount} already in library",
            )
        }
    }

    fun toggleSelected(itemId: Long) {
        _state.update { s ->
            s.copy(
                rows = s.rows.map { row ->
                    if (row.item.id == itemId) row.copy(selected = !row.selected) else row
                },
            )
        }
    }

    fun uploadSelected() {
        viewModelScope.launch {
            val selected = _state.value.rows.filter { it.selected && it.status == LibraryStatus.New }
            if (selected.isEmpty()) {
                _state.update { it.copy(error = "No new files selected") }
                return@launch
            }
            _state.update { it.copy(uploading = true, busyMessage = "Uploading…", error = null) }
            saveSettings()
            val engine = UploadEngine(appContext, api())
            val result = withContext(Dispatchers.IO) {
                engine.uploadItems(selected.map { it.item }) { item, progress ->
                    _state.update { s ->
                        s.copy(
                            rows = s.rows.map { row ->
                                if (row.item.id == item.id) row.copy(uploadProgress = progress) else row
                            },
                        )
                    }
                }
            }
            _state.update {
                it.copy(
                    uploading = false,
                    busyMessage = null,
                    error = result.exceptionOrNull()?.message,
                    connectionMessage = result.fold(
                        onSuccess = { batch -> "Upload committed ($batch)" },
                        onFailure = { null },
                    ),
                )
            }
            if (result.isSuccess) {
                classifyRows(_state.value.rows)
            }
        }
    }

    private fun api(): DroneMediaApi {
        val s = _state.value
        return DroneMediaApi(s.serverUrl, s.apiKey)
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            val appContext = context.applicationContext
            return CompanionViewModel(
                appContext,
                SettingsStore(appContext),
                DjiAlbumScanner(appContext),
                LocalFileAccess(appContext),
            ) as T
        }
    }
}
