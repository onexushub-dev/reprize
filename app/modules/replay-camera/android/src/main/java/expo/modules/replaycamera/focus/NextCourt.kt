package expo.modules.replaycamera.focus

import expo.modules.replaycamera.ball.BallPlayers

/**
 * Jogadores on Android only (Marcus, 2026-11-17, beach tennis with courts side by side): the people on the next court
 * are left out of the framing. The iPhone has no such rule.
 *
 * The main court comes from the whole clip, not from each picture: the near players are the tall ones (at least TALL
 * of the 80th-percentile height of every box), and the middle 90% of their centres is the court's width. A small
 * person whose centre is more than MARGIN outside it is left out; a tall one never is. Being fixed for the clip, the
 * rule cannot flicker (a picture-by-picture version opened and closed the framing when two neighbours stood together,
 * and left out a near player whose box came out short for a moment).
 *
 * Measured on Android's people (lab, 2026-11-17): the two clips that showed it 1.10x -> 1.52x and 1.10x -> 1.65x, the
 * camera moving less or the same; on our 10 beach tennis clips everyone left out was on another court or off it.
 */
object NextCourt {
  const val TALL = 0.6
  const val MARGIN = 0.15
  /** The court's ends: these percentiles of the tall people's centres. */
  private const val END = 5.0
  private const val MIN_BOXES = 20
  private const val MIN_TALL = 10

  /** The main court's width (centre x from..to) and the 80th-percentile height; null = too few people to tell. */
  data class Court(val from: Double, val to: Double, val height: Double)

  fun court(rows: List<List<FocusBox>>): Court? {
    val heights = rows.flatMap { r -> r.map { it.height } }
    if (heights.size < MIN_BOXES) return null
    val ref = BallPlayers.percentile(heights, 80.0)
    val xs = rows.flatMap { r -> r.filter { it.height >= TALL * ref }.map { centre(it) } }
    if (xs.size < MIN_TALL) return null
    return Court(BallPlayers.percentile(xs, END), BallPlayers.percentile(xs, 100 - END), ref)
  }

  /** `rows` with the people on the next court left out, the rest in their order; unchanged when the court is unknown. */
  fun keep(rows: List<List<FocusBox>>, court: Court? = court(rows)): List<List<FocusBox>> {
    if (court == null) return rows
    return rows.map { r ->
      r.filter { it.height >= TALL * court.height || centre(it) in (court.from - MARGIN)..(court.to + MARGIN) }
    }
  }

  private fun centre(b: FocusBox) = b.x + b.width / 2
}
