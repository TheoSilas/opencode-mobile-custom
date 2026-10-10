package app.getopencode.composer

import android.content.Context
import android.graphics.Rect
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.appcompat.widget.AppCompatEditText
import androidx.core.view.inputmethod.InputConnectionCompat
import androidx.core.view.inputmethod.InputContentInfoCompat
import expo.modules.kotlin.viewevent.EventDispatcher

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
  private val onImageInsert by EventDispatcher<Map<String, Any>>()
  private val onChangeText by EventDispatcher<Map<String, Any>>()
  private val onContentSizeChange by EventDispatcher<Map<String, Any>>()

  /** When true, advertise image MIME types to the IME so its image panel can insert. */
  var supportsImageInsertion: Boolean = false

  private var isSettingTextFromJS = false

  private val watcher = object : TextWatcher {
    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
      if (!isSettingTextFromJS) {
        onChangeText(mapOf("text" to (s?.toString() ?: "")))
        notifyContentSizeChange()
      }
    }

    override fun afterTextChanged(s: Editable?) = Unit
  }

  init {
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

  override fun onFocusChanged(focused: Boolean, direction: Int, previouslyFocusedRect: Rect?) {
    super.onFocusChanged(focused, direction, previouslyFocusedRect)
    if (focused) {
      setSelection(text?.length ?: 0)
    }
  }

  private fun notifyContentSizeChange() {
    val lineHeight = lineHeight.takeIf { it > 0 } ?: textSize.toInt()
    val contentHeight = (lineCount.takeIf { it > 0 } ?: 1) * lineHeight + compoundPaddingTop + compoundPaddingBottom
    onContentSizeChange(mapOf("width" to width, "height" to contentHeight))
  }
  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
    var connection = super.onCreateInputConnection(outAttrs)
    if (supportsImageInsertion && connection != null) {
      outAttrs.contentMimeTypes = IMAGE_MIME_TYPES
      connection = InputConnectionCompat.createWrapper(connection, outAttrs, object : InputConnectionCompat.OnCommitContentListener {
        override fun onCommitContent(inputContentInfo: InputContentInfoCompat, flags: Int, opts: Bundle?): Boolean {
          return try {
            inputContentInfo.requestPermission()
            val uri = inputContentInfo.contentUri
            val mimeType = context.contentResolver.getType(uri) ?: "image/*"
            onImageInsert(mapOf("uri" to uri.toString(), "mimeType" to mimeType))
            true
          } catch (_: Throwable) {
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
