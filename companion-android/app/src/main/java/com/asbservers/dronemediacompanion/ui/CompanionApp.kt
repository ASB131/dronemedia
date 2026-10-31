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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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

    MaterialTheme {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Drone Media Companion") },
                    actions = {
                        if (state.step == CompanionStep.Library) {
                            TextButton(onClick = vm::signOut) { Text("Sign out") }
                        }
                    },
                )
            },
        ) { padding ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .padding(16.dp)
                    .fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                when (state.step) {
                    CompanionStep.Server -> {
                        Text(
                            "Enter the address of your Drone Media site.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        OutlinedTextField(
                            value = state.serverInput,
                            onValueChange = vm::updateServerInput,
                            label = { Text("Server") },
                            placeholder = { Text("drone.example.com") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        )
                        Button(onClick = vm::connectServer, modifier = Modifier.fillMaxWidth()) {
                            Text("Connect")
                        }
                    }

                    CompanionStep.Login -> {
                        Text(
                            "Sign in with the same account you use in the browser.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (state.serverUrl.isNotBlank()) {
                            Text(
                                state.serverUrl,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        OutlinedTextField(
                            value = state.loginUsername,
                            onValueChange = vm::updateLoginUsername,
                            label = { Text("Username or email") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                        )
                        OutlinedTextField(
                            value = state.loginPassword,
                            onValueChange = vm::updateLoginPassword,
                            label = { Text("Password") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                        )
                        Button(onClick = vm::signIn, modifier = Modifier.fillMaxWidth()) {
                            Text("Sign in")
                        }
                        TextButton(onClick = vm::changeServer) {
                            Text("Use a different server")
                        }
                    }

                    CompanionStep.Library -> {
                        state.signedInUsername?.let { user ->
                            Text("Signed in as $user · ${state.serverUrl}")
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Wi‑Fi only uploads")
                            Switch(checked = state.wifiOnly, onCheckedChange = vm::updateWifiOnly)
                        }
                        if (!hasMediaPermission) {
                            Text(
                                "Photo and video access is required to read DCIM/DJI Album.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = {
                                    if (!hasMediaPermission) {
                                        permissionLauncher.launch(permissions)
                                    } else {
                                        vm.scanAndCheck()
                                    }
                                },
                                enabled = !state.uploading,
                            ) { Text("Scan DJI Album") }
                            Button(
                                onClick = vm::uploadSelected,
                                enabled = !state.uploading && state.rows.any { it.selected },
                            ) { Text("Upload") }
                        }
                        TextButton(onClick = vm::changeServer) {
                            Text("Change server")
                        }
                        if (state.rows.isEmpty() && state.busyMessage == null && state.error == null) {
                            Text(
                                "Tap Scan to list clips from DCIM/DJI Album.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        LazyColumn(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(state.rows, key = { it.item.id }) { row ->
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Checkbox(
                                        checked = row.selected,
                                        onCheckedChange = { vm.toggleSelected(row.item.id) },
                                        enabled = row.status == LibraryStatus.New && !state.uploading,
                                    )
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(row.item.displayName)
                                        Text(
                                            "${row.status.label()} · ${formatBytes(row.item.sizeBytes)}",
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                        if (row.uploadProgress > 0f && row.uploadProgress < 1f) {
                                            LinearProgressIndicator(
                                                progress = { row.uploadProgress },
                                                modifier = Modifier.fillMaxWidth(),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                state.connectionMessage?.let { Text(it) }
                state.busyMessage?.let {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                        Text(it)
                    }
                }
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (state.uploading) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
                Spacer(modifier = Modifier.height(4.dp))
            }
        }
    }
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
