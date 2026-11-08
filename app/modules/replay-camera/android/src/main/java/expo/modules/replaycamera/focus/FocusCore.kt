package expo.modules.replaycamera.focus

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

// Kotlin port of ReplayCore's Modo Foco rules (FocusPath, FocusActivity, FocusGrid, FocusRamp, ScanTiles, PersonBoxes).
// Same numbers, same order of operations, pinned by focus-vectors.json written by the Swift core, so a clip is framed
// the same on both platforms. Keep in step with ios/Core/Sources/ReplayCore.

/** A person found in one frame: 0..1 of the video, origin top-left, display orientation. */
data class FocusBox(val x: Double, val y: Double, val width: Double, val height: Double)

/** One analysed frame (every 100 ms). */
data class FocusSample(val tMs: Double, val boxes: List<FocusBox>)

/** The visible part of the video: 0..1 of its size, origin top-left. */
data class FocusRect(val x: Double, val y: Double, val width: Double, val height: Double)

enum class FocusAspect(val ratio: Double) { LANDSCAPE(16.0 / 9.0), PORTRAIT(9.0 / 16.0) }

class FocusTuning {
  var farShare = 0.4
  var tallestCount = 10
  var stillRadius = 0.012
  var stillShare = 0.8
  var stillWindowMs = 3000.0
  var moveUnit = 0.01
  var moveCap = 4.0
  var spreadLow = 0.1
  var spreadHigh = 0.9
  var sigmaXMs = 600.0
  var sigmaYMs = 800.0
  var sigmaSizeMs = 1200.0
  var maxPanPerSecond = 0.35
  var spreadScale = 1.3
  var spreadMargin = 0.15
  var lift = 0.0
  var minPeopleShare = 0.2
  var holdMs = 1000.0
  var widthHoldMs = 1000.0
  var activity = false
  var trackGapMs = 1000.0
  var trackMatch = 0.7
  var stillBodies = 0.3
  var spectatorMinMs = 8000.0
  var activityWindowMs = 6000.0
  var speedUnit = 0.6
  var speedWindowMs = 500.0
  var activeSpread = false
  var activeWeight = 2.0
  var zoomIn = 1.0

  companion object {
    val STANDARD get() = FocusTuning()

    /** What the analyzer uses (v15): people tracked between samples, 10% more zoom. */
    val ACTION: FocusTuning get() = FocusTuning().apply { activity = true; activeSpread = true; zoomIn = 1.1 }
  }
}

