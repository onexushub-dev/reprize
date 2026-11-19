package expo.modules.replaycamera

import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.util.Log
import expo.modules.replaycamera.core.SportFloor
import java.nio.ByteBuffer

/**
 * Which sport a recording looks like, on Android (the side of `SportCheck.swift` that is not Apple's): no scene
 * classifier here, only the floor of three frames of the range (20%, 50%, 80%), `SportFloor`, under the keys
 * "_floorSand" and "_floorTex". The rule lives in JS (`focus/sportCheck.ts`): a sand court is beach tennis.
 */
object SportCheck {
  fun classify(clipPath: String, startMs: Double, endMs: Double): Map<String, Double> {
    val r = MediaMetadataRetriever()
    val measures = ArrayList<SportFloor.Measure>()
    try {
      r.setDataSource(clipPath)
      val rotation = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val storedW = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val storedH = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      for (f in listOf(0.2, 0.5, 0.8)) {
        val t = ((startMs + (endMs - startMs) * f) * 1000).toLong()
        val raw = r.getScaledFrameAtTime(t, MediaMetadataRetriever.OPTION_CLOSEST, 1280, 1280) ?: continue
        // the floor is the bottom of the upright picture: turned like ClipThumbnail, only when the device did not already
        val quarter = rotation == 90 || rotation == 270
        val alreadyTurned = quarter && storedW != storedH && (raw.width > raw.height) == (storedH > storedW)
        val frame = if (rotation == 0 || alreadyTurned) raw else
          Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation.toFloat()) }, true).also { raw.recycle() }
        val h = maxOf(1, Math.round(frame.height.toDouble() * SportFloor.width / frame.width).toInt())
        val small = Bitmap.createScaledBitmap(frame.copy(Bitmap.Config.ARGB_8888, false), SportFloor.width, h, true)
        val buf = ByteBuffer.allocate(small.byteCount)
        small.copyPixelsToBuffer(buf) // ARGB_8888 is stored R, G, B, A in memory
        SportFloor.measure(buf.array(), SportFloor.width, h)?.let { measures.add(it) }
        small.recycle()
        frame.recycle()
      }
    } catch (e: Exception) {
      Log.w("ReprizeSport", "floor check failed: $e")
    } finally {
      r.release()
    }
    return SportFloor.labels(measures)
  }
}
