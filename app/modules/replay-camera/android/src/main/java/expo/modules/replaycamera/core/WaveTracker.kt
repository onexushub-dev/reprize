package expo.modules.replaycamera.core

import kotlin.math.abs

/** One person seen in one sample: their pose and where they are in the frame (0..1), to follow them between samples. */
data class Sighting(val pose: Pose, val x: Double, val y: Double)

/**
 * The wave gesture (port of the iOS ReplayCore WaveTracker, same thresholds): both hands above the head, swung from
 * side to side for about a second and a half, like waving to someone far away. Motion is a stronger signal than a
 * held pose at a distance, and unlike the hold it does not fire on a volleyball set or block.
 *
 * People are followed from sample to sample by where they are in the frame, so two players doing half a wave each
 * never add up to one.
 */
class WaveTracker(
  private val window: Double = 1.6,
  private val minSpan: Double = 1.0,
  private val minSamples: Int = 5,
  private val raisedFraction: Double = 0.75,
  /** How far each hand must travel sideways, in shoulder widths. */
  private val minRange: Double = 0.4,
  /** How much sideways distance each hand must cover in total inside the window (back and forth adds up). */
  private val minPath: Double = 0.8,
  private val cooldown: Double = 3.0,
  private val release: Double = 0.8,
  private val matchDistance: Double = 0.15,
) {
  private data class Sample(val t: Double, val raised: Boolean, val left: Double, val right: Double)

  private class Track(var x: Double, var y: Double) {
    val samples = mutableListOf<Sample>()
  }

  private var tracks = mutableListOf<Track>()
  private var cooldownUntil = Double.NEGATIVE_INFINITY
  private var awaitingRelease = false
  private var lastRaised = Double.NEGATIVE_INFINITY

  companion object {
    const val MIN_CONFIDENCE = 0.2
    /** Where the head is when the nose is not seen: this many shoulder widths above the shoulders. */
    const val NOSE_ABOVE_SHOULDERS = 0.75

    private fun usable(p: Point?): Point? = p?.takeIf { it.confidence >= MIN_CONFIDENCE }

    /** The y of the head (the nose, or an estimate from the shoulders) and the shoulder width; null without shoulders. */
    fun headLine(p: Pose): Pair<Double, Double>? {
      val ls = usable(p.leftShoulder) ?: return null
      val rs = usable(p.rightShoulder) ?: return null
      val width = abs(ls.x - rs.x)
      if (width <= 0) return null
      val nose = usable(p.nose)
      return Pair(nose?.y ?: ((ls.y + rs.y) / 2 - NOSE_ABOVE_SHOULDERS * width), width)
    }

    /** Both wrists above the head line: the cue the practice screen shows ("arms up: now wave"). */
    fun armsRaised(p: Pose): Boolean = measure(p)?.first ?: false

    /** (raised, left wrist x, right wrist x), the x in shoulder widths from the shoulders' middle. */
    private fun measure(p: Pose): Triple<Boolean, Double, Double>? {
      val lw = usable(p.leftWrist) ?: return null
      val rw = usable(p.rightWrist) ?: return null
      val (headY, width) = headLine(p) ?: return null
      val midX = (p.leftShoulder!!.x + p.rightShoulder!!.x) / 2
      val raised = lw.y < headY && rw.y < headY
      return Triple(raised, (lw.x - midX) / width, (rw.x - midX) / width)
    }
  }

  /** Call once per sample with everybody seen in it (an empty list is fine). True when somebody just waved. */
  fun update(sightings: List<Sighting>, t: Double): Boolean {
    tracks = tracks.filter { track -> track.samples.lastOrNull()?.let { t - it.t <= window } ?: false }.toMutableList()
    val used = mutableSetOf<Track>()
    var anyRaised = false

    for (s in sightings) {
      val m = measure(s.pose) ?: continue
      var best: Track? = null
      var bestDistance = matchDistance
      for (track in tracks) {
        if (track in used) continue
        val d = maxOf(abs(track.x - s.x), abs(track.y - s.y))
        if (d <= bestDistance) {
          best = track
          bestDistance = d
        }
      }
      val track = best ?: Track(s.x, s.y).also { tracks.add(it) }
      used.add(track)
      track.x = s.x
      track.y = s.y
      track.samples.add(Sample(t, m.first, m.second, m.third))
      track.samples.removeAll { t - it.t > window + 1e-9 }
      if (m.first) anyRaised = true
    }

    if (anyRaised) lastRaised = t
    if (awaitingRelease) {
      if (t - lastRaised > release + 1e-9) awaitingRelease = false else return false
    }
    if (t < cooldownUntil) return false

    if (tracks.any(::waves)) {
      awaitingRelease = true
      cooldownUntil = t + cooldown
      lastRaised = t
      tracks = mutableListOf()
      return true
    }
    return false
  }

  private fun waves(track: Track): Boolean {
    val samples = track.samples
    if (samples.size < minSamples || samples.last().t - samples.first().t < minSpan - 1e-9) return false
    val raised = samples.filter { it.raised }
    if (raised.size.toDouble() / samples.size < raisedFraction) return false
    return swings(raised.map { it.left }) && swings(raised.map { it.right })
  }

  private fun swings(xs: List<Double>): Boolean {
    val lo = xs.minOrNull() ?: return false
    val hi = xs.maxOrNull() ?: return false
    if (hi - lo < minRange) return false
    var path = 0.0
    for (i in 1 until xs.size) path += abs(xs[i] - xs[i - 1])
    return path >= minPath
  }
}