object FocusPath {
  /**
   * One crop rect per sample, or null when there are too few people for a framing. `zoom = false` gives the largest rect
   * of `aspect` that fits, moved with the play (the track for the other shape).
   */
  fun compute(samples: List<FocusSample>, videoWidth: Double, videoHeight: Double, aspect: FocusAspect, zoom: Boolean,
              maxZoom: Double = 1.5, t: FocusTuning = FocusTuning.STANDARD): List<FocusRect>? {
    val n = samples.size
    if (n == 0 || videoWidth <= 0 || videoHeight <= 0) return null
    val w0 = videoWidth
    val h0 = videoHeight
    val step = if (n < 2) 100.0 else (samples[n - 1].tMs - samples[0].tMs) / (n - 1).toDouble()

    // 1. Far people out.
    val near: List<List<FocusBox>> = samples.map { s ->
      if (s.boxes.isEmpty()) return@map emptyList()
      val tallest = s.boxes.map { it.height }.sortedDescending().take(t.tallestCount)
      val ref = median(tallest)
      s.boxes.filter { it.height >= t.farShare * ref }
    }
    // 2. Still people out.
    var people: MutableList<List<FocusBox>> = mutableListOf()
    var activityWeights: List<List<Double>>? = null
    if (t.activity) {
      val act = FocusActivity.people(List(n) { FocusSample(samples[it].tMs, near[it]) }, w0, h0, t)
      people = act.map { row -> row.map { it.first } }.toMutableList()
      activityWeights = act.map { row -> row.map { it.second } }
    }
    val feet = near.map { row -> row.map { Pair(it.x + it.width / 2, it.y + it.height) } }
    if (!t.activity) {
      for (i in 0 until n) {
        val keep = ArrayList<FocusBox>()
        for ((j, box) in near[i].withIndex()) {
          val foot = feet[i][j]
          var hits = 0
          var total = 0
          for (k in 0 until n) {
            if (k == i || abs(samples[k].tMs - samples[i].tMs) > t.stillWindowMs) continue
            total += 1
            if (feet[k].any { hypot((foot.first - it.first) * w0, (foot.second - it.second) * h0) < t.stillRadius * w0 }) hits += 1
          }
          val still = total > 0 && hits.toDouble() >= t.stillShare * total.toDouble()
          if (!still) keep.add(box)
        }
        people.add(keep)
      }
    }
    if (people.count { it.isNotEmpty() }.toDouble() < t.minPeopleShare * n.toDouble()) return null
    if (t.holdMs > 0) people = held(people, samples, w0, h0, t.holdMs).toMutableList()

    // 3-4. Weights and the target per sample.
    val cx = arrayOfNulls<Double>(n)
    val cy = arrayOfNulls<Double>(n)
    val spread = arrayOfNulls<Double>(n)
    var previous: List<Pair<Double, Double>> = emptyList()
    for (i in 0 until n) {
      val centres = people[i].map { Pair(it.x + it.width / 2, it.y + it.height / 2) }
      if (centres.isEmpty()) { previous = emptyList(); continue }
      val weights: List<Double> = if (activityWeights != null) {
        val own = activityWeights[i]
        centres.indices.map { if (it < own.size) own[it] else 1.0 }
      } else {
        centres.map { c ->
          val moved = previous.map { hypot((c.first - it.first) * w0, (c.second - it.second) * h0) }.minOrNull() ?: 0.0
          1 + min(moved / (t.moveUnit * w0), t.moveCap)
        }
      }
      val total = weights.sum()
      cx[i] = centres.indices.sumOf { centres[it].first * weights[it] } / total
      cy[i] = centres.indices.sumOf { centres[it].second * weights[it] } / total
      val xs = centres.map { it.first }
      val active = if (activityWeights != null && t.activeSpread) xs.indices.filter { weights[it] >= t.activeWeight } else emptyList()
      spread[i] = if (active.isNotEmpty()) {
        val ax = active.map { xs[it] }
        ax.max() - ax.min()
      } else {
        weightedQuantile(xs, weights, t.spreadHigh) - weightedQuantile(xs, weights, t.spreadLow)
      }
      previous = centres
    }

    // 5. Smooth with look-ahead, then limit the pan speed.
    val x = gaussian(fill(cx), t.sigmaXMs / step).toMutableList()
    val y = gaussian(fill(cy), t.sigmaYMs / step)
    val limit = t.maxPanPerSecond * step / 1000
    for (i in 1 until max(n, 1)) x[i] = x[i - 1] + min(max(x[i] - x[i - 1], -limit), limit)

    // 6-7. Size and placement.
    var wanted = fill(spread).map { min(max(it * t.spreadScale + t.spreadMargin, 1 / maxZoom), 1.0) }
    if (zoom && t.widthHoldMs > 0) wanted = windowMax(wanted, (t.widthHoldMs / step).roundHalfAwayFromZero())
    val widths: List<Double> = if (zoom) gaussian(wanted, t.sigmaSizeMs / step) else List(n) { 1.0 }
    val ratio = aspect.ratio
    return (0 until n).map { i ->
      var w = if (zoom) widths[i] else min(1.0, ratio * h0 / w0)
      var h = w * w0 / (ratio * h0)
      if (h > 1) { h = 1.0; w = ratio * h0 / w0 }
      if (zoom && t.zoomIn > 1) { w /= t.zoomIn; h /= t.zoomIn }
      val left = min(max(x[i] - w / 2, 0.0), 1 - w)
      val top = min(max(y[i] - t.lift * h - h / 2, 0.0), 1 - h)
      FocusRect(left, top, w, h)
    }
  }

  private fun Double.roundHalfAwayFromZero(): Int = if (this >= 0) Math.floor(this + 0.5).toInt() else -Math.floor(-this + 0.5).toInt()

