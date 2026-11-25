package expo.modules.replaycamera.transfer

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/** The engine behind the Android uploader and downloader, against a fake network (one controllable call per file). */
class TransferEngineTest {
  private class FakeTransport : TransferEngine.Transport {
    val calls = mutableListOf<String>()
    val pending = mutableMapOf<String, CompletableDeferred<Int>>()
    val moved = mutableListOf<Pair<String, String>>()
    var progress: ((Long, Long) -> Unit)? = null

    private suspend fun call(key: String, onProgress: (Long, Long) -> Unit): Int {
      calls += key
      progress = onProgress
      val result = CompletableDeferred<Int>()
      pending[key] = result
      return result.await()
    }

    override suspend fun upload(path: String, url: String, contentType: String, onProgress: (Long, Long) -> Unit) = call(url, onProgress)
    override suspend fun download(url: String, tempPath: String, onProgress: (Long, Long) -> Unit) = call(url, onProgress)
    override fun size(path: String): Long = 1000
    override fun move(from: String, to: String) { moved += from to to }

    fun answer(url: String, status: Int) = pending.remove(url)!!.complete(status)
    fun fail(url: String) = pending.remove(url)!!.completeExceptionally(IOException("network down"))
  }

  private class FakeKeeper : TransferEngine.Keeper {
    var alive = 0
    var wifi = 0
    override fun keepAlive() { alive++ }
    override fun waitForWifi() { wifi++ }
  }

  private val transport = FakeTransport()
  private val keeper = FakeKeeper()
  private var metered = false
  private val events = mutableListOf<Pair<String, Map<String, Any?>>>()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

  private fun engine(kind: TransferEngine.Kind = TransferEngine.Kind.UPLOAD) =
    TransferEngine(kind, TransferEngine.MemoryStore(), transport, { metered }, keeper, scope, { 1000.0 }).also {
      it.emit = { name, body -> events += name to body }
    }

  private fun up(n: Int, cellular: Boolean = true) =
    TransferEngine.Item(id = "s/clips/$n/video.mp4", path = "/f/$n.mp4", url = "u$n", contentType = "video/mp4", cellular = cellular, priority = -1.0)

  private fun statusOf(e: TransferEngine, id: String) = e.state().first { it["id"] == id }["status"]

  @Test fun startsFourAtATimeInTheClipsOrder() {
    val e = engine()
    e.start((6 downTo 1).map { up(it) }, paused = false)
    assertEquals(listOf("u1", "u2", "u3", "u4"), transport.calls)
    assertTrue(keeper.alive > 0)
  }

  @Test fun aFinishedFileReportsDoneAndTheNextOneStarts() {
    val e = engine()
    e.start((1..5).map { up(it) }, paused = false)
    transport.answer("u1", 200)
    assertEquals("done", statusOf(e, "s/clips/1/video.mp4"))
    val done = events.first { it.first == "onUploadDone" }.second
    assertEquals(true, done["ok"])
    assertEquals(1000.0, done["sent"])
    assertEquals("u5", transport.calls.last())
  }

  @Test fun progressIsReportedWithSentAndTotal() {
    val e = engine()
    e.start(listOf(up(1)), paused = false)
    transport.progress!!(400, 1000)
    val p = events.first { it.first == "onUploadProgress" }.second
    assertEquals(mapOf("id" to "s/clips/1/video.mp4", "sent" to 400.0, "total" to 1000.0), p)
  }

  @Test fun aNetworkErrorRetriesFromTheStartThenSucceeds() {
    val e = engine()
    e.start(listOf(up(1)), paused = false)
    transport.fail("u1")
    assertEquals("onUploadRetry", events.last().first)
    assertEquals(listOf("u1", "u1"), transport.calls)
    transport.answer("u1", 200)
    assertEquals("done", statusOf(e, "s/clips/1/video.mp4"))
  }

  @Test fun a403FailsAtOnce() {
    val e = engine()
    e.start(listOf(up(1)), paused = false)
    transport.answer("u1", 403)
    assertEquals("failed", statusOf(e, "s/clips/1/video.mp4"))
    assertEquals(false, events.last().second["ok"])
    assertEquals(1, transport.calls.size)
  }

  @Test fun givesUpAfterFiveAttempts() {
    val e = engine()
    e.start(listOf(up(1)), paused = false)
    repeat(5) { transport.answer("u1", 500) }
    assertEquals("failed", statusOf(e, "s/clips/1/video.mp4"))
    assertEquals(5, transport.calls.size)
  }

  @Test fun pauseStopsEverythingSilentlyAndResumeStartsAgainFromZero() {
    val e = engine()
    e.start(listOf(up(1), up(2)), paused = false)
    e.pause()
    assertEquals("paused", statusOf(e, "s/clips/1/video.mp4"))
    assertTrue(events.none { it.first == "onUploadDone" || it.first == "onUploadRetry" })
    e.resume(cellular = true)
    assertEquals(listOf("u1", "u2", "u1", "u2"), transport.calls)
    assertEquals(0.0, e.state().first { it["id"] == "s/clips/1/video.mp4" }["sent"])
  }

  @Test fun removeForgetsTheFileAndCancelsIt() {
    val e = engine()
    e.start(listOf(up(1), up(2)), paused = false)
    e.remove(listOf("s/clips/1/video.mp4"))
    assertEquals(listOf("s/clips/2/video.mp4"), e.state().map { it["id"] })
    assertTrue(events.none { it.first == "onUploadDone" })
  }

  @Test fun wifiOnlyFilesWaitOnMobileDataAndAskToBeWokenOnWifi() {
    metered = true
    val e = engine()
    e.start(listOf(up(1, cellular = false)), paused = false)
    assertTrue(transport.calls.isEmpty())
    assertEquals(1, keeper.wifi)
    metered = false
    e.restore()
    assertEquals(listOf("u1"), transport.calls)
  }

  @Test fun restoreStartsAgainWhatWasRunningWhenTheAppDied() {
    val store = TransferEngine.MemoryStore()
    TransferEngine(TransferEngine.Kind.UPLOAD, store, transport, { false }, keeper, scope, { 1.0 }).start(listOf(up(1)), paused = false)
    val relaunched = TransferEngine(TransferEngine.Kind.UPLOAD, store, transport, { false }, keeper, scope, { 2.0 })
    relaunched.restore()
    assertEquals(listOf("u1", "u1"), transport.calls)
  }

  @Test fun aDownloadIsWrittenAsidethenMovedIntoPlace() {
    val e = engine(TransferEngine.Kind.DOWNLOAD)
    e.start(listOf(TransferEngine.Item(id = "recv/s/1/video", path = "/r/1.mp4", url = "d1")), paused = false)
    transport.answer("d1", 200)
    assertEquals(listOf("/r/1.mp4.part" to "/r/1.mp4"), transport.moved)
    val done = events.first { it.first == "onDownloadDone" }.second
    assertEquals(true, done["ok"])
    assertEquals("/r/1.mp4", done["path"])
  }

  @Test fun downloadsQueuedPausedWaitForResume() {
    val e = engine(TransferEngine.Kind.DOWNLOAD)
    e.start(listOf(TransferEngine.Item(id = "recv/s/1/video", path = "/r/1.mp4", url = "d1")), paused = true)
    assertTrue(transport.calls.isEmpty())
    e.resume(cellular = true)
    assertEquals(listOf("d1"), transport.calls)
  }

  @Test fun idleWhenNothingIsLeftToRun() {
    val e = engine()
    e.start(listOf(up(1)), paused = false)
    assertFalse(e.idle())
    transport.answer("u1", 200)
    assertTrue(e.idle())
  }
}
