package app.getopencode.composer

import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.text.StaticLayout
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.Gravity
import androidx.appcompat.widget.AppCompatEditText
import androidx.core.view.inputmethod.InputConnectionCompat
import androidx.core.view.inputmethod.InputContentInfoCompat
import expo.modules.kotlin.viewevent.EventDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A multiline text input that also accepts images from the Android soft keyboard.
 *
 * The Android InputMethodService commits images (GIFs/stickers from the keyboard's
 * image panel) through [InputConnectionCompat]. React Native's `ReactEditText` does
 * not register `contentMimeTypes` nor wrap its input connection, so keyboards show
 * "this field does not support images". This view declares the supported image MIME
 * types and forwards committed images to JS through the `onImageInsert` event, where
 * they enter the same attachment preview/send flow as gallery and document picks.
 */
class ImageKeyboardEditText(context: Context) : AppCompatEditText(context) {
  private val onImageInsert by EventDispatcher<ImageInsertEvent>()
  private val onChangeText by EventDispatcher<TextChangeEvent>()
  private val onContentSizeChange by EventDispatcher<ContentSizeEvent>()

  /** When true, advertise image MIME types to the IME so its image panel can insert. */
  var supportsImageInsertion: Boolean = false

  private var isSettingTextFromJS = false
  private val imageScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var lastContentWidth = -1f
  private var lastContentHeight = -1f

  private val watcher = object : TextWatcher {
    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
      if (!isSettingTextFromJS) {
        onChangeText(TextChangeEvent(s?.toString() ?: ""))
        notifyContentSizeChange()
      }
    }

    override fun afterTextChanged(s: Editable?) = Unit
  }

  init {
    setBackgroundColor(Color.TRANSPARENT)
    minimumHeight = 0
    minimumWidth = 0
    minHeight = 0
    minWidth = 0
    setPadding(0, 0, 0, 0)
    gravity = Gravity.TOP or Gravity.START
    addTextChangedListener(watcher)
    isSingleLine = false
  }

  fun setValue(value: String) {
    if (text?.toString() == value) return
    isSettingTextFromJS = true
    setText(value)
    isSettingTextFromJS = false
    notifyContentSizeChange()
  }

  fun setMultiline(multiline: Boolean) {
    if (multiline) {
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
      setHorizontallyScrolling(false)
    } else {
      inputType = InputType.TYPE_CLASS_TEXT
      setHorizontallyScrolling(true)
    }
  }

  fun setFontSizeValue(size: Float) {
    setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, size)
    post { notifyContentSizeChange() }
  }

  fun setColorValue(color: String) {
    try {
      setTextColor(android.graphics.Color.parseColor(color))
    } catch (_: Throwable) {
      // Ignore unparsable colors; keep the inherited default.
    }
  }

  fun setEditableValue(editable: Boolean) {
    isEnabled = editable
    isFocusable = editable
    isFocusableInTouchMode = editable
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    notifyContentSizeChange()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    notifyContentSizeChange()
  }

  override fun onDetachedFromWindow() {
    imageScope.coroutineContext.cancelChildren()
    super.onDetachedFromWindow()
  }

  private fun notifyContentSizeChange() {
    val availableWidth = width - compoundPaddingLeft - compoundPaddingRight
    // TextWatcher runs before TextView rebuilds its layout. Measure independently
    // so wrapping/deletion updates even when React Native fixes the view height.
    val contentHeight = if (availableWidth > 0) {
      val value = text?.toString().orEmpty()
      StaticLayout.Builder.obtain(value, 0, value.length, paint, availableWidth)
        .setIncludePad(includeFontPadding)
        .setLineSpacing(lineSpacingExtra, lineSpacingMultiplier)
        .setBreakStrategy(breakStrategy)
        .setHyphenationFrequency(hyphenationFrequency)
        .build().height + compoundPaddingTop + compoundPaddingBottom
    } else {
      lineHeight + compoundPaddingTop + compoundPaddingBottom
    }
    val density = resources.displayMetrics.density
    val logicalWidth = width / density
    val logicalHeight = contentHeight / density
    if (logicalWidth == lastContentWidth && logicalHeight == lastContentHeight) return
    lastContentWidth = logicalWidth
    lastContentHeight = logicalHeight
    onContentSizeChange(ContentSizeEvent(logicalWidth, logicalHeight))
  }
  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
    var connection = super.onCreateInputConnection(outAttrs)
    if (supportsImageInsertion && connection != null) {
      outAttrs.contentMimeTypes = IMAGE_MIME_TYPES
      connection = InputConnectionCompat.createWrapper(connection, outAttrs, object : InputConnectionCompat.OnCommitContentListener {
        override fun onCommitContent(inputContentInfo: InputContentInfoCompat, flags: Int, opts: Bundle?): Boolean {
          val needsPermission = flags and InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION != 0
          var permissionGranted = false
          return try {
            if (needsPermission) {
              inputContentInfo.requestPermission()
              permissionGranted = true
            }
            val uri = inputContentInfo.contentUri
            val mimeType = context.contentResolver.getType(uri) ?: "image/*"
            imageScope.launch {
              try {
                val (cachedUri, _) = withContext(Dispatchers.IO) { ComposerImageCache.copy(context, uri) }
                onImageInsert(ImageInsertEvent(cachedUri.toString(), mimeType))
              } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
              } catch (error: Throwable) {
                onImageInsert(ImageInsertEvent("", mimeType, error.message ?: "Could not read the keyboard image."))
              } finally {
                if (permissionGranted) inputContentInfo.releasePermission()
              }
            }
            true
          } catch (_: Throwable) {
            if (permissionGranted) inputContentInfo.releasePermission()
            false
          }
        }
      })
    }
    return connection
  }

  companion object {
    private val IMAGE_MIME_TYPES = arrayOf("image/gif", "image/png", "image/jpeg", "image/webp")
  }
}
