package expo.modules.replaycamera.ball

import org.json.JSONArray
import org.json.JSONObject

/** The Swift core's fixtures (`ios/Core/Tests/ReplayCoreTests/Fixtures`), on the test classpath. */
fun fixture(name: String): JSONObject =
  JSONObject(Thread.currentThread().contextClassLoader!!.getResource(name)!!.readText())

fun JSONArray.doubles(): List<Double> = (0 until length()).map { getDouble(it) }
