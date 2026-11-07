package expo.modules.replaycamera.remote

import org.json.JSONObject

/** Why a remote phone opens a link: to pair with a code or QR, or to reconnect with its pair key. */
enum class BleLinkKind(val raw: String) { PAIR("pair"), RECONNECT("reconnect") }

/**
 * The four handshake steps of the BLE link (ReplayCore `BleHandshakeMessage`, same JSON, so an Android phone and an
 * iPhone pair and reconnect with each other):
 *
 *     remote → hello      { kind, remoteId, remoteName, nonce, pub (pairing only) }
 *     host   → challenge  { hostId, hostName, nonce, pub (pairing only), hostProof (reconnect only) }
 *     remote → proof      { proof }
 *     host   → accept     { hostProof + sealed `paired` (pairing only) }   or  refused / unpaired
 */
sealed class BleHandshakeMessage {
  data class Hello(val kind: BleLinkKind, val remoteId: String, val remoteName: String, val nonce: ByteArray, val pub: ByteArray?) :
    BleHandshakeMessage()
  data class Challenge(val hostId: String, val hostName: String, val nonce: ByteArray, val pub: ByteArray?, val hostProof: ByteArray?) :
    BleHandshakeMessage()
  class Proof(val proof: ByteArray) : BleHandshakeMessage()
  class Accept(val hostProof: ByteArray?, val paired: ByteArray?) : BleHandshakeMessage()
  data class Refused(val reason: RemoteMessage.Reason) : BleHandshakeMessage()
  object Unpaired : BleHandshakeMessage()

  val wire: ByteArray
    get() {
      val o = JSONObject()
      when (this) {
        is Hello -> {
          o.put("t", "hello").put("kind", kind.raw).put("remoteId", remoteId).put("remoteName", remoteName).put("nonce", B64.encode(nonce))
          pub?.let { o.put("pub", B64.encode(it)) }
        }
        is Challenge -> {
          o.put("t", "challenge").put("hostId", hostId).put("hostName", hostName).put("nonce", B64.encode(nonce))
          pub?.let { o.put("pub", B64.encode(it)) }
          hostProof?.let { o.put("hostProof", B64.encode(it)) }
        }
        is Proof -> o.put("t", "proof").put("proof", B64.encode(proof))
        is Accept -> {
          o.put("t", "accept")
          hostProof?.let { o.put("hostProof", B64.encode(it)) }
          paired?.let { o.put("paired", B64.encode(it)) }
        }
        is Refused -> o.put("t", "refused").put("reason", reason.raw)
        Unpaired -> o.put("t", "unpaired")
      }
      return byteArrayOf(BleWire.HANDSHAKE) + o.toString().toByteArray()
    }

  companion object {
    fun decode(wire: ByteArray): BleHandshakeMessage? {
      if (wire.size <= 1 || wire[0] != BleWire.HANDSHAKE) return null
      val o = runCatching { JSONObject(String(wire, 1, wire.size - 1)) }.getOrNull() ?: return null
      fun bytes(key: String): ByteArray? = (o.opt(key) as? String)?.let(B64::decode)
      return when (o.opt("t")) {
        "hello" -> {
          val kind = BleLinkKind.values().firstOrNull { it.raw == o.opt("kind") } ?: return null
          val remoteId = (o.opt("remoteId") as? String)?.takeIf { it.isNotEmpty() } ?: return null
          val remoteName = o.opt("remoteName") as? String ?: return null
          val nonce = bytes("nonce")?.takeIf { it.size == BleWire.NONCE_SIZE } ?: return null
          Hello(kind, remoteId, remoteName, nonce, bytes("pub"))
        }
        "challenge" -> {
          val hostId = (o.opt("hostId") as? String)?.takeIf { it.isNotEmpty() } ?: return null
          val hostName = o.opt("hostName") as? String ?: return null
          val nonce = bytes("nonce")?.takeIf { it.size == BleWire.NONCE_SIZE } ?: return null
          Challenge(hostId, hostName, nonce, bytes("pub"), bytes("hostProof"))
        }
        "proof" -> bytes("proof")?.let { Proof(it) }
        "accept" -> Accept(bytes("hostProof"), bytes("paired"))
        "refused" -> RemoteMessage.Reason.of(o.opt("reason") as? String)?.let { Refused(it) }
        "unpaired" -> Unpaired
        else -> null
      }
    }

    fun transcript(kind: BleLinkKind, remoteId: String, hostId: String, remoteNonce: ByteArray, hostNonce: ByteArray,
                   remotePub: ByteArray, hostPub: ByteArray): ByteArray =
      "lance-ble-1|${kind.raw}|$remoteId|$hostId|".toByteArray() + remoteNonce + hostNonce + remotePub + hostPub
  }
}

