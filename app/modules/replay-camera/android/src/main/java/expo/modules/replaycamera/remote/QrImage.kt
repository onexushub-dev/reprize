package expo.modules.replaycamera.remote

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.io.File

/** The pairing QR as a PNG the screen shows (iOS `QRCode.png`). */
internal object QrImage {
  private const val SIZE = 512

  fun png(text: String, file: File): File? = runCatching {
    val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2)
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, SIZE, SIZE, hints)
    val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
    for (x in 0 until SIZE) for (y in 0 until SIZE) bitmap.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    file
  }.getOrNull()
}
