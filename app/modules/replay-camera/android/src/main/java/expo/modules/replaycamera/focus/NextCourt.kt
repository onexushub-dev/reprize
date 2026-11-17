package expo.modules.replaycamera.focus

/**
 * Jogadores on Android only (Marcus, 2026-11-17, beach tennis with courts side by side): the person at either end of
 * a picture who stands more than GAP of the frame width from the next one and is shorter than RATIO of the tallest is
 * someone on the next court (or watching), left out of the framing. The iPhone has no such rule.
 *
 * Measured on Android's people (lab, 2026-11-17): the clip that showed it 1.10x -> 1.28x, its right edge 0.93 -> 0.81
 * (the neighbour out of the picture); on our 10 beach tennis clips every person left out was on another court or off it,
 * except 1-2 single pictures, which the framing's 1 s hold covers. A RATIO of 0.7 left out a player on our court.
 */
object NextCourt {
  const val GAP = 0.2
  const val RATIO = 0.6

  fun keep(boxes: List<FocusBox>): List<FocusBox> {
    if (boxes.size < 3) return boxes
    val tallest = boxes.maxOf { it.height }
    val byX = boxes.sortedBy { centre(it) }.toMutableList()
    val out = HashSet<FocusBox>()
    for (end in listOf(0, 1)) {
      if (byX.size < 3) break
      val i = if (end == 0) 0 else byX.size - 1
      val next = if (end == 0) byX[1] else byX[byX.size - 2]
      val b = byX[i]
      if (Math.abs(centre(b) - centre(next)) > GAP && b.height < RATIO * tallest) { out.add(b); byX.removeAt(i) }
    }
    return if (out.isEmpty()) boxes else boxes.filter { it !in out }
  }

  private fun centre(b: FocusBox) = b.x + b.width / 2
}
