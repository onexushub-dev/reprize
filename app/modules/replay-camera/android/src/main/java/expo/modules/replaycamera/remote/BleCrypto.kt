package expo.modules.replaycamera.remote

import java.math.BigInteger
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The crypto of the phone remote, byte for byte what the iPhone does with CryptoKit (ReplayCore `BleCrypto`,
 * `BleSession`, `Curve25519.KeyAgreement`): HMAC-SHA256, HKDF-SHA256, ChaCha20-Poly1305 and X25519. Pinned by
 * `remote-vectors.json`, written by the Swift core.
 */
object BleCrypto {
  private val random = SecureRandom()

  fun randomBytes(count: Int): ByteArray = ByteArray(count).also(random::nextBytes)

  fun hmac(key: ByteArray, message: ByteArray): ByteArray =
    Mac.getInstance("HmacSHA256").run {
      init(SecretKeySpec(key, "HmacSHA256"))
      doFinal(message)
    }

  /** HMAC-SHA256 of `label | transcript` under `key`. */
  fun mac(key: ByteArray, label: String, transcript: ByteArray): ByteArray = hmac(key, label.toByteArray() + transcript)

  fun equal(a: ByteArray, b: ByteArray): Boolean {
    if (a.size != b.size) return false
    var difference = 0
    for (i in a.indices) difference = difference or (a[i].toInt() xor b[i].toInt())
    return difference == 0
  }

  /** HKDF-SHA256 (RFC 5869), 32 bytes, as CryptoKit's `HKDF.deriveKey` / `hkdfDerivedSymmetricKey`. */
  fun hkdf(secret: ByteArray, salt: ByteArray, info: ByteArray, length: Int = 32): ByteArray {
    val prk = hmac(if (salt.isEmpty()) ByteArray(32) else salt, secret)
    val out = ByteArray(length)
    var previous = ByteArray(0)
    var written = 0
    var counter = 1
    while (written < length) {
      previous = hmac(prk, previous + info + byteArrayOf(counter.toByte()))
      val take = minOf(previous.size, length - written)
      System.arraycopy(previous, 0, out, written, take)
      written += take
      counter++
    }
    return out
  }

  /** 32-byte session key from a shared secret, bound to this exact handshake. */
  fun sessionKey(secret: ByteArray, transcript: ByteArray, info: String): ByteArray =
    hkdf(secret, transcript, info.toByteArray())

  private fun chacha(mode: Int, key: ByteArray, nonce: ByteArray): Cipher {
    // Android (Conscrypt, API 28+) and the JVM name it differently.
    val cipher = runCatching { Cipher.getInstance("ChaCha20/Poly1305/NoPadding") }
      .getOrElse { Cipher.getInstance("ChaCha20-Poly1305") }
    cipher.init(mode, SecretKeySpec(key, "ChaCha20"), IvParameterSpec(nonce))
    return cipher
  }

  /** Ciphertext followed by the 16-byte tag, like CryptoKit's `ciphertext + tag`. */
  fun seal(key: ByteArray, nonce: ByteArray, plain: ByteArray): ByteArray = chacha(Cipher.ENCRYPT_MODE, key, nonce).doFinal(plain)

  /** Null when the tag does not match. */
  fun open(key: ByteArray, nonce: ByteArray, sealed: ByteArray): ByteArray? =
    runCatching { chacha(Cipher.DECRYPT_MODE, key, nonce).doFinal(sealed) }.getOrNull()
}

/**
 * X25519 (RFC 7748), what CryptoKit's `Curve25519.KeyAgreement` computes. Android has it natively only from API 33, so
 * the ladder is written here (it runs once per pairing, on keys made for that pairing only).
 */
object X25519 {
  private val P: BigInteger = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19))
  private val A24: BigInteger = BigInteger.valueOf(121665)
  private val BASE = ByteArray(32).also { it[0] = 9 }

  fun newPrivateKey(): ByteArray = BleCrypto.randomBytes(32)

  fun publicKey(privateKey: ByteArray): ByteArray = scalarMult(privateKey, BASE)

  /** Null for a peer key that gives the all-zero secret (a low-order point), which CryptoKit refuses too. */
  fun sharedSecret(privateKey: ByteArray, peerPublic: ByteArray): ByteArray? {
    if (peerPublic.size != 32) return null
    val out = scalarMult(privateKey, peerPublic)
    return if (out.all { it == 0.toByte() }) null else out
  }

  private fun decodeLittle(bytes: ByteArray): BigInteger = BigInteger(1, bytes.reversedArray())

  private fun encodeLittle(value: BigInteger): ByteArray {
    val big = value.mod(P).toByteArray()
    val out = ByteArray(32)
    for (i in big.indices) {
      val position = big.size - 1 - i
      if (position < 32) out[position] = big[i]
    }
    return out
  }

  fun scalarMult(scalar: ByteArray, u: ByteArray): ByteArray {
    require(scalar.size == 32 && u.size == 32)
    val k = scalar.copyOf()
    k[0] = (k[0].toInt() and 248).toByte()
    k[31] = (k[31].toInt() and 127).toByte()
    k[31] = (k[31].toInt() or 64).toByte()
    val uMasked = u.copyOf().also { it[31] = (it[31].toInt() and 127).toByte() }
    val x1 = decodeLittle(uMasked).mod(P)
    val kInt = decodeLittle(k)

    var x2 = BigInteger.ONE
    var z2 = BigInteger.ZERO
    var x3 = x1
    var z3 = BigInteger.ONE
    var swap = 0
    for (t in 254 downTo 0) {
      val bit = if (kInt.testBit(t)) 1 else 0
      swap = swap xor bit
      if (swap == 1) {
        x2 = x3.also { x3 = x2 }
        z2 = z3.also { z3 = z2 }
      }
      swap = bit
      val a = x2.add(z2).mod(P)
      val aa = a.multiply(a).mod(P)
      val b = x2.subtract(z2).mod(P)
      val bb = b.multiply(b).mod(P)
      val e = aa.subtract(bb).mod(P)
      val c = x3.add(z3).mod(P)
      val d = x3.subtract(z3).mod(P)
      val da = d.multiply(a).mod(P)
      val cb = c.multiply(b).mod(P)
      x3 = da.add(cb).pow(2).mod(P)
      z3 = x1.multiply(da.subtract(cb).pow(2)).mod(P)
      x2 = aa.multiply(bb).mod(P)
      z2 = e.multiply(aa.add(A24.multiply(e))).mod(P)
    }
    if (swap == 1) {
      x2 = x3.also { x3 = x2 }
      z2 = z3.also { z3 = z2 }
    }
    return encodeLittle(x2.multiply(z2.modPow(P.subtract(BigInteger.valueOf(2)), P)))
  }
}

