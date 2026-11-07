@file:OptIn(UnstableApi::class)

package expo.modules.replaycamera

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.Crop
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import java.io.File
import java.util.UUID

/**
 * Renders a Story/share video from a saved clip with Media3 Transformer: the cut, optional speed change
 * (audio removed) or mute, an extra clockwise turn, the video (or the part of it the player zoomed to) fit in a
 * width×height frame, and a full-frame PNG overlay on top. Same result as the iOS ClipExporter.
 */
object ClipExporter {
  data class Options(
    val clipPath: String,
    val startMs: Long,
    val endMs: Long,
    val speed: Float,
    val muted: Boolean,
    /** Extra clockwise turn in degrees (0, 90, 180, 270) on top of the clip's own rotation. */
    val rotation: Int,
    /** The visible part of the video, 0..1 of its (turned) size, origin top-left; null = all of it. */
    val crop: Crop01?,
    val width: Int,
    val height: Int,
    val overlayPngPath: String?,
  )

  data class Crop01(val x: Double, val y: Double, val width: Double, val height: Double)

  fun export(context: Context, o: Options, onDone: (String, Long) -> Unit, onError: (Throwable) -> Unit) {
    val dir = File(context.cacheDir, "exports").apply { mkdirs() }
    val out = File(dir, "${UUID.randomUUID()}.mp4")
    val slow = o.speed != 1f // any speed but 1x drops the sound

    val item = MediaItem.Builder()
      .setUri(Uri.fromFile(File(o.clipPath)))
      .setClippingConfiguration(
        MediaItem.ClippingConfiguration.Builder().setStartPositionMs(o.startMs).setEndPositionMs(o.endMs).build()
      )
      .build()

    val videoEffects = mutableListOf<Effect>()
    if (slow) videoEffects += SpeedChangeEffect(o.speed)
    val turn = ((o.rotation % 360) + 360) % 360
    // Media3 turns counterclockwise; the app's turn is clockwise (as on iOS).
    if (turn != 0) videoEffects += ScaleAndRotateTransformation.Builder().setRotationDegrees((360 - turn).toFloat()).build()
    o.crop?.let { c ->
      // Media3 crops in normalized device coordinates: -1..1, y pointing up.
      val left = (2 * c.x - 1).toFloat().coerceIn(-1f, 1f)
      val right = (2 * (c.x + c.width) - 1).toFloat().coerceIn(-1f, 1f)
      val top = (1 - 2 * c.y).toFloat().coerceIn(-1f, 1f)
      val bottom = (1 - 2 * (c.y + c.height)).toFloat().coerceIn(-1f, 1f)
      if (right > left && top > bottom) videoEffects += Crop(left, right, bottom, top)
    }
    videoEffects += Presentation.createForWidthAndHeight(o.width, o.height, Presentation.LAYOUT_SCALE_TO_FIT)
    o.overlayPngPath?.let(BitmapFactory::decodeFile)?.let { bitmap ->
      // Captured at exactly width×height, so the template bands line up with the frame.
      videoEffects += OverlayEffect(listOf<TextureOverlay>(BitmapOverlay.createStaticBitmapOverlay(bitmap)))
    }

    val edited = EditedMediaItem.Builder(item)
      .setRemoveAudio(o.muted || slow)
      .setEffects(Effects(listOf(), videoEffects))
      .build()

    // Transformer must be built and started on a thread with a Looper.
    Handler(Looper.getMainLooper()).post {
      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, result: ExportResult) {
            onDone(out.path, result.durationMs)
          }

          override fun onError(composition: Composition, result: ExportResult, exception: ExportException) {
            out.delete() // never leave a partial file behind
            onError(exception)
          }
        })
        .build()
      runCatching { transformer.start(edited, out.path) }.onFailure {
        out.delete()
        onError(it)
      }
    }
  }
}
