package app.getopencode.composer

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.IOException
import java.util.UUID

/** Capture provider bytes while the picker/IME's temporary grant is still valid. */
internal object ComposerImageCache {
  private const val MAX_BYTES = 10L * 1024 * 1024

  fun copy(context: Context, uri: Uri): Pair<Uri, Long> {
    val directory = File(context.cacheDir, "composer-images").apply { mkdirs() }
    val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
    directory.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
    val target = File(directory, UUID.randomUUID().toString())
    try {
      var size = 0L
      val input = context.contentResolver.openInputStream(uri)
        ?: throw IOException("Could not open the selected image.")
      input.use { source ->
        target.outputStream().use { output ->
          val buffer = ByteArray(8192)
          while (true) {
            val count = source.read(buffer)
            if (count < 0) break
            size += count
            if (size > MAX_BYTES) throw IOException("File exceeds the 10 MB attachment limit.")
            output.write(buffer, 0, count)
          }
        }
      }
      return Uri.fromFile(target) to size
    } catch (error: Throwable) {
      target.delete()
      throw error
    }
  }
}
