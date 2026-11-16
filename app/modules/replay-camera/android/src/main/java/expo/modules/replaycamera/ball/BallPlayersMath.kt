package expo.modules.replaycamera.ball

/** The parts of `BallPlayers` the ball path needs (the rest comes with the sports' rules). */
object BallPlayers {
  /** The boxes at least `share` of the 80th-percentile height of every box of the clip. */
  fun main(rows: List<List<List<Double>>>, share: Double): List<List<List<Double>>> {
    val hs = rows.flatMap { r -> r.filter { it.size >= 4 }.map { it[3] } }
    if (hs.isEmpty()) return rows.map { emptyList() }
    val hmin = share * percentile(hs, 80.0)
    return rows.map { r -> r.filter { it.size >= 4 && it[3] >= hmin } }
  }

  /** numpy.percentile (linear). */
  fun percentile(v: List<Double>, q: Double): Double {
    val s = v.sorted()
    val pos = q / 100 * (s.size - 1).toDouble()
    val i = Math.floor(pos).toInt()
    val f = pos - i
    return if (i + 1 < s.size) s[i] + f * (s[i + 1] - s[i]) else s[i]
  }
}
