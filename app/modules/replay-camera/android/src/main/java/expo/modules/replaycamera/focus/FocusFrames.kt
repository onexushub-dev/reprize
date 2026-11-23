package expo.modules.replaycamera.focus

import org.json.JSONArray
import org.json.JSONObject

/**
 * The people found in each analysed picture of a clip, kept next to it (`<clip>.people.json`, port of
 * `FocusFrames.swift`): a stopped analysis goes on from here. Boxes are kept exactly as found.
 */
object FocusFrames {
  fun json(frames: List<FocusSample>, width: Int, height: Int): JSONObject =
    JSONObject().put("v", 1).put("size", JSONArray(listOf(width, height))).put("frames", JSONArray(frames.sortedBy { it.tMs }.map { f ->
      JSONObject().put("t", f.tMs).put("b", JSONArray(f.boxes.map { JSONArray(listOf(it.x, it.y, it.width, it.height)) }))
    }))

  /** Anything unreadable, another version or another video size gives an empty cache. */
  fun read(json: JSONObject?, width: Int, height: Int): List<FocusSample> {
    val f = json ?: return emptyList()
    return try {
      if (f.optInt("v") != 1) return emptyList()
      val size = f.getJSONArray("size")
      if (size.length() != 2 || size.getInt(0) != width || size.getInt(1) != height) return emptyList()
      val frames = f.getJSONArray("frames")
      (0 until frames.length()).mapNotNull { i ->
        val fr = frames.getJSONObject(i)
        val b = fr.optJSONArray("b")
        if (!fr.has("t") || b == null) return@mapNotNull null
        FocusSample(fr.getDouble("t"), (0 until b.length()).mapNotNull { j ->
          val v = b.getJSONArray(j)
          if (v.length() == 4) FocusBox(v.getDouble(0), v.getDouble(1), v.getDouble(2), v.getDouble(3)) else null
        })
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  /** Both lists in time order; of two frames at the same time, the one from `new`. */
  fun merged(old: List<FocusSample>, new: List<FocusSample>): List<FocusSample> {
    val times = new.map { it.tMs }.toSet()
    return (old.filter { it.tMs !in times } + new).sortedBy { it.tMs }
  }
}
