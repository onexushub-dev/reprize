package expo.modules.replaycamera.remote

import org.json.JSONObject

/** Standard base64 with padding, as Foundation writes it (java.util.Base64: API 26+, and real in JVM unit tests). */
internal object B64 {
  fun encode(bytes: ByteArray): String = java.util.Base64.getEncoder().encodeToString(bytes)

  fun decode(text: String): ByteArray? = runCatching { java.util.Base64.getDecoder().decode(text) }.getOrNull()
}

/**
 * What the camera phone and the remote phone say once connected (ReplayCore `RemoteMessage`, same JSON keys, so an
 * Android phone and an iPhone understand each other). Decoding never throws: a stray message must never save a clip.
 */
sealed class RemoteMessage {
  /** Why the camera phone refused a pairing attempt. */
  enum class Reason(val raw: String) {
    EXPIRED("expired"), LOCKED("locked"), WRONG("wrong"), USED("used"), CLOSED("closed");

    companion object {
      fun of(raw: String?): Reason? = values().firstOrNull { it.raw == raw }
    }
  }

  object Save : RemoteMessage()
  object Stop : RemoteMessage()
  object Start : RemoteMessage()
  data class Preview(val on: Boolean) : RemoteMessage()
  object Forget : RemoteMessage()
  data class State(val recording: Boolean, val clipCount: Int, val startedAt: Double?) : RemoteMessage()
  data class Result(val saved: Boolean) : RemoteMessage()
  class Paired(val hostId: String, val hostName: String, val pairKey: ByteArray) : RemoteMessage()
  object Unpaired : RemoteMessage()
  data class Refused(val reason: Reason) : RemoteMessage()
  data class Ping(val token: String) : RemoteMessage()
  data class Pong(val token: String) : RemoteMessage()
  class PreviewLink(val service: String, val token: ByteArray, val key: ByteArray) : RemoteMessage()

  fun json(): JSONObject = when (this) {
    Save -> JSONObject().put("cmd", "save")
    Stop -> JSONObject().put("cmd", "stop")
    Forget -> JSONObject().put("cmd", "forget")
    Start -> JSONObject().put("cmd", "start")
    is Preview -> JSONObject().put("cmd", "preview").put("on", on)
    is State -> JSONObject().put("recording", recording).put("clipCount", clipCount)
      .also { o -> startedAt?.let { o.put("startedAt", it) } }
    is Result -> JSONObject().put("result", if (saved) "saved" else "failed")
    is Paired -> JSONObject().put("paired", JSONObject().put("hostId", hostId).put("hostName", hostName).put("key", B64.encode(pairKey)))
    Unpaired -> JSONObject().put("unpaired", true)
    is Refused -> JSONObject().put("refused", reason.raw)
    is Ping -> JSONObject().put("ping", token)
    is Pong -> JSONObject().put("pong", token)
    is PreviewLink -> JSONObject().put("previewLink",
      JSONObject().put("service", service).put("token", B64.encode(token)).put("key", B64.encode(key)))
  }

  val data: ByteArray get() = json().toString().toByteArray()

  companion object {
    fun decode(data: ByteArray): RemoteMessage? = runCatching { decode(JSONObject(String(data))) }.getOrNull()

    fun decode(o: JSONObject): RemoteMessage? {
      if (o.has("cmd")) {
        return when (o.optString("cmd")) {
          "save" -> Save
          "stop" -> Stop
          "forget" -> Forget
          "start" -> Start
          "preview" -> (o.opt("on") as? Boolean)?.let { Preview(it) }
          else -> null
        }
      }
      (o.opt("ping") as? String)?.let { if (it.isNotEmpty() && it.length <= 64) return Ping(it) }
      (o.opt("pong") as? String)?.let { if (it.isNotEmpty() && it.length <= 64) return Pong(it) }
      if (o.has("previewLink")) {
        val link = o.optJSONObject("previewLink") ?: return null
        val service = link.optString("service")
        val token = B64.decode(link.optString("token")) ?: return null
        val key = B64.decode(link.optString("key")) ?: return null
        if (service.isEmpty() || service.length > 63 || token.size != 16 || key.size != 32) return null
        return PreviewLink(service, token, key)
      }
      if (o.has("unpaired")) return if (o.opt("unpaired") == true) Unpaired else null
      if (o.has("refused")) return Reason.of(o.opt("refused") as? String)?.let { Refused(it) }
      if (o.has("paired")) {
        val p = o.optJSONObject("paired") ?: return null
        val hostId = p.opt("hostId") as? String ?: return null
        val hostName = p.opt("hostName") as? String ?: return null
        val key = B64.decode(p.optString("key")) ?: return null
        if (key.size != 32) return null
        return Paired(hostId, hostName, key)
      }
      (o.opt("result") as? String)?.let {
        return when (it) {
          "saved" -> Result(true)
          "failed" -> Result(false)
          else -> null
        }
      }
      val recording = o.opt("recording") as? Boolean ?: return null
      val count = (o.opt("clipCount") as? Number)?.toInt() ?: return null
      if (count < 0) return null
      val startedAt = (o.opt("startedAt") as? Number)?.toDouble()
      return State(recording, count, startedAt)
    }
  }
}