/** Why the remote side gave up. */
sealed class BleHandshakeFailure {
  object Malformed : BleHandshakeFailure()
  /** The camera could not prove it is the paired one (or knows the code): never trust it, never forget for it. */
  object WrongHost : BleHandshakeFailure()
  /** The camera does not know this remote (any more). */
  object Unpaired : BleHandshakeFailure()
  data class Refused(val reason: RemoteMessage.Reason) : BleHandshakeFailure()
}

// ---- Remote phone

class BleRemoteHandshake(
  private val mode: Mode,
  private val remoteId: String,
  private val remoteName: String,
  private val nonce: ByteArray = BleCrypto.randomBytes(BleWire.NONCE_SIZE),
  private val privateKey: ByteArray = X25519.newPrivateKey(),
) {
  sealed class Mode {
    /** `key`: the QR secret or the UTF-8 bytes of the 6-digit code. */
    class Pair(val key: ByteArray) : Mode()
    class Reconnect(val host: TrustedPeer) : Mode()
  }

  sealed class Outcome {
    class Send(val data: ByteArray) : Outcome()
    class Paired(val host: TrustedPeer, val session: BleSession) : Outcome()
    class Connected(val session: BleSession) : Outcome()
    class Failed(val failure: BleHandshakeFailure) : Outcome()
  }

  private val kind = if (mode is Mode.Pair) BleLinkKind.PAIR else BleLinkKind.RECONNECT
  private val publicKey by lazy { X25519.publicKey(privateKey) }
  private var transcript: ByteArray? = null
  private var sessionKey: ByteArray? = null
  private var hostId = ""

  fun hello(): ByteArray =
    BleHandshakeMessage.Hello(kind, remoteId, remoteName, nonce, if (kind == BleLinkKind.PAIR) publicKey else null).wire

  fun receive(wire: ByteArray): Outcome {
    val message = BleHandshakeMessage.decode(wire) ?: return Outcome.Failed(BleHandshakeFailure.Malformed)
    return when (message) {
      is BleHandshakeMessage.Refused -> Outcome.Failed(BleHandshakeFailure.Refused(message.reason))
      BleHandshakeMessage.Unpaired -> Outcome.Failed(BleHandshakeFailure.Unpaired)
      is BleHandshakeMessage.Challenge -> challenged(message)
      is BleHandshakeMessage.Accept -> accepted(message)
      else -> Outcome.Failed(BleHandshakeFailure.Malformed)
    }
  }

  private fun challenged(c: BleHandshakeMessage.Challenge): Outcome {
    if (transcript != null) return Outcome.Failed(BleHandshakeFailure.Malformed)
    return when (mode) {
      is Mode.Pair -> {
        val hostPub = c.pub ?: return Outcome.Failed(BleHandshakeFailure.Malformed)
        val shared = X25519.sharedSecret(privateKey, hostPub) ?: return Outcome.Failed(BleHandshakeFailure.Malformed)
        val text = BleHandshakeMessage.transcript(BleLinkKind.PAIR, remoteId, c.hostId, nonce, c.nonce, publicKey, hostPub)
        transcript = text
        hostId = c.hostId
        sessionKey = BleCrypto.hkdf(shared, text, "lance-pair".toByteArray())
        Outcome.Send(BleHandshakeMessage.Proof(BleCrypto.mac(mode.key, "remote|", text)).wire)
      }
      is Mode.Reconnect -> {
        val proof = c.hostProof
        if (c.hostId != mode.host.id || proof == null) return Outcome.Failed(BleHandshakeFailure.WrongHost)
        val text = BleHandshakeMessage.transcript(BleLinkKind.RECONNECT, remoteId, c.hostId, nonce, c.nonce, ByteArray(0), ByteArray(0))
        if (!BleCrypto.equal(proof, BleCrypto.mac(mode.host.key, "host|", text))) return Outcome.Failed(BleHandshakeFailure.WrongHost)
        transcript = text
        hostId = c.hostId
        sessionKey = BleCrypto.sessionKey(mode.host.key, text, "lance-session")
        Outcome.Send(BleHandshakeMessage.Proof(BleCrypto.mac(mode.host.key, "remote|", text)).wire)
      }
    }
  }

  private fun accepted(a: BleHandshakeMessage.Accept): Outcome {
    val text = transcript ?: return Outcome.Failed(BleHandshakeFailure.Malformed)
    val key = sessionKey ?: return Outcome.Failed(BleHandshakeFailure.Malformed)
    val session = BleSession(key, BleSession.Side.REMOTE)
    return when (mode) {
      is Mode.Reconnect -> Outcome.Connected(session)
      is Mode.Pair -> {
        val proof = a.hostProof
        if (proof == null || !BleCrypto.equal(proof, BleCrypto.mac(mode.key, "host|", text))) {
          return Outcome.Failed(BleHandshakeFailure.WrongHost)
        }
        val plain = a.paired?.let(session::open) ?: return Outcome.Failed(BleHandshakeFailure.Malformed)
        val paired = RemoteMessage.decode(plain) as? RemoteMessage.Paired ?: return Outcome.Failed(BleHandshakeFailure.Malformed)
        if (paired.hostId != hostId) return Outcome.Failed(BleHandshakeFailure.Malformed)
        Outcome.Paired(TrustedPeer(paired.hostId, paired.hostName, paired.pairKey), session)
      }
    }
  }
}

