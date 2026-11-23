package expo.modules.replaycamera.ball

import org.json.JSONArray
import org.json.JSONObject

/** The Swift core's fixtures (`ios/Core/Tests/ReplayCoreTests/Fixtures`), on the test classpath. */
fun fixture(name: String): JSONObject =
  JSONObject(Thread.currentThread().contextClassLoader!!.getResource(name)!!.readText())

fun JSONArray.doubles(): List<Double> = (0 until length()).map { getDouble(it) }

/** A fixture case's frames: one entry per 100 ms frame, null where it was not analysed; candidates cx, cy, w, h, score. */
fun candidateFrames(a: JSONArray): List<List<BallCandidate>?> = (0 until a.length()).map { i ->
  if (a.isNull(i)) null else a.getJSONArray(i).let { f ->
    (0 until f.length()).map { j -> f.getJSONArray(j).doubles().let { BallCandidate(it[0], it[1], it[2], it[3], it[4]) } }
  }
}

/** Rows of boxes per frame (person boxes), or rows of numbers (rects). */
fun boxRows(a: JSONArray?): List<List<List<Double>>> = if (a == null) emptyList() else (0 until a.length()).map { i ->
  a.getJSONArray(i).let { r -> (0 until r.length()).map { r.getJSONArray(it).doubles() } }
}

fun rows(a: JSONArray): List<List<Double>> = (0 until a.length()).map { a.getJSONArray(it).doubles() }

/** Rows that may be null. */
fun optRows(a: JSONArray): List<List<Double>?> = (0 until a.length()).map { if (a.isNull(it)) null else a.getJSONArray(it).doubles() }
