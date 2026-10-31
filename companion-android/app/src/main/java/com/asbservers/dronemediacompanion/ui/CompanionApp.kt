package com.asbservers.dronemediacompanion.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.asbservers.dronemediacompanion.ui.components.MediaListItem
import com.asbservers.dronemediacompanion.ui.components.MediaPreviewDialog
import com.asbservers.dronemediacompanion.ui.theme.DroneMediaTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompanionApp(context: Context) {
    val vm: CompanionViewModel = viewModel(factory = CompanionViewModel.Factory(context))
    val state by vm.state.collectAsState()

    val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        arrayOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO,
        )
    } else {
        arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.isNotEmpty() && grants.values.all { it }) {
            vm.scanAndCheck()
        }
    }

    val hasMediaPermission = permissions.all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

    DroneMediaTheme {
        state.previewItem?.let { item ->
            MediaPreviewDialog(item = item, onDismiss = vm::closePreview)
        }

        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text("Drone Media")
                            Text(
                                "Companion",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surfaceContainer,
                    ),
                    actions = {
                        if (state.step == CompanionStep.Library) {
                            TextButton(onClick = vm::signOut) { Text("Sign out") }
                        }
                    },
                )
            },
            containerColor = MaterialTheme.colorScheme.background,
        ) { padding ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                when (state.step) {
                    CompanionStep.Server -> ServerStep(
                        serverInput = state.serverInput,
                        onServerChange = vm::updateServerInput,
                        onConnect = vm::connectServer,
                    )

                    CompanionStep.Login -> LoginStep(
                        serverUrl = state.serverUrl,
                        username = state.loginUsername,
                        password = state.loginPassword,
                        onUsernameChange = vm::updateLoginUsername,
                        onPasswordChange = vm::updateLoginPassword,
                        onSignIn = vm::signIn,
                        onChangeServer = vm::changeServer,
                    )

                    CompanionStep.Library -> LibraryStep(
                        state = state,
                        hasMediaPermission = hasMediaPermission,
                        onRequestPermission = { permissionLauncher.launch(permissions) },
                        onScan = vm::scanAndCheck,
                        onUpload = vm::uploadSelected,
                        onChangeServer = vm::changeServer,
                        onSelectAllNew = vm::selectAllNew,
                        onClearSelection = vm::clearSelection,
                        onToggle = vm::toggleSelected,
                        onPreview = vm::openPreview,
                        wifiOnly = state.wifiOnly,
                        onWifiOnlyChange = vm::updateWifiOnly,
                    )
                }

                StatusFooter(state)
            }
        }
    }
}

@Composable
private fun ServerStep(
    serverInput: String,
    onServerChange: (String) -> Unit,
    onConnect: () -> Unit,
) {
    AuthCard(title = "Connect to your server", subtitle = "Self-hosted Drone Media URL") {
        OutlinedTextField(
            value = serverInput,
            onValueChange = onServerChange,
            label = { Text("Server address") },
            placeholder = { Text("drone.example.com") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        Button(onClick = onConnect, modifier = Modifier.fillMaxWidth()) {
            Text("Connect")
        }
    }
}

@Composable
private fun LoginStep(
    serverUrl: String,
    username: String,
    password: String,
    onUsernameChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSignIn: () -> Unit,
    onChangeServer: () -> Unit,
) {
    AuthCard(title = "Sign in", subtitle = serverUrl) {
        OutlinedTextField(
            value = username,
            onValueChange = onUsernameChange,
            label = { Text("Username or email") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = password,
            onValueChange = onPasswordChange,
            label = { Text("Password") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )
        Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) {
            Text("Sign in")
        }
        TextButton(onClick = onChangeServer) {
            Text("Use a different server")
        }
    }
}

@Composable
private fun LibraryStep(
    state: CompanionUiState,
    hasMediaPermission: Boolean,
    onRequestPermission: () -> Unit,
    onScan: () -> Unit,
    onUpload: () -> Unit,
    onChangeServer: () -> Unit,
    onSelectAllNew: () -> Unit,
    onClearSelection: () -> Unit,
    onToggle: (Long) -> Unit,
    onPreview: (com.asbservers.dronemediacompanion.data.LocalMediaItem) -> Unit,
    wifiOnly: Boolean,
    onWifiOnlyChange: (Boolean) -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.signedInUsername?.let { user ->
                Text("Signed in as $user", style = MaterialTheme.typography.titleSmall)
                Text(
                    state.serverUrl,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Wi‑Fi only uploads")
                Switch(checked = wifiOnly, onCheckedChange = onWifiOnlyChange)
            }
        }
    }

    if (!hasMediaPermission) {
        Text(
            "Allow photo & video access to scan DCIM/DJI Album.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FilledTonalButton(
            onClick = { if (!hasMediaPermission) onRequestPermission() else onScan() },
            enabled = !state.uploading,
            modifier = Modifier.weight(1f),
        ) {
            Icon(Icons.Default.Refresh, contentDescription = null)
            Text(" Scan", modifier = Modifier.padding(start = 4.dp))
        }
        Button(
            onClick = onUpload,
            enabled = !state.uploading && state.rows.any { it.selected },
            modifier = Modifier.weight(1f),
        ) {
            Icon(Icons.Default.CloudUpload, contentDescription = null)
            Text(" Upload", modifier = Modifier.padding(start = 4.dp))
        }
    }

    if (state.rows.isNotEmpty()) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onSelectAllNew) { Text("Select new") }
            TextButton(onClick = onClearSelection) { Text("Clear") }
            TextButton(onClick = onChangeServer) { Text("Change server") }
        }
        Text(
            "Tap a thumbnail to preview before upload.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    if (state.rows.isEmpty() && state.busyMessage == null && state.error == null) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
        ) {
            Text(
                modifier = Modifier.padding(16.dp),
                text = "Scan DJI Album after Quick Transfer to see clips here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    LazyColumn(
        modifier = Modifier.weight(1f),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(state.rows, key = { "${it.item.id}-${it.item.displayName}" }) { row ->
            MediaListItem(
                row = row,
                uploading = state.uploading,
                onToggle = { onToggle(row.item.id) },
                onPreview = { onPreview(row.item) },
                formatBytes = ::formatBytes,
                statusLabel = LibraryStatus::label,
            )
        }
    }
}

@Composable
private fun AuthCard(
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, style = MaterialTheme.typography.headlineSmall)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            content()
        }
    }
}

@Composable
private fun StatusFooter(state: CompanionUiState) {
    state.connectionMessage?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
    }
    state.busyMessage?.let {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall)
        }
    }
    state.error?.let {
        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }
    if (state.uploading) {
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    }
    Spacer(modifier = Modifier.height(4.dp))
}

private fun LibraryStatus.label(): String = when (this) {
    LibraryStatus.Unknown -> "Unknown"
    LibraryStatus.Hashing -> "Hashing…"
    LibraryStatus.New -> "New"
    LibraryStatus.InLibrary -> "In library"
    LibraryStatus.SoftMatch -> "Possible duplicate"
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    var v = bytes.toDouble()
    var u = 0
    while (v >= 1024 && u < units.lastIndex) {
        v /= 1024
        u++
    }
    return if (u == 0) "${bytes} B" else String.format("%.1f %s", v, units[u])
}
