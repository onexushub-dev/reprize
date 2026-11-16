package expo.modules.replaycamera.core

/**
 * Which pictures of a clip an analysis needs (port of `ScanTicks.swift`): Jogadores and Bola each want one picture per
 * tick of their own grid, and one pass over the clip's frames serves both. A tick stands for the `windowMs` after it.
 */
object ScanTicks {
  /** The grid of a range: `startMs`, then every `everyMs`, before `endMs`. */
  fun ticks(startMs: Double, endMs: Double, everyMs: Double): List<Double> {
    if (!(everyMs > 0 && endMs > startMs)) return emptyList()
    val out = ArrayList<Double>()
    var i = 0
    while (true) {
      val t = startMs + i * everyMs // as Swift's stride: start + i × step, not a running sum
      if (t >= endMs) break
      out.add(t)
      i += 1
    }
    return out
  }

  /** The ticks with no kept picture (`have`: their times, any order) in their window. */
  fun missing(ticks: List<Double>, have: List<Double>, windowMs: Double): List<Double> {
    val sorted = have.sorted()
    return ticks.filter { tick ->
      var lo = 0
      var hi = sorted.size
      while (lo < hi) {
        val mid = (lo + hi) / 2
        if (sorted[mid] < tick - 0.5) lo = mid + 1 else hi = mid
      }
      !(lo < sorted.size && sorted[lo] < tick + windowMs - 0.5)
    }
  }

  /** Walks the frames in time order and says which to keep: the first at or after each tick, inside its window. */
  class Cursor(val ticks: List<Double>, val windowMs: Double) {
    private var next = 0
    val done: Boolean get() = next >= ticks.size

    fun take(tMs: Double): Boolean {
      while (next < ticks.size && tMs >= ticks[next] + windowMs - 0.5) next += 1
      if (!(next < ticks.size && tMs >= ticks[next] - 0.5)) return false
      next += 1
      return true
    }
  }

  /** The stretch of the clip to read for both lists of ticks (each with its window); null when there is nothing to read. */
  fun span(people: List<Double>, peopleWindowMs: Double, ball: List<Double>, ballWindowMs: Double): Pair<Double, Double>? {
    var from = Double.POSITIVE_INFINITY
    var to = Double.NEGATIVE_INFINITY
    if (people.isNotEmpty()) { from = minOf(from, people.min()); to = maxOf(to, people.max() + peopleWindowMs) }
    if (ball.isNotEmpty()) { from = minOf(from, ball.min()); to = maxOf(to, ball.max() + ballWindowMs) }
    return if (from <= to) Pair(from, to) else null
  }
}
