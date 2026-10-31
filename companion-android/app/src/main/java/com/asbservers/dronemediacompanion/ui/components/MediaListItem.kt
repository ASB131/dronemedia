package com.asbservers.dronemediacompanion.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.asbservers.dronemediacompanion.data.MediaKind
import com.asbservers.dronemediacompanion.data.isPreviewableMedia
import com.asbservers.dronemediacompanion.data.mediaKindForFilename
import com.asbservers.dronemediacompanion.ui.LibraryStatus
import com.asbservers.dronemediacompanion.ui.MediaRow

@Composable
fun MediaListItem(
    row: MediaRow,
    uploading: Boolean,
    onToggle: () -> Unit,
    onPreview: () -> Unit,
    formatBytes: (Long) -> String,
    statusLabel: (LibraryStatus) -> String,
) {
    val kind = mediaKindForFilename(row.item.displayName)
    val canPreview = isPreviewableMedia(row.item.displayName)
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        ),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = row.selected,
                onCheckedChange = { onToggle() },
                enabled = row.status == LibraryStatus.New && !uploading,
            )
            MediaThumbnail(
                kind = kind,
                uri = row.item.contentUri,
                displayName = row.item.displayName,
                canPreview = canPreview,
                onPreview = onPreview,
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 8.dp),
            ) {
                Text(
                    row.item.displayName,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${formatBytes(row.item.sizeBytes)} · ${statusLabel(row.status)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                StatusChip(row.status)
                if (row.uploadProgress > 0f && row.uploadProgress < 1f) {
                    LinearProgressIndicator(
                        progress = { row.uploadProgress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 6.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun MediaThumbnail(
    kind: MediaKind,
    uri: android.net.Uri,
    displayName: String,
    canPreview: Boolean,
    onPreview: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(72.dp)
            .clip(RoundedCornerShape(8.dp))
            .then(if (canPreview) Modifier.clickable(onClick = onPreview) else Modifier),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
        ) {
            when (kind) {
                MediaKind.Photo, MediaKind.Video -> {
                    AsyncImage(
                        model = uri,
                        contentDescription = displayName,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                }
                else -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.Description,
                            contentDescription = null,
                            modifier = Modifier.size(28.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        if (kind == MediaKind.Video) {
            Icon(
                Icons.Default.PlayCircle,
                contentDescription = "Preview video",
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(32.dp),
                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.95f),
            )
        }
    }
}

@Composable
private fun StatusChip(status: LibraryStatus) {
    val (label, container, content) = when (status) {
        LibraryStatus.New -> Triple(
            "New",
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
        )
        LibraryStatus.InLibrary -> Triple(
            "In library",
            MaterialTheme.colorScheme.surfaceContainerHighest,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
        LibraryStatus.SoftMatch -> Triple(
            "Possible duplicate",
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer,
        )
        LibraryStatus.Hashing -> Triple(
            "Checking…",
            MaterialTheme.colorScheme.secondaryContainer,
            MaterialTheme.colorScheme.onSecondaryContainer,
        )
        LibraryStatus.Unknown -> Triple(
            "Pending",
            MaterialTheme.colorScheme.surfaceContainer,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    Surface(
        modifier = Modifier.padding(top = 4.dp),
        shape = RoundedCornerShape(6.dp),
        color = container,
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = content,
        )
    }
}
