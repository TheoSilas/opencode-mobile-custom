package app.getopencode.activity

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.functions.Queues

class ActivityContent : Record {
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var link: String = ""
  @Field var chip: String = ""
  @Field var stopLabel: String = ""
  @Field var channelLabel: String = ""
  @Field var pausedLabel: String = ""
  @Field var key: String = ""
  @Field var active: Boolean = false
}

class OpencodeActivityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpencodeActivity")
    Function("suppressesCompletion") { ActivityService.suppressesCompletion() }
    AsyncFunction("update") { content: ActivityContent ->
      require(content.title.isNotBlank() && content.key.isNotBlank())
      require(content.link.startsWith("opencodemobile://session/"))
      val context = requireNotNull(appContext.runtime.reactContext)
      ActivityService.update(context, content, context.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") {
      appContext.reactContext?.let { ActivityService.stop(it) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("waitUntilStopped") { promise: expo.modules.kotlin.Promise ->
      ActivityService.waitUntilStopped(promise)
    }.runOnQueue(Queues.MAIN)
  }
}
