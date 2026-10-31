package com.asbservers.dronemediacompanion.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.asbservers.dronemediacompanion.data.DjiAlbumScanner
import com.asbservers.dronemediacompanion.data.DroneMediaApi
import com.asbservers.dronemediacompanion.data.LocalFileAccess
import com.asbservers.dronemediacompanion.data.LocalMediaItem
import com.asbservers.dronemediacompanion.data.ServerUrlNormalizer
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

enum class CompanionStep {
    Server,
    Login,
    Library,
}

data class MediaRow(
    val item: LocalMediaItem,
    val status: LibraryStatus = LibraryStatus.Unknown,
    val digest: String? = null,
    val selected: Boolean = true,
    val uploadProgress: Float = 0f,
)

data class CompanionUiState(
    val step: CompanionStep = CompanionStep.Server,
    val serverInput: String = "",
    val serverUrl: String = "",
    val loginUsername: String = "",
    val loginPassword: String = "",
    val signedInUsername: String? = null,
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
            serverInput = settings.serverUrl.removePrefix("https://").removePrefix("http://"),
            serverUrl = settings.serverUrl,
            loginUsername = settings.username,
            signedInUsername = settings.username.takeIf { settings.sessionToken.isNotBlank() },
            wifiOnly = settings.wifiOnlyUpload,
            step = when {
                settings.sessionToken.isNotBlank() && settings.serverUrl.isNotBlank() ->
                    CompanionStep.Library
                settings.serverUrl.isNotBlank() -> CompanionStep.Login
                else -> CompanionStep.Server
            },
        ),
    )
    val state: StateFlow<CompanionUiState> = _state.asStateFlow()

    init {
        if (settings.sessionToken.isNotBlank() && settings.serverUrl.isNotBlank()) {
            refreshSession()
        }
    }

    fun updateServerInput(value: String) {
        _state.update { it.copy(serverInput = value, error = null) }
    }

    fun updateLoginUsername(value: String) {
        _state.update { it.copy(loginUsername = value) }
    }

    fun updateLoginPassword(value: String) {
        _state.update { it.copy(loginPassword = value) }
    }

    fun updateWifiOnly(value: Boolean) {
        settings.wifiOnlyUpload = value
        _state.update { it.copy(wifiOnly = value) }
    }

    fun connectServer() {
        viewModelScope.launch {
            val normalized = ServerUrlNormalizer.normalize(_state.value.serverInput)
            if (normalized.isBlank()) {
                _state.update { it.copy(error = "Enter your server address") }
                return@launch
            }
            _state.update { it.copy(busyMessage = "Connecting…", error = null) }
            val result = withContext(Dispatchers.IO) {
                DroneMediaApi(normalized).fetchServerInfo()
            }
            _state.update {
                if (result.isSuccess) {
                    settings.serverUrl = normalized
                    settings.clearSession()
                    it.copy(
                        busyMessage = null,
                        serverUrl = normalized,
                        step = CompanionStep.Login,
                        signedInUsername = null,
                        connectionMessage = "Connected to Drone Media",
                        error = null,
                        rows = emptyList(),
                    )
                } else {
                    it.copy(
                        busyMessage = null,
                        error = result.exceptionOrNull()?.message,
                    )
                }
            }
        }
    }

    fun signIn() {
        viewModelScope.launch {
            val s = _state.value
            if (s.serverUrl.isBlank()) {
                _state.update { it.copy(step = CompanionStep.Server, error = "Connect to a server first") }
                return@launch
            }
            if (s.loginUsername.isBlank() || s.loginPassword.isBlank()) {
                _state.update { it.copy(error = "Enter username and password") }
                return@launch
            }
            _state.update { it.copy(busyMessage = "Signing in…", error = null) }
            val result = withContext(Dispatchers.IO) {
                DroneMediaApi(s.serverUrl).login(s.loginUsername, s.loginPassword)
            }
            _state.update {
                if (result.isSuccess) {
                    val login = result.getOrThrow()
                    settings.serverUrl = s.serverUrl
                    settings.sessionToken = login.sessionToken
                    settings.username = login.username
                    it.copy(
                        busyMessage = null,
                        loginPassword = "",
                        signedInUsername = login.username,
                        step = CompanionStep.Library,
                        connectionMessage = "Signed in as ${login.username}",
                        error = null,
                    )
                } else {
                    it.copy(
                        busyMessage = null,
                        error = result.exceptionOrNull()?.message,
                    )
                }
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            val api = apiOrNull()
            if (api != null) {
                withContext(Dispatchers.IO) { api.logout() }
            }
            settings.clearSession()
            _state.update {
                it.copy(
                    step = CompanionStep.Login,
                    signedInUsername = null,
                    connectionMessage = null,
                    rows = emptyList(),
                    error = null,
                )
            }
        }
    }

    fun changeServer() {
        viewModelScope.launch {
            apiOrNull()?.let { withContext(Dispatchers.IO) { it.logout() } }
            settings.clearSession()
            settings.serverUrl = ""
            _state.update {
                it.copy(
                    step = CompanionStep.Server,
                    serverUrl = "",
                    signedInUsername = null,
                    connectionMessage = null,
                    rows = emptyList(),
                    error = null,
                )
            }
        }
    }

    private fun refreshSession() {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { apiOrNull()?.ping() }
            if (result?.isFailure == true) {
                settings.clearSession()
                _state.update {
                    it.copy(
                        step = CompanionStep.Login,
                        signedInUsername = null,
                        error = result.exceptionOrNull()?.message,
                    )
                }
            }
        }
    }

    fun scanAndCheck() {
        viewModelScope.launch {
            if (_state.value.step != CompanionStep.Library) {
                _state.update { it.copy(error = "Sign in first") }
                return@launch
            }
            _state.update {
                it.copy(busyMessage = "Scanning DJI Album…", error = null, connectionMessage = null)
            }
            val scanned = try {
                withContext(Dispatchers.IO) { scanner.scan() }
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        busyMessage = null,
                        error = e.message ?: "Scan failed — check photo/video permission",
                    )
                }
                return@launch
            }
            if (scanned.isEmpty()) {
                _state.update {
                    it.copy(
                        busyMessage = null,
                        rows = emptyList(),
                        connectionMessage =
                            "No files found in DCIM/DJI Album. Run DJI Quick Transfer first, " +
                            "then allow photo & video access for this app.",
                    )
                }
                return@launch
            }
            val rows = scanned.map { MediaRow(it) }
            _state.update { it.copy(rows = rows, busyMessage = "Checking library…") }
            classifyRows(rows)
        }
    }

    private suspend fun classifyRows(initial: List<MediaRow>) {
        val api = apiOrNull() ?: return
        val batchSize = 50
        val updated = initial.toMutableList()
        for (chunk in updated.indices.chunked(batchSize)) {
            val digests = mutableListOf<String>()
            val soft = mutableListOf<Triple<String, String, Long>>()
            val indexMap = mutableListOf<Int>()
            for (i in chunk) {
                val row = updated[i]
                _state.update { s ->
                    s.copy(
                        rows = s.rows.map { r ->
                            if (r.item.id == row.item.id) r.copy(status = LibraryStatus.Hashing) else r
                        },
                    )
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
            val api = apiOrNull()
            if (api == null) {
                _state.update { it.copy(error = "Sign in first") }
                return@launch
            }
            val selected = _state.value.rows.filter { it.selected && it.status == LibraryStatus.New }
            if (selected.isEmpty()) {
                _state.update { it.copy(error = "No new files selected") }
                return@launch
            }
            _state.update { it.copy(uploading = true, busyMessage = "Uploading…", error = null) }
            val engine = UploadEngine(appContext, api)
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

    private fun apiOrNull(): DroneMediaApi? {
        val url = settings.serverUrl.ifBlank { _state.value.serverUrl }
        val token = settings.sessionToken
        if (url.isBlank() || token.isBlank()) return null
        return DroneMediaApi(url, token)
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
