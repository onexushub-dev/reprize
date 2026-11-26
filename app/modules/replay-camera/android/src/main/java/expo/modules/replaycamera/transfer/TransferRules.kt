package expo.modules.replaycamera.transfer

/**
 * The decisions of the background transfers, kept free of Android so they are tested on the JVM. They follow the
 * iPhone's (ios/BackgroundUpload.swift, ios/BackgroundDownload.swift, ios/TransferOrder.swift): the clips go in their
 * order, a few at a time; a failed file starts again from its first byte up to `MAX_ATTEMPTS`; a 4xx is never retried.
 */
object TransferRules {
  /** Files at once, as the iPhone's `TransferOrder.connections`. */
  const val CONNECTIONS = 4
  const val MAX_ATTEMPTS = 5
  private const val DEFAULT_PRIORITY = 0.5

  /** What the transfer loop needs to know about one file. */
  data class Candidate(val id: String, val status: String, val cellular: Boolean, val priority: Double, val queuedAt: Double)

  enum class Outcome { DONE, RETRY, FAIL, IGNORE }

  /**
   * The cover's still first (the link's page), then the clips in their order with a clip's still just before its
   * video; files without a clip number in the middle. As `TransferOrder.priority(for:)`.
   */
  fun priority(id: String): Double {
    if (id.endsWith("cover.jpg")) return 1.0
    val position = position(id) ?: return DEFAULT_PRIORITY
    val clip = maxOf(0.01, 0.99 - minOf(position, 980) / 1000.0)
    return if (id.endsWith("thumb.jpg")) minOf(0.995, clip + 0.0005) else clip
  }

  /** The clip's place in an id like "recv/<share>/12/video" or "<share>/clips/12/video.mp4". */
  private fun position(id: String): Int? = id.split("/").firstNotNullOfOrNull { part -> part.toIntOrNull()?.takeIf { it > 0 } }

  private fun effective(c: Candidate): Double = if (c.priority >= 0) minOf(1.0, c.priority) else priority(c.id)

  /** The files to start now: running, not already going, allowed on this network, highest priority first. */
  fun next(entries: List<Candidate>, inFlight: Set<String>, slots: Int, metered: Boolean): List<String> {
    if (slots <= 0) return emptyList()
    return entries
      .filter { it.status == "running" && it.id !in inFlight && (it.cellular || !metered) }
      .sortedWith(compareByDescending<Candidate> { effective(it) }.thenBy { it.queuedAt }.thenBy { it.id })
      .take(slots)
      .map { it.id }
  }

  /** Something still running can only go over Wi-Fi while the phone is on mobile data. */
  fun waitsForWifi(entries: List<Candidate>, metered: Boolean): Boolean =
    metered && entries.any { it.status == "running" && !it.cellular }

  /**
   * What to do when a transfer ends. `cancelled`: stopped from inside the app. `running`: the file is still meant to go
   * (pause marks it `paused` and remove forgets it before cancelling, so those report nothing).
   */
  fun outcome(httpStatus: Int, error: String?, cancelled: Boolean, running: Boolean, attempts: Int): Outcome {
    if (error == null && httpStatus in 200..299) return Outcome.DONE
    if (!running) return Outcome.IGNORE
    if (cancelled) return if (attempts < MAX_ATTEMPTS) Outcome.RETRY else Outcome.FAIL
    // A 4xx means the URL is wrong or expired: trying again will not help.
    if (httpStatus in 400..499) return Outcome.FAIL
    return if (attempts < MAX_ATTEMPTS) Outcome.RETRY else Outcome.FAIL
  }

  /** The app passes plain paths; a file URI is accepted too. */
  fun localPath(path: String): String = if (path.startsWith("file://")) path.removePrefix("file://") else path
}