  /** People who vanished kept where last seen for `holdMs`, unless someone is found within a body length of them. */
  fun held(people: List<List<FocusBox>>, samples: List<FocusSample>, w0: Double, h0: Double, holdMs: Double): List<List<FocusBox>> {
    val out = people.map { it.toMutableList() }
    var memory = listOf<Pair<FocusBox, Double>>()
    for (i in people.indices) {
      val now = samples[i].tMs
      val centres = people[i].map { Pair(it.x + it.width / 2, it.y + it.height / 2) }
      val kept = ArrayList<Pair<FocusBox, Double>>()
      for (m in memory) {
        if (now - m.second > holdMs) continue
        val c = Pair(m.first.x + m.first.width / 2, m.first.y + m.first.height / 2)
        val reach = max(m.first.width * w0, m.first.height * h0)
        if (centres.any { hypot((c.first - it.first) * w0, (c.second - it.second) * h0) < reach }) continue
        kept.add(m)
        out[i].add(m.first)
      }
      memory = kept + people[i].map { Pair(it, now) }
    }
    return out
  }

  /** Each value replaced by the largest within ± `radius` samples. */
  fun windowMax(values: List<Double>, radius: Int): List<Double> {
    if (radius <= 0) return values
    val n = values.size
    return (0 until n).map { i -> (max(0, i - radius)..min(n - 1, i + radius)).maxOf { values[it] } }
  }

  fun median(values: List<Double>): Double {
    val s = values.sorted()
    val n = s.size
    return if (n % 2 == 1) s[n / 2] else (s[n / 2 - 1] + s[n / 2]) / 2
  }

  /** The first value (sorted) whose cumulative weight share reaches `q`. */
  fun weightedQuantile(values: List<Double>, weights: List<Double>, q: Double): Double {
    val order = values.indices.sortedWith(compareBy({ values[it] }, { it }))
    val total = weights.sum()
    var sum = 0.0
    for (i in order) {
      sum += weights[i]
      if (sum / total >= q) return values[i]
    }
    return values[order[order.size - 1]]
  }

  /** Gaps filled linearly between known values; ends hold the nearest known value. */
  fun fill(values: Array<Double?>): List<Double> {
    val known = values.indices.filter { values[it] != null }
    val first = known.firstOrNull()
    val last = known.lastOrNull()
    if (first == null || last == null) return List(values.size) { 0.5 }
    val out = DoubleArray(values.size)
    var k = 0
    for (i in values.indices) {
      if (i <= first) { out[i] = values[first]!!; continue }
      if (i >= last) { out[i] = values[last]!!; continue }
      while (known[k + 1] < i) k += 1
      val a = known[k]
      val b = known[k + 1]
      val va = values[a]!!
      val vb = values[b]!!
      out[i] = if (i == b) vb else va + (vb - va) * (i - a).toDouble() / (b - a).toDouble()
    }
    return out.toList()
  }

  /** Centred Gaussian (radius 3σ) with the edge values repeated. */
  fun gaussian(values: List<Double>, sigma: Double): List<Double> {
    if (sigma <= 0 || values.size <= 1) return values
    val r = Math.ceil(3 * sigma).toInt()
    val kernel = (-r..r).map { exp(-0.5 * (it.toDouble() / sigma).pow(2)) }
    val norm = kernel.sum()
    val n = values.size
    return (0 until n).map { i ->
      var sum = 0.0
      for ((j, k) in kernel.withIndex()) sum += values[min(max(i + j - r, 0), n - 1)] * k
      sum / norm
    }
  }
}

/** People followed between samples, so stillness and movement are measured per person and in body heights. */
internal object FocusActivity {
  private class Item(val sample: Int, val box: FocusBox)

