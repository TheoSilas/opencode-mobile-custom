package app.getopencode.activity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.Promise

class ActivityService : HeadlessJsTaskService() {
  @Volatile private var content: ActivityContent? = null
  private var headlessStarted = false
  private val waiters = mutableListOf<Promise>()

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val next = pending ?: return START_NOT_STICKY.also { if (content == null) stopSelf() }
    pending = null
    if (next.key == dismissedKey) return START_NOT_STICKY.also { stopSelf() }
    content = next
    val notification = notification(this, next)
    try {
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(ID, notification)
      }
    } catch (_: IllegalStateException) {
      pause(next)
      return START_NOT_STICKY
    } catch (_: SecurityException) {
      pause(next)
      return START_NOT_STICKY
    }
    if (!headlessStarted) {
      headlessStarted = true
      startTask(HeadlessJsTaskConfig("opencode-activity-keepalive", Arguments.createMap(), 0, true))
    }
    return START_NOT_STICKY
  }

  private fun finish(remove: Boolean) {
    stopForeground(if (remove) STOP_FOREGROUND_REMOVE else STOP_FOREGROUND_DETACH)
    content = null
    headlessStarted = false
    waiters.toList().forEach { it.resolve() }
    waiters.clear()
    stopSelf()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    content?.let { pause(it) } ?: finish(true)
  }

  private fun pause(next: ActivityContent) {
    pausedKey = next.key
    next.active = false
    next.body = next.pausedLabel
    finish(false)
    if (NotificationManagerCompat.from(this).areNotificationsEnabled()) manager(this).notify(ID, notification(this, next))
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    content?.let { dismissedKey = it.key }
    finish(true)
  }

  // An older keepalive finishing must not stop a newly started notification cycle.
  override fun onHeadlessJsTaskFinish(taskId: Int) = Unit

  override fun onDestroy() {
    if (instance === this) instance = null
    waiters.toList().forEach { it.resolve() }
    waiters.clear()
    super.onDestroy()
  }

  companion object {
    private const val ID = 19605
    private const val CHANNEL = "opencode-activity"
    @Volatile private var instance: ActivityService? = null
    @Volatile private var pending: ActivityContent? = null
    @Volatile private var dismissedKey: String? = null
    private var pausedKey: String? = null
    @Volatile private var lastKey: String? = null

    private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)

    private fun notification(context: Context, content: ActivityContent): Notification {
      if (Build.VERSION.SDK_INT >= 26) {
        manager(context).createNotificationChannel(NotificationChannel(CHANNEL, content.channelLabel, NotificationManager.IMPORTANCE_LOW).apply {
          setSound(null, null)
          enableVibration(false)
        })
      }
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(content.link)).setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val dismiss = Intent(context, ActivityDismissReceiver::class.java).putExtra("key", content.key)
      val deleteIntent = PendingIntent.getBroadcast(context, ID, dismiss, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val builder = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_opencode_activity)
        .setContentTitle(content.title)
        .setContentText(content.body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(content.body))
        .setContentIntent(PendingIntent.getActivity(context, ID, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .setDeleteIntent(deleteIntent)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setOngoing(content.active)
        .setAutoCancel(!content.active)
        .setRequestPromotedOngoing(content.active)
        .setShortCriticalText(if (content.active) content.chip else null)
      if (content.active) builder.addAction(0, content.stopLabel, deleteIntent)
      return builder.build()
    }

    fun update(context: Context, content: ActivityContent, foreground: Boolean): Boolean {
      if (content.key == dismissedKey || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
      if (content.key == pausedKey) {
        if (!foreground) return false
        pausedKey = null
      }
      val running = instance
      lastKey = content.key
      if (!content.active) {
        pending = null
        running?.finish(false)
        manager(context).notify(ID, notification(context, content))
      } else if (running != null && running.headlessStarted) {
        running.content = content
        manager(context).notify(ID, notification(context, content))
      } else {
        // Starting from a visible activity avoids Android's background-start restriction.
        if (!foreground) return false
        pending = content
        try {
          ContextCompat.startForegroundService(context, Intent(context, ActivityService::class.java))
        } catch (_: IllegalStateException) {
          pending = null
          return false
        } catch (_: SecurityException) {
          pending = null
          return false
        }
      }
      return true
    }

    fun dismiss(context: Context, key: String?) {
      if (key == null || key != lastKey) return
      dismissedKey = key
      if (instance?.content?.key == key || pending?.key == key) {
        pending = null
        instance?.finish(true)
      }
      manager(context).cancel(ID)
    }

    fun stop(context: Context) {
      pending = null
      instance?.finish(true)
      manager(context).cancel(ID)
    }

    fun waitUntilStopped(promise: Promise) {
      val running = instance
      if (running?.content == null) promise.resolve() else running.waiters.add(promise)
    }

    fun suppressesCompletion() = instance?.content != null || pending != null || (lastKey != null && lastKey == dismissedKey)
  }
}

class ActivityDismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    ActivityService.dismiss(context, intent.getStringExtra("key"))
  }
}
