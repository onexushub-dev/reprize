package expo.modules.replaycamera.transfer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same rules as the iPhone's background transfers (BackgroundUpload.swift, TransferOrder.swift). */
class TransferRulesTest {
  private fun item(id: String, status: String = "running", cellular: Boolean = true, priority: Double = -1.0, queuedAt: Double = 0.0) =
    TransferRules.Candidate(id, status, cellular, priority, queuedAt)

  @Test fun coverFirstThenClipsInOrderStillJustBeforeItsVideo() {
    val ids = listOf("s/clips/2/video.mp4", "s/clips/1/video.mp4", "s/cover.jpg", "s/clips/1/thumb.jpg", "s/meta.json")
    val sorted = ids.sortedByDescending { TransferRules.priority(it) }
    assertEquals(listOf("s/cover.jpg", "s/clips/1/thumb.jpg", "s/clips/1/video.mp4", "s/clips/2/video.mp4", "s/meta.json"), sorted)
  }

  @Test fun recvIdsUseTheirClipNumberToo() {
    assertTrue(TransferRules.priority("recv/abc/1/video") > TransferRules.priority("recv/abc/3/video"))
  }

  @Test fun aGivenPriorityWinsOverTheNativeOrder() {
    val next = TransferRules.next(listOf(item("s/clips/1/video.mp4"), item("other/9/video", priority = 1.0)), inFlight = emptySet(), slots = 1, metered = false)
    assertEquals(listOf("other/9/video"), next)
  }

  @Test fun runsAtMostTheFreeSlotsSkippingWhatIsAlreadyGoingAndWhatIsNotRunning() {
    val entries = listOf(
      item("s/clips/1/video.mp4"), item("s/clips/2/video.mp4"), item("s/clips/3/video.mp4", status = "paused"),
      item("s/clips/4/video.mp4", status = "done"), item("s/clips/5/video.mp4"), item("s/clips/6/video.mp4"),
    )
    val next = TransferRules.next(entries, inFlight = setOf("s/clips/1/video.mp4"), slots = 4, metered = false)
    assertEquals(listOf("s/clips/2/video.mp4", "s/clips/5/video.mp4", "s/clips/6/video.mp4"), next)
  }

  @Test fun onMobileDataOnlyFilesAllowedOnIt() {
    val entries = listOf(item("s/clips/1/video.mp4", cellular = false), item("s/clips/2/video.mp4"))
    assertEquals(listOf("s/clips/2/video.mp4"), TransferRules.next(entries, emptySet(), 4, metered = true))
    assertEquals(listOf("s/clips/1/video.mp4", "s/clips/2/video.mp4"), TransferRules.next(entries, emptySet(), 4, metered = false))
  }

  @Test fun waitingForWifiIsKnown() {
    val entries = listOf(item("a", cellular = false), item("b", status = "done"))
    assertTrue(TransferRules.waitsForWifi(entries, metered = true))
    assertEquals(false, TransferRules.waitsForWifi(entries, metered = false))
  }

  @Test fun successFinishesOk() {
    assertEquals(TransferRules.Outcome.DONE, TransferRules.outcome(httpStatus = 200, error = null, cancelled = false, running = true, attempts = 1))
  }

  @Test fun aServerOrNetworkErrorRetriesUpToFiveAttempts() {
    assertEquals(TransferRules.Outcome.RETRY, TransferRules.outcome(500, null, false, true, 4))
    assertEquals(TransferRules.Outcome.RETRY, TransferRules.outcome(0, "timeout", false, true, 1))
    assertEquals(TransferRules.Outcome.FAIL, TransferRules.outcome(500, null, false, true, 5))
  }

  @Test fun a4xxNeverRetriesTheUrlIsWrongOrExpired() {
    assertEquals(TransferRules.Outcome.FAIL, TransferRules.outcome(403, null, false, true, 1))
  }

  @Test fun stoppedByPauseOrRemoveIsLeftAlone() {
    // pause marks `paused` and remove forgets the file before cancelling: the cancelled transfer must not report.
    assertEquals(TransferRules.Outcome.IGNORE, TransferRules.outcome(0, "cancelled", cancelled = true, running = false, attempts = 1))
  }

  @Test fun pathsMayComeAsFileUris() {
    assertEquals("/data/user/0/app/files/a.mp4", TransferRules.localPath("file:///data/user/0/app/files/a.mp4"))
    assertEquals("/data/user/0/app/files/a.mp4", TransferRules.localPath("/data/user/0/app/files/a.mp4"))
  }
}
