package expo.modules.replaycamera.core

/**
 * Where each sample of a clip lands in its shared cut (`ClipCut`), copied without re-encoding, as on the iPhone
 * (ClipCut.swift). A picture can only start on a key frame (one a second in the recordings), and Android's muxer writes
 * no edit list to hide what comes before the cut, so the frames from that key frame to the cut are squeezed into the
 * cut's first microseconds: decoded, never seen. The cut file's time then starts exactly at the cut, which the framing
 * files sent with it count on (`shareCut.ts`, `rebaseFramingText`).
 */
object CutPlan {
  /** One sample of the source track, in the file's order: its time and whether it is a key frame. */
  data class Sample(val timeUs: Long, val key: Boolean)

  /** The index of the key frame the cut's picture starts from: the last one at or before the cut. */
  private fun keyIndex(samples: List<Sample>, startUs: Long): Int {
    var found = 0
    samples.forEachIndexed { i, s -> if (s.key && s.timeUs <= startUs) found = i }
    return found
  }

  /** How many frames before the cut are squeezed in (from its key frame to the cut). */
  fun lead(samples: List<Sample>, startUs: Long): Int {
    val from = keyIndex(samples, startUs)
    return samples.drop(from).count { it.timeUs < startUs }
  }

  /** Each picture sample's time in the cut, or null when it stays out. */
  fun video(samples: List<Sample>, startUs: Long, endUs: Long): List<Long?> {
    val from = keyIndex(samples, startUs)
    val lead = lead(samples, startUs)
    var squeezed = 0L
    return samples.mapIndexed { i, s ->
      when {
        i < from || s.timeUs >= endUs -> null
        s.timeUs < startUs -> squeezed++
        else -> s.timeUs - startUs + lead
      }
    }
  }

  /** A sound sample's time in the cut, lined up with the picture; null outside the cut. */
  fun audio(timeUs: Long, startUs: Long, endUs: Long, lead: Int): Long? =
    if (timeUs < startUs || timeUs >= endUs) null else timeUs - startUs + lead
}
