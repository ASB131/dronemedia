package com.asbservers.dronemediacompanion.data

import net.jpountz.xxhash.XXHashFactory
import java.io.FileInputStream
import java.io.InputStream
import java.nio.file.Path
import java.util.Locale

object XxHash64 {
    private const val CHUNK = 1024 * 1024

    /** Matches Drone Media web xxhashjs h64(0) over the full file. */
    fun hashFile(path: Path): String {
        FileInputStream(path.toFile()).use { stream -> hashInputStream(stream) }
    }

    fun hashInputStream(stream: InputStream): String {
        val factory = XXHashFactory.fastestInstance()
        val digest = factory.newStreamingHash64(0)
        val buffer = ByteArray(CHUNK)
        while (true) {
            val read = stream.read(buffer)
            if (read <= 0) break
            digest.update(buffer, 0, read)
        }
        return formatDigest(digest.value)
    }

    private fun formatDigest(value: Long): String {
        return java.lang.Long.toUnsignedString(value, 16)
            .padStart(16, '0')
            .lowercase(Locale.US)
    }
}
