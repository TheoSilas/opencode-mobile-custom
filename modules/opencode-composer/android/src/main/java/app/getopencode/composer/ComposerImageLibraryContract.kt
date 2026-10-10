package app.getopencode.composer

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.providers.AppContextProvider
import java.io.Serializable

internal data class ImageLibraryInput(val multiple: Boolean) : Serializable

/**
 * Opens the system photo browser. When the Android Photo Picker is available it is
 * used (keeping multi-select); otherwise this falls back to `ACTION_PICK` against
 * `MediaStore.Images.Media.EXTERNAL_CONTENT_URI`, which opens the gallery app
 * directly instead of the DocumentsUI file manager that `ACTION_GET_CONTENT` opens.
 */
internal class ComposerImageLibraryContract(
  private val appContextProvider: AppContextProvider
) : AppContextActivityResultContract<ImageLibraryInput, List<PickedImage>> {
  private val contentResolver: ContentResolver?
    get() = appContextProvider.appContext.reactContext?.contentResolver

  override fun createIntent(context: Context, input: ImageLibraryInput): Intent {
    val request = PickVisualMediaRequest.Builder()
      .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly)
      .build()
    return if (ActivityResultContracts.PickVisualMedia.isPhotoPickerAvailable(context)) {
      if (input.multiple) {
        ActivityResultContracts.PickMultipleVisualMedia().createIntent(context, request)
      } else {
        ActivityResultContracts.PickVisualMedia().createIntent(context, request)
      }
    } else {
      Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
        if (input.multiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
    }
  }

  override fun parseResult(input: ImageLibraryInput, resultCode: Int, intent: Intent?): List<PickedImage> {
    if (resultCode != Activity.RESULT_OK || intent == null) return emptyList()
    val resolver = contentResolver
    return getAllUris(intent).map { uri ->
      var name = ""
      var size = 0L
      resolver?.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
          val sizeIndex = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
          if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: ""
          if (sizeIndex >= 0) size = cursor.getLong(sizeIndex)
        }
      }
      PickedImage().apply {
        this.uri = uri.toString()
        this.mimeType = resolver?.getType(uri) ?: "image/*"
        this.name = name
        this.size = size
      }
    }
  }

  private fun getAllUris(intent: Intent): List<Uri> {
    val uris = mutableListOf<Uri>()
    intent.data?.let { uris.add(it) }
    intent.clipData?.let { clip ->
      for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
    }
    return uris.distinct()
  }
}
