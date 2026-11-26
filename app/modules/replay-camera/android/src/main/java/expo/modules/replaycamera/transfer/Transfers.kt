package expo.modules.replaycamera.transfer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import java.util.Locale

/**
 * The process-wide uploader and downloader (the iPhone's `BackgroundUploader.shared` and `BackgroundDownloader.shared`).
 * The transfers run in this process; `TransferWorker` keeps the process going while they do, so they go on with the
 * app in the background and start again after the app was swiped away (WorkManager starts the process again).
 */
object Transfers {
  private const val PREFS = "reprize.transfers"
  @Volatile private var hub: Pair<TransferEngine, TransferEngine>? = null
  @Volatile internal var workerActive = false
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  private class PrefsStore(context: Context, private val key: String) : TransferEngine.MemoryStore() {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    override var text: String
      get() = prefs.getString(key, "{}") ?: "{}"
      set(value) { prefs.edit().putString(key, value).commit() }
  }

  private fun engines(context: Context): Pair<TransferEngine, TransferEngine> {
    hub?.let { return it }
    synchronized(this) {
      hub?.let { return it }
      val app = context.applicationContext
      val transport = HttpTransport()
      val metered = { (app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered }
      val keeper = object : TransferEngine.Keeper {
        override fun keepAlive() = TransferWorker.keepAlive(app)
        override fun waitForWifi() = TransferWorker.waitForWifi(app)
      }
      val now = { System.currentTimeMillis().toDouble() }
      val made = TransferEngine(TransferEngine.Kind.UPLOAD, PrefsStore(app, "uploads.v1"), transport, metered, keeper, scope, now) to
        TransferEngine(TransferEngine.Kind.DOWNLOAD, PrefsStore(app, "downloads.v1"), transport, metered, keeper, scope, now)
      hub = made
      return made
    }
  }

  fun uploads(context: Context) = engines(context).first
  fun downloads(context: Context) = engines(context).second
}

/**
 * Keeps the process alive (in the foreground, with a quiet notification, as Android asks of long transfers) while the
 * uploads and downloads run, and starts them again when the process comes back after the app was swiped away.
 */
class TransferWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  companion object {
    private const val WORK = "reprize.transfers"
    private const val WIFI_WORK = "reprize.transfers.wifi"
    private const val CHANNEL = "reprize_transfers"
    private const val NOTIFICATION_ID = 4107

    fun keepAlive(context: Context) {
      if (Transfers.workerActive) return
      Transfers.workerActive = true
      enqueue(context, WORK, NetworkType.CONNECTED)
    }

    fun waitForWifi(context: Context) = enqueue(context, WIFI_WORK, NetworkType.UNMETERED)

    private fun enqueue(context: Context, name: String, network: NetworkType) {
      val request = OneTimeWorkRequestBuilder<TransferWorker>()
        .setConstraints(Constraints.Builder().setRequiredNetworkType(network).build())
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork(name, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
  }

  override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo()

  override suspend fun doWork(): Result {
    Transfers.workerActive = true
    try {
      setForeground(foregroundInfo())
    } catch (e: Exception) {
      // Not allowed to show a foreground notification now (Android 12+ from the background): run without it.
    }
    val uploads = Transfers.uploads(applicationContext)
    val downloads = Transfers.downloads(applicationContext)
    uploads.restore()
    downloads.restore()
    while (true) {
      while (!(uploads.idle() && downloads.idle())) delay(1000)
      Transfers.workerActive = false
      // A file queued just as the work ran out still gets a worker: look once more before leaving.
      if (uploads.idle() && downloads.idle()) break
      Transfers.workerActive = true
    }
    return Result.success()
  }

  private fun foregroundInfo(): ForegroundInfo {
    val context = applicationContext
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val pt = Locale.getDefault().language == "pt"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, if (pt) "Envio de clipes" else "Clip transfers", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val notification: Notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(if (pt) "Reprize: enviando clipes" else "Reprize: transferring clips")
      .setOngoing(true)
      .setSilent(true)
      .build()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(NOTIFICATION_ID, notification)
    }
  }
}
