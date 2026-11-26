package expo.modules.replaycamera

import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * The shared clip's cut on a real phone (`ClipCut`): a 3 s clip with a key frame each second and sound
 * (`assets/cut-source.mp4`), cut from 1.3 s to 2.0 s, as a share does.
 */
@RunWith(AndroidJUnit4::class)
class ClipCutDeviceTest {
  private val context = InstrumentationRegistry.getInstrumentation().context

  private fun source(): String {
    val file = File(context.cacheDir, "cut-source.mp4")
    context.assets.open("cut-source.mp4").use { input -> file.outputStream().use { input.copyTo(it) } }
    return file.path
  }

  private fun tracks(path: String): Map<String, List<Long>> {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
      return (0 until extractor.trackCount).associate { i ->
        val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME)!!.substringBefore('/')
        val e = MediaExtractor().apply { setDataSource(path); selectTrack(i) }
        val times = mutableListOf<Long>()
        while (e.sampleTime != -1L) {
          times += e.sampleTime
          if (!e.advance()) break
        }
        e.release()
        mime to times
      }
    } finally {
      extractor.release()
    }
  }

  // The test clip's sound starts at -21 ms (AAC priming), as many files do: the cut must still copy it.
  @Test fun theCutStartsAtItsStartWithPictureAndSound() {
    val out = File(context.cacheDir, "cut/1-video.mp4").path
    val (path, ms) = ClipCut.cut("file://${source()}", "file://$out", 1300.0, 2000.0, muted = false)
    assertEquals(out, path)
    assertEquals(700L, ms)
    val t = tracks(out)
    val video = t["video"]!!
    // 9 frames from the 1.0 s key frame squeezed in, then 0.7 s at 30 fps.
    assertEquals(0L, video.first())
    assertTrue("picture ends before 0.7 s: ${video.last()}", video.last() < 700_000)
    assertEquals(9 + 21, video.size)
    val sound = t["audio"]!!
    assertTrue("sound starts at the cut: ${sound.first()}", sound.first() < 30_000)
    assertTrue("sound ends by 0.7 s: ${sound.last()}", sound.last() < 700_000)

    val retriever = MediaMetadataRetriever()
    retriever.setDataSource(out)
    val length = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()
    assertTrue("the file lasts about 0.7 s: $length", length in 650..750)
    assertNotNull("the first frame decodes", retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST))
    assertNotNull("a frame in the middle decodes", retriever.getFrameAtTime(400_000, MediaMetadataRetriever.OPTION_CLOSEST))
    retriever.release()
  }

  @Test fun aMutedCutHasNoSoundTrack() {
    val out = File(context.cacheDir, "cut/2-video.mp4").path
    ClipCut.cut(source(), out, 0.0, 3000.0, muted = true)
    val t = tracks(out)
    assertEquals(setOf("video"), t.keys)
    assertEquals(90, t["video"]!!.size)
  }
}