  private fun tracks(samples: List<FocusSample>, w0: Double, h0: Double, t: FocusTuning): List<List<Item>> {
    val items = ArrayList<MutableList<Item>>()
    val last = ArrayList<DoubleArray>() // x, y, h
    val seen = ArrayList<Double>()
    for ((i, s) in samples.withIndex()) {
      val now = s.tMs
      val open = items.indices.filter { now - seen[it] <= t.trackGapMs }
      class Pair3(val d: Double, val j: Int, val k: Int)
      val pairs = ArrayList<Pair3>()
      for ((j, b) in s.boxes.withIndex()) {
        val cxp = (b.x + b.width / 2) * w0
        val cyp = (b.y + b.height / 2) * h0
        for (k in open) {
          val l = last[k]
          val d = hypot(cxp - l[0], cyp - l[1]) / max(max(l[2], b.height * h0), 1e-9)
          if (d <= t.trackMatch) pairs.add(Pair3(d, j, k))
        }
      }
      pairs.sortWith { a, b -> if (a.d != b.d) a.d.compareTo(b.d) else if (a.j != b.j) a.j.compareTo(b.j) else a.k.compareTo(b.k) }
      val usedBoxes = HashSet<Int>()
      val usedTracks = HashSet<Int>()
      for (p in pairs) {
        if (usedBoxes.contains(p.j) || usedTracks.contains(p.k)) continue
        usedBoxes.add(p.j)
        usedTracks.add(p.k)
        val b = s.boxes[p.j]
        items[p.k].add(Item(i, b))
        last[p.k] = doubleArrayOf((b.x + b.width / 2) * w0, (b.y + b.height / 2) * h0, b.height * h0)
        seen[p.k] = now
      }
      for ((j, b) in s.boxes.withIndex()) {
        if (usedBoxes.contains(j)) continue
        items.add(mutableListOf(Item(i, b)))
        last.add(doubleArrayOf((b.x + b.width / 2) * w0, (b.y + b.height / 2) * h0, b.height * h0))
        seen.add(now)
      }
    }
    return items
  }

  /** Per sample: the people who count, in track order, each with their weight. */
  fun people(samples: List<FocusSample>, w0: Double, h0: Double, t: FocusTuning): List<List<Pair<FocusBox, Double>>> {
    val out = List(samples.size) { ArrayList<Pair<FocusBox, Double>>() }
    for (track in tracks(samples, w0, h0, t)) {
      val times = track.map { samples[it.sample].tMs }
      val feet = track.map { Pair((it.box.x + it.box.width / 2) * w0, (it.box.y + it.box.height) * h0) }
      val heights = track.map { it.box.height * h0 }
      val body = FocusPath.median(heights)
      val mx = FocusPath.median(feet.map { it.first })
      val my = FocusPath.median(feet.map { it.second })
      val reach = feet.maxOf { hypot(it.first - mx, it.second - my) } / max(body, 1e-9)
      if (times[times.size - 1] - times[0] >= t.spectatorMinMs && reach < t.stillBodies) continue
      for (a in track.indices) {
        val nearIdx = track.indices.filter { abs(times[it] - times[a]) <= t.activityWindowMs }
        val size = FocusPath.median(nearIdx.map { heights[it] })
        val win = track.indices.filter { abs(times[it] - times[a]) <= t.speedWindowMs }
        // Swift's min/max(by:) keep the first of equal times
        var q0 = win[0]
        var q1 = win[0]
        for (w in win) { if (times[w] < times[q0]) q0 = w; if (times[w] > times[q1]) q1 = w }
        val dt = (times[q1] - times[q0]) / 1000
        val speed = if (dt > 0) hypot(feet[q1].first - feet[q0].first, feet[q1].second - feet[q0].second) / max(size, 1e-9) / dt else 0.0
        out[track[a].sample].add(Pair(track[a].box, 1 + min(speed / t.speedUnit, t.moveCap)))
      }
    }
    return out
  }
}

/** The analysed frames put on the 100 ms grid the focus file promises: row k is at `startMs + k × stepMs`. */
object FocusGrid {
  fun samples(frames: List<FocusSample>, startMs: Double, endMs: Double, stepMs: Double): List<FocusSample> {
    val first = frames.firstOrNull() ?: return emptyList()
    val last = frames.last()
    if (stepMs <= 0) return emptyList()
    val stop = min(endMs, last.tMs + stepMs / 2)
    val out = ArrayList<FocusSample>()
    var i = 0
    var seen = first.boxes
    var tick = startMs
    while (tick < stop) {
      while (i < frames.size && frames[i].tMs < tick - 0.5) { seen = frames[i].boxes; i += 1 }
      if (i < frames.size && frames[i].tMs < tick + stepMs - 0.5) {
        seen = frames[i].boxes
        i += 1
      }
      out.add(FocusSample(tick, seen))
      tick += stepMs
    }
    return out
  }
}