/** A phone this one trusts: the camera phone keeps its remotes, a remote phone keeps its camera phone. */
class TrustedPeer(val id: String, val name: String, val key: ByteArray)

/** Where the trusted list lives (the app: encrypted preferences; tests: memory). */
interface PeerKeyStore {
  fun load(): List<TrustedPeer>
  fun save(peers: List<TrustedPeer>)
}

/** ReplayCore `TrustedPeers`: oldest first, at most four, a peer paired again moves to the end. */
class TrustedPeers(private val store: PeerKeyStore) {
  companion object { const val LIMIT = 4 }

  private val peers = store.load().toMutableList()

  val all: List<TrustedPeer> get() = peers.toList()

  fun peer(id: String): TrustedPeer? = peers.firstOrNull { it.id == id }

  fun add(peer: TrustedPeer): Boolean {
    val index = peers.indexOfFirst { it.id == peer.id }
    if (index >= 0) peers.removeAt(index) else if (peers.size >= LIMIT) return false
    peers.add(peer)
    store.save(peers)
    return true
  }

  fun keepNewest(count: Int): List<TrustedPeer> {
    if (peers.size <= count) return emptyList()
    val dropped = peers.take(peers.size - maxOf(0, count))
    repeat(dropped.size) { peers.removeAt(0) }
    store.save(peers)
    return dropped
  }

  fun remove(id: String) {
    if (peers.removeAll { it.id == id }) store.save(peers)
  }
}

/**
 * One pairing attempt on the camera phone (ReplayCore `PairingOffer`): a QR secret and a 6-digit code that stop working
 * after two minutes or five wrong proofs. A good proof only reserves the offer; the host spends it when the pairing is done.
 */
class PairingOffer(val hostId: String, val hostName: String, val secret: ByteArray, val code: String, val createdAt: Double) {
  companion object {
    const val VALID_FOR = 120.0
    const val MAX_ATTEMPTS = 5

    fun make(hostId: String, hostName: String, now: Double): PairingOffer {
      val code = "%06d".format(java.security.SecureRandom().nextInt(1_000_000))
      return PairingOffer(hostId, hostName, BleCrypto.randomBytes(16), code, now)
    }
  }

  sealed class Verdict {
    object Accepted : Verdict()
    data class WrongProof(val attemptsLeft: Int) : Verdict()
    object Expired : Verdict()
    object Locked : Verdict()
    object Taken : Verdict()
  }

  var failedAttempts = 0
    private set
  var reservedFor: String? = null
    private set

  fun check(remoteId: String, now: Double, proves: (ByteArray) -> Boolean): Verdict {
    if (isExpired(now)) return Verdict.Expired
    if (failedAttempts >= MAX_ATTEMPTS) return Verdict.Locked
    for (key in listOf(secret, code.toByteArray())) {
      if (!proves(key)) continue
      val holder = reservedFor
      if (holder != null && holder != remoteId) return Verdict.Taken
      reservedFor = remoteId
      return Verdict.Accepted
    }
    failedAttempts++
    return Verdict.WrongProof(MAX_ATTEMPTS - failedAttempts)
  }

  fun release(remoteId: String) {
    if (reservedFor == remoteId) reservedFor = null
  }

  fun isExpired(now: Double) = now - createdAt > VALID_FOR * 1000

  val isLocked get() = failedAttempts >= MAX_ATTEMPTS

  /** What the QR code holds; the remote phone's camera app opens it and the app lands on `/pair`. */
  val qrUrl: String
    get() {
      val name = java.net.URLEncoder.encode(hostName, "UTF-8").replace("+", "%20")
      val encodedSecret = B64.encode(secret).replace("+", "-").replace("/", "_").replace("=", "")
      return "reprize://pair?h=$hostId&s=$encodedSecret&n=$name"
    }
}
