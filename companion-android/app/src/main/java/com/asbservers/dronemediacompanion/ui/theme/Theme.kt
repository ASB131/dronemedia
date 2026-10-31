package com.asbservers.dronemediacompanion.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DmPrimary = Color(0xFF4250AF)
private val DmPrimaryDark = Color(0xFF9BA8FF)
private val DmSurfaceDark = Color(0xFF12141C)
private val DmSurfaceContainerDark = Color(0xFF1E2230)

private val DarkColors = darkColorScheme(
    primary = DmPrimaryDark,
    onPrimary = Color(0xFF0E1542),
    primaryContainer = Color(0xFF2A3370),
    onPrimaryContainer = Color(0xFFE0E4FF),
    secondary = Color(0xFF7EB6FF),
    background = DmSurfaceDark,
    surface = DmSurfaceDark,
    surfaceContainer = DmSurfaceContainerDark,
    surfaceContainerHigh = Color(0xFF282D3D),
    onBackground = Color(0xFFE8EAF2),
    onSurface = Color(0xFFE8EAF2),
    onSurfaceVariant = Color(0xFFB8BECD),
    outline = Color(0xFF454B5E),
    error = Color(0xFFFF8A80),
)

private val LightColors = lightColorScheme(
    primary = DmPrimary,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0E4FF),
    onPrimaryContainer = Color(0xFF12184A),
    secondary = Color(0xFF3566A8),
    background = Color(0xFFF6F6F8),
    surface = Color.White,
    surfaceContainer = Color(0xFFEEEFF4),
    surfaceContainerHigh = Color(0xFFE4E6EE),
)

@Composable
fun DroneMediaTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        content = content,
    )
}