/** What opens every message on the BLE link: a handshake step (JSON) or, once the handshake is done, a sealed message. */
object BleWire {
  const val HANDSHAKE: Byte = 0x01
  const val SEALED: Byte = 0x02
  const val NONCE_SIZE = 16
}

/**
 * The encrypted link after a handshake (ReplayCore `BleSession`): ChaCha20-Poly1305 under the session key, the nonce is
 * the sender's side ("H"/"R" + 3 zero bytes) plus a counter that only goes up, so nothing can be read, changed or
 * replayed. Wire: `[0x02][counter, 8 bytes big-endian][ciphertext][tag, 16 bytes]`.
 */
class BleSession(private val key: ByteArray, val side: Side) {
  enum class Side { HOST, REMOTE }

  private var sent = 0L
  private var received = 0L

  fun seal(plain: ByteArray): ByteArray {
    val counter = sent + 1
    val box = BleCrypto.seal(key, nonce(side, counter), plain)
    sent = counter
    return byteArrayOf(BleWire.SEALED) + bigEndian(counter) + box
  }

  /** Null for anything that is not a newer message from the other side sealed with this key. */
  fun open(wire: ByteArray): ByteArray? {
    if (wire.size < 1 + 8 + 16 || wire[0] != BleWire.SEALED) return null
    var counter = 0L
    for (i in 1..8) counter = (counter shl 8) or (wire[i].toLong() and 0xFF)
    if (java.lang.Long.compareUnsigned(counter, received) <= 0) return null
    val other = if (side == Side.HOST) Side.REMOTE else Side.HOST
    val plain = BleCrypto.open(key, nonce(other, counter), wire.copyOfRange(9, wire.size)) ?: return null
    received = counter
    return plain
  }

  private companion object {
    fun nonce(side: Side, counter: Long): ByteArray =
      byteArrayOf(if (side == Side.HOST) 0x48 else 0x52, 0, 0, 0) + bigEndian(counter)

    fun bigEndian(value: Long): ByteArray = ByteArray(8) { i -> (value ushr (56 - 8 * i)).toByte() }
  }
}

/**
 * Splits a message into frames that fit one BLE write or notification, and puts them back together (ReplayCore
 * `BleFrames`). Frame: `[id hi][id lo][index][count][payload…]`; a message is capped at 4096 bytes and 255 frames.
 */
object BleFrames {
  const val HEADER_SIZE = 4
  const val MAX_MESSAGE = 4096

  fun split(message: ByteArray, id: Int, maxFrame: Int): List<ByteArray> {
    val room = maxFrame - HEADER_SIZE
    if (message.isEmpty() || message.size > MAX_MESSAGE || room <= 0) return emptyList()
    val count = (message.size + room - 1) / room
    if (count > 255) return emptyList()
    return (0 until count).map { index ->
      val start = index * room
      val end = minOf(start + room, message.size)
      byteArrayOf((id shr 8).toByte(), id.toByte(), index.toByte(), count.toByte()) + message.copyOfRange(start, end)
    }
  }

  /** Collects frames per message id; a message whose frames do not all arrive within `timeout` seconds is dropped. */
  class Assembler(private val timeout: Double = 2.0) {
    private class Partial(val count: Int, val firstAt: Double) {
      val parts = HashMap<Int, ByteArray>()
    }

    private val partials = HashMap<Int, Partial>()

    /** `now` in seconds. Returns the whole message when this frame completes it. */
    fun add(frame: ByteArray, now: Double): ByteArray? {
      partials.entries.removeAll { now - it.value.firstAt > timeout }
      if (frame.size <= HEADER_SIZE) return null
      val id = ((frame[0].toInt() and 0xFF) shl 8) or (frame[1].toInt() and 0xFF)
      val index = frame[2].toInt() and 0xFF
      val count = frame[3].toInt() and 0xFF
      if (count == 0 || index >= count) return null
      val payload = frame.copyOfRange(HEADER_SIZE, frame.size)
      if (count == 1) return payload
      val partial = partials.getOrPut(id) { Partial(count, now) }
      if (partial.count != count) {
        partials.remove(id)
        return null
      }
      partial.parts[index] = payload
      if (partial.parts.values.sumOf { it.size } > MAX_MESSAGE) {
        partials.remove(id)
        return null
      }
      if (partial.parts.size < count) return null
      partials.remove(id)
      var whole = ByteArray(0)
      for (i in 0 until count) whole += partial.parts[i] ?: return null
      return whole
    }
  }
}