// ---- Camera phone

class BleHostHandshake(
  private val hostId: String,
  private val hostName: String,
  private val nonce: ByteArray = BleCrypto.randomBytes(BleWire.NONCE_SIZE),
  private val privateKey: ByteArray = X25519.newPrivateKey(),
) {
  sealed class Outcome {
    class Send(val data: ByteArray) : Outcome()
    /** Pairing proof accepted: store `remote`, spend the offer, send `send`, then keep using `session`. */
    class Paired(val remote: TrustedPeer, val send: ByteArray, val session: BleSession) : Outcome()
    /** A paired remote proved who it is: send `send`, then keep using `session`. */
    class Connected(val remoteId: String, val send: ByteArray, val session: BleSession) : Outcome()
    /** Tell the remote why (`refused` / `unpaired`), then drop the link. */
    class Refuse(val send: ByteArray) : Outcome()
    /** Drop the link without a word. */
    object Drop : Outcome()
  }

  private class Remote(val kind: BleLinkKind, val id: String, val name: String, val pub: ByteArray)

  private val publicKey by lazy { X25519.publicKey(privateKey) }
  private var remote: Remote? = null
  private var transcript: ByteArray? = null

  /** The id of the remote that said hello (logs, and releasing a reserved offer when the link drops). */
  val remoteId: String? get() = remote?.id

  /** `offer`: the open pairing, if any (its attempts and reservation change here); `now`: ms since 1970. */
  fun receive(wire: ByteArray, offer: PairingOffer?, trusted: (String) -> TrustedPeer?, now: Double,
              newPairKey: () -> ByteArray = { BleCrypto.randomBytes(32) }): Outcome {
    val message = BleHandshakeMessage.decode(wire) ?: return Outcome.Drop
    return when (message) {
      is BleHandshakeMessage.Hello -> hello(message, offer, trusted)
      is BleHandshakeMessage.Proof -> proof(message, offer, trusted, now, newPairKey)
      else -> Outcome.Drop
    }
  }

  private fun hello(h: BleHandshakeMessage.Hello, offer: PairingOffer?, trusted: (String) -> TrustedPeer?): Outcome {
    if (remote != null) return Outcome.Drop
    return when (h.kind) {
      BleLinkKind.PAIR -> {
        if (offer == null) return Outcome.Refuse(BleHandshakeMessage.Refused(RemoteMessage.Reason.CLOSED).wire)
        val pub = h.pub?.takeIf { it.size == 32 } ?: return Outcome.Drop
        remote = Remote(BleLinkKind.PAIR, h.remoteId, h.remoteName, pub)
        transcript = BleHandshakeMessage.transcript(BleLinkKind.PAIR, h.remoteId, hostId, h.nonce, nonce, pub, publicKey)
        Outcome.Send(BleHandshakeMessage.Challenge(hostId, hostName, nonce, publicKey, null).wire)
      }
      BleLinkKind.RECONNECT -> {
        val peer = trusted(h.remoteId) ?: return Outcome.Refuse(BleHandshakeMessage.Unpaired.wire)
        remote = Remote(BleLinkKind.RECONNECT, h.remoteId, h.remoteName, ByteArray(0))
        val text = BleHandshakeMessage.transcript(BleLinkKind.RECONNECT, h.remoteId, hostId, h.nonce, nonce, ByteArray(0), ByteArray(0))
        transcript = text
        Outcome.Send(BleHandshakeMessage.Challenge(hostId, hostName, nonce, null, BleCrypto.mac(peer.key, "host|", text)).wire)
      }
    }
  }

  private fun proof(p: BleHandshakeMessage.Proof, offer: PairingOffer?, trusted: (String) -> TrustedPeer?, now: Double,
                    newPairKey: () -> ByteArray): Outcome {
    val asker = remote ?: return Outcome.Drop
    val text = transcript ?: return Outcome.Drop
    return when (asker.kind) {
      BleLinkKind.RECONNECT -> {
        val peer = trusted(asker.id) ?: return Outcome.Drop
        if (!BleCrypto.equal(p.proof, BleCrypto.mac(peer.key, "remote|", text))) return Outcome.Drop
        Outcome.Connected(asker.id, BleHandshakeMessage.Accept(null, null).wire,
          BleSession(BleCrypto.sessionKey(peer.key, text, "lance-session"), BleSession.Side.HOST))
      }
      BleLinkKind.PAIR -> {
        val current = offer ?: return Outcome.Refuse(BleHandshakeMessage.Refused(RemoteMessage.Reason.CLOSED).wire)
        var matched: ByteArray? = null
        val verdict = current.check(asker.id, now) { key ->
          BleCrypto.equal(p.proof, BleCrypto.mac(key, "remote|", text)).also { if (it) matched = key }
        }
        when (verdict) {
          PairingOffer.Verdict.Accepted -> {
            val pairingKey = matched ?: return Outcome.Drop
            val shared = X25519.sharedSecret(privateKey, asker.pub) ?: return Outcome.Drop
            val session = BleSession(BleCrypto.hkdf(shared, text, "lance-pair".toByteArray()), BleSession.Side.HOST)
            val pairKey = newPairKey()
            val sealed = session.seal(RemoteMessage.Paired(hostId, hostName, pairKey).data)
            Outcome.Paired(TrustedPeer(asker.id, asker.name, pairKey),
              BleHandshakeMessage.Accept(BleCrypto.mac(pairingKey, "host|", text), sealed).wire, session)
          }
          is PairingOffer.Verdict.WrongProof -> Outcome.Refuse(BleHandshakeMessage.Refused(RemoteMessage.Reason.WRONG).wire)
          PairingOffer.Verdict.Expired -> Outcome.Refuse(BleHandshakeMessage.Refused(RemoteMessage.Reason.EXPIRED).wire)
          PairingOffer.Verdict.Locked -> Outcome.Refuse(BleHandshakeMessage.Refused(RemoteMessage.Reason.LOCKED).wire)
          PairingOffer.Verdict.Taken -> Outcome.Refuse(BleHandshakeMessage.Refused(RemoteMessage.Reason.USED).wire)
        }
      }
    }
  }
}
