package expo.modules.replaycamera.ball

import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/**
 * The detector's side of Seguir a Bola, apart from the model and the pictures (port of `BallDetect.swift`): which regions
 * of a frame go to the model, and how its raw output becomes the frame's candidates. The whole frame letterboxed into the
 * model's square, every tile, all anchors with objectness × class ≥ conf, merged and then NMS at IoU 0.5, rounded as the
 * lab stores them.
 */
object BallDetect {
  /** One region of the frame sent to the model: its origin in the frame and the model px per frame px. */
  data class Region(val x0: Int, val y0: Int, val scale: Double)

  /** A candidate in frame px (centre, size) with its score. */
  data class Box(val cx: Double, val cy: Double, val w: Double, val h: Double, val score: Double)

  /** Tile origins along one side: `tile` px, at least `overlap` px shared. */
  fun starts(n: Int, tile: Int, overlap: Int = 80): List<Int> {
    if (n <= tile) return listOf(0)
    val k = ceil((n - overlap).toDouble() / (tile - overlap).toDouble()).toInt()
    return (0 until k).map { i -> Math.rint(i.toDouble() * (n - tile).toDouble() / (k - 1).toDouble()).toInt() }
  }

  /** The frame's regions in the model's order: the whole frame first, then the tiles row by row. */
  fun regions(width: Int, height: Int, side: Int, tile: Int): List<Region> {
    val out = ArrayList<Region>()
    out.add(Region(0, 0, min(side.toDouble() / width, side.toDouble() / height)))
    for (y0 in starts(height, tile)) for (x0 in starts(width, tile)) out.add(Region(x0, y0, side.toDouble() / tile))
    return out
  }

  /** YOLOX's anchors for a `side` square: (grid x, grid y, stride) at strides 8, 16, 32. */
  fun anchors(side: Int): List<FloatArray> {
    val g = ArrayList<FloatArray>()
    for (stride in intArrayOf(8, 16, 32)) {
      val n = side / stride
      for (y in 0 until n) for (x in 0 until n) g.add(floatArrayOf(x.toFloat(), y.toFloat(), stride.toFloat()))
    }
    return g
  }

  /**
   * One region's output, `value(row, column)` over `rows` anchors: columns 0–3 xy offsets and log wh, 4 objectness,
   * 5 + `cls` the ball class. Candidates with objectness × class ≥ `conf`, in frame px, in anchor order.
   */
  fun decode(rows: Int, cls: Int, anchors: List<FloatArray>, region: Region, conf: Float = 0.05f,
             value: (Int, Int) -> Float): List<Box> {
    val out = ArrayList<Box>()
    val r = region.scale
    for (i in 0 until min(rows, anchors.size)) {
      val obj = value(i, 4)
      if (obj < conf) continue // the class score is at most 1
      val s = obj * value(i, 5 + cls)
      if (s < conf) continue
      val a = anchors[i]
      val x = (value(i, 0) + a[0]) * a[2]
      val y = (value(i, 1) + a[1]) * a[2]
      val w = exp(value(i, 2)) * a[2]
      val h = exp(value(i, 3)) * a[2]
      out.add(Box(x.toDouble() / r + region.x0, y.toDouble() / r + region.y0, w.toDouble() / r, h.toDouble() / r, s.toDouble()))
    }
    return out
  }

  /** Highest score first (ties in the given order), a box overlapping a kept one by IoU > `iou` dropped. */
  fun nms(boxes: List<Box>, iou: Double = 0.5): List<Box> {
    val order = boxes.indices.sortedWith { a, b ->
      if (boxes[a].score != boxes[b].score) boxes[b].score.compareTo(boxes[a].score) else a.compareTo(b)
    }
    val keep = ArrayList<Box>()
    for (i in order) {
      val v = boxes[i]
      val ok = keep.none { k ->
        val ix = max(0.0, min(v.cx + v.w / 2, k.cx + k.w / 2) - max(v.cx - v.w / 2, k.cx - k.w / 2))
        val iy = max(0.0, min(v.cy + v.h / 2, k.cy + k.h / 2) - max(v.cy - v.h / 2, k.cy - k.h / 2))
        val u = v.w * v.h + k.w * k.h - ix * iy
        u > 0 && ix * iy / u > iou
      }
      if (ok) keep.add(v)
    }
    return keep
  }

  /** The frame's candidates as stored (0..1 of the frame, 4 decimals; score 3 decimals), after NMS. */
  fun frameCandidates(boxes: List<Box>, width: Int, height: Int): List<BallCandidate> =
    nms(boxes).map { b ->
      BallCandidate(BallMath.roundTo(b.cx / width, 4), BallMath.roundTo(b.cy / height, 4), BallMath.roundTo(b.w / width, 4),
        BallMath.roundTo(b.h / height, 4), BallMath.roundTo(b.score, 3))
    }
}