object FocusRamp {
  /** The framing at a source time: linear between the two nearest keyframes, held outside them. */
  fun rect(tMs: Double, rects: List<FocusRect>, startMs: Double, stepMs: Double): FocusRect {
    val pos = (tMs - startMs) / stepMs
    if (pos <= 0) return rects[0]
    if (pos >= (rects.size - 1).toDouble()) return rects[rects.size - 1]
    val i = Math.floor(pos).toInt()
    val f = pos - i
    val a = rects[i]
    val b = rects[i + 1]
    fun mix(u: Double, v: Double) = u + (v - u) * f
    return FocusRect(mix(a.x, b.x), mix(a.y, b.y), mix(a.width, b.width), mix(a.height, b.height))
  }
}

/** A box in 0..1 of the frame with the origin at the TOP-left (the Swift side used CGRect with the bottom-left origin only inside Vision). */
object PersonBoxes {
  private fun area(r: FocusBox) = r.width * r.height

  private fun interArea(a: FocusBox, b: FocusBox): Double {
    val w = min(a.x + a.width, b.x + b.width) - max(a.x, b.x)
    val h = min(a.y + a.height, b.y + b.height) - max(a.y, b.y)
    return if (w > 0 && h > 0) w * h else 0.0
  }

  fun iou(a: FocusBox, b: FocusBox): Double {
    val i = interArea(a, b)
    if (i <= 0) return 0.0
    val u = area(a) + area(b) - i
    return if (u > 0) i / u else 0.0
  }

  /** The smaller of the two boxes is more than `over` inside the bigger one. */
  fun contained(a: FocusBox, b: FocusBox, over: Double = 0.7): Boolean {
    val inter = interArea(a, b)
    if (inter <= 0) return false
    val smaller = min(area(a), area(b))
    return smaller > 0 && inter / smaller > over
  }

  /** One box per person from the whole-frame pass and the tiles: the most confident of overlapping boxes wins. */
  fun merge(boxes: List<Pair<FocusBox, Double>>): List<FocusBox> {
    val keep = ArrayList<FocusBox>()
    for (b in boxes.sortedByDescending { it.second }) {
      val i = keep.indexOfFirst { contained(it, b.first) }
      if (i >= 0) {
        if (area(b.first) > area(keep[i])) keep[i] = b.first
      } else if (keep.none { iou(it, b.first) > 0.4 }) {
        keep.add(b.first)
      }
    }
    return keep
  }
}

object ScanTiles {
  /** 3 x 3 overlapping regions, each half the frame on both axes; the middle row first (where far players are). Origin top-left here: rows are [middle, top-of-the-bottom-origin order] kept as in Swift (bottom-left origin). */
  data class Region(val x: Double, val yBottom: Double, val width: Double, val height: Double)

  val regions: List<Region> = run {
    val order = intArrayOf(1, 0, 2) // rows, bottom-left origin: middle, bottom, top
    val out = ArrayList<Region>()
    for (row in order) for (col in 0 until 3) out.add(Region(col * 0.25, row * 0.25, 0.5, 0.5))
    out
  }

  /** The tiles to scan at the `index`-th sample when `perSample` are scanned each time (round-robin over all nine). */
  fun tiles(index: Int, perSample: Int): List<Region> {
    if (perSample <= 0) return emptyList()
    val n = regions.size
    val start = ((index * perSample) % n + n) % n
    return (0 until minOf(perSample, n)).map { regions[(start + it) % n] }
  }

  /** Small boxes from a tile are where the detector guesses most: keep only confident, person-shaped ones. */
  fun plausible(box: FocusBox, confidence: Double, frameWidth: Double, frameHeight: Double,
                minConfidence: Double = 0.5, minPixels: Double = 28.0): Boolean {
    val h = box.height * frameHeight
    val w = box.width * frameWidth
    if (confidence < minConfidence || h < minPixels || w <= 0) return false
    val aspect = h / w
    return aspect in 0.9..6.0
  }
}
