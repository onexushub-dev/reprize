package expo.modules.replaycamera

/**
 * Which zoom stops Android can offer. Phones may hide their ultra-wide from apps (POCO X3 NFC, 2026-11-17: Xiaomi keeps
 * camera 21, 1.86 mm, to its own camera app), and then 0.5x would open the main camera again. So 0.5x is offered only
 * when the app sees a back camera much wider than the main one, the first back camera, which is what 1x opens.
 */
object Lenses {
  /** An ultra-wide's focal length is at most this share of the main camera's (main 5.43 mm, ultra-wide 1.86 mm). */
  private const val ULTRA_WIDE = 0.8

  /** The lowest zoom: 0.5 with a visible ultra-wide, else 1. `backFocals`: shortest focal of each back camera, in id order. */
  fun zoomMin(backFocals: List<Float>): Double {
    val main = backFocals.firstOrNull() ?: return 1.0
    return if (backFocals.any { it < main * ULTRA_WIDE }) 0.5 else 1.0
  }
}
