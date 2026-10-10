package app.getopencode.composer

import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PickedImage : Record {
  @Field var uri: String = ""
  @Field var mimeType: String = ""
  @Field var name: String = ""
  @Field var size: Long = 0
}

@OptimizedRecord
data class ImageInsertEvent(@Field val uri: String, @Field val mimeType: String) : Record

@OptimizedRecord
data class TextChangeEvent(@Field val text: String) : Record

@OptimizedRecord
data class ContentSizeEvent(@Field val width: Int, @Field val height: Int) : Record

class OpencodeComposerModule : Module() {
  private lateinit var imageLibraryLauncher: AppContextActivityResultLauncher<ImageLibraryInput, List<PickedImage>>

  override fun definition() = ModuleDefinition {
    Name("OpencodeComposer")

    AsyncFunction("pickImages") Coroutine { multiple: Boolean ->
      withContext(Dispatchers.IO) {
        imageLibraryLauncher.launch(ImageLibraryInput(multiple))
      }
    }

    View(ImageKeyboardEditText::class) {
      Events("onImageInsert", "onChangeText", "onContentSizeChange")
      Prop("supportsImageInsertion") { view: ImageKeyboardEditText, value: Boolean -> view.supportsImageInsertion = value }
      Prop("value") { view: ImageKeyboardEditText, value: String -> view.setValue(value) }
      Prop("placeholder") { view: ImageKeyboardEditText, value: String -> view.hint = value }
      Prop("multiline") { view: ImageKeyboardEditText, value: Boolean -> view.setMultiline(value) }
      Prop("editable") { view: ImageKeyboardEditText, value: Boolean -> view.setEditableValue(value) }
      Prop("fontSize") { view: ImageKeyboardEditText, value: Float -> view.setFontSizeValue(value) }
      Prop("textColor") { view: ImageKeyboardEditText, value: String -> view.setColorValue(value) }
    }

    RegisterActivityContracts {
      imageLibraryLauncher = registerForActivityResult(
        ComposerImageLibraryContract(this@OpencodeComposerModule)
      )
    }
  }
}
