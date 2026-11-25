package expo.modules.replaycamera.transfer

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext

/**
 * The transfers over plain HttpURLConnection: one PUT of the whole file (a presigned R2 URL), or one GET into a file.
 * Cancelling the coroutine closes the connection at once, so pause and remove stop a transfer mid-file.
 */
class HttpTransport : TransferEngine.Transport {
  private companion object {
    const val BUFFER = 64 * 1024
    const val CONNECT_TIMEOUT = 30_000
    const val READ_TIMEOUT = 60_000
  }

  override suspend fun upload(path: String, url: String, contentType: String, onProgress: (Long, Long) -> Unit): Int =
    withContext(Dispatchers.IO) {
      val file = File(path)
      require(file.exists()) { "missing file" }
      val total = file.length()
      val conn = URL(url).openConnection() as HttpURLConnection
      val closer = coroutineContext[Job]?.invokeOnCompletion { conn.disconnect() }
      try {
        conn.requestMethod = "PUT"
        conn.doOutput = true
        conn.connectTimeout = CONNECT_TIMEOUT
        conn.readTimeout = READ_TIMEOUT
        conn.setRequestProperty("Content-Type", contentType)
        conn.setFixedLengthStreamingMode(total)
        var sent = 0L
        file.inputStream().use { input ->
          conn.outputStream.use { output ->
            val buffer = ByteArray(BUFFER)
            while (true) {
              coroutineContext.ensureActive()
              val n = input.read(buffer)
              if (n < 0) break
              output.write(buffer, 0, n)
              sent += n
              onProgress(sent, total)
            }
          }
        }
        conn.responseCode
      } finally {
        closer?.dispose()
        conn.disconnect()
      }
    }

  override suspend fun download(url: String, tempPath: String, onProgress: (Long, Long) -> Unit): Int =
    withContext(Dispatchers.IO) {
      val conn = URL(url).openConnection() as HttpURLConnection
      val closer = coroutineContext[Job]?.invokeOnCompletion { conn.disconnect() }
      try {
        conn.connectTimeout = CONNECT_TIMEOUT
        conn.readTimeout = READ_TIMEOUT
        val status = conn.responseCode
        if (status !in 200..299) return@withContext status
        val total = conn.contentLengthLong
        val target = File(tempPath)
        target.parentFile?.mkdirs()
        var received = 0L
        conn.inputStream.use { input ->
          target.outputStream().use { output ->
            val buffer = ByteArray(BUFFER)
            while (true) {
              coroutineContext.ensureActive()
              val n = input.read(buffer)
              if (n < 0) break
              output.write(buffer, 0, n)
              received += n
              onProgress(received, total)
            }
          }
        }
        status
      } finally {
        closer?.dispose()
        conn.disconnect()
      }
    }

  override fun size(path: String): Long = File(path).length()

  override fun move(from: String, to: String) {
    val source = File(from)
    val target = File(to)
    target.parentFile?.mkdirs()
    if (target.exists()) target.delete()
    if (!source.renameTo(target)) {
      source.copyTo(target, overwrite = true)
      source.delete()
    }
  }
}
