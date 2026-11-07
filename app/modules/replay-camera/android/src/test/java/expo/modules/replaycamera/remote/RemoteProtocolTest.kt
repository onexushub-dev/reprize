package expo.modules.replaycamera.remote

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Android port against the iPhone's own runs (remote-vectors.json, written by the Swift core's
 * CrossPlatformVectorsTests): same bytes, same proofs, same keys, so the two platforms pair and talk.
 */
class RemoteProtocolTest {
  private val v: JSONObject = JSONObject(javaClass.classLoader!!.getResource("remote-vectors.json")!!.readText())
  private fun b(section: String, key: String): ByteArray = B64.decode(v.getJSONObject(section).getString(key))!!
  private fun s(section: String, key: String): String = v.getJSONObject(section).getString(key)
  private fun hex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  private fun json(wire: ByteArray) = JSONObject(String(wire, 1, wire.size - 1))

  @Test fun x25519MatchesRfc7748() {
    val out = X25519.scalarMult(
      hex("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4"),
      hex("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c"))
    assertArrayEquals(hex("c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552"), out)
    // Alice and Bob (RFC 7748 section 6.1)
    val alice = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
    val bob = hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb")
    assertArrayEquals(hex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"), X25519.publicKey(alice))
    assertArrayEquals(hex("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"),
      X25519.sharedSecret(alice, X25519.publicKey(bob)))
  }

  @Test fun x25519MatchesCryptoKit() {
    assertArrayEquals(b("x25519", "pubA"), X25519.publicKey(b("x25519", "privA")))
    assertArrayEquals(b("x25519", "pubB"), X25519.publicKey(b("x25519", "privB")))
    assertArrayEquals(b("x25519", "shared"), X25519.sharedSecret(b("x25519", "privA"), b("x25519", "pubB")))
  }

  @Test fun macAndHkdfMatchCryptoKit() {
    assertArrayEquals(b("mac", "mac"), BleCrypto.mac(b("mac", "key"), s("mac", "label"), b("mac", "transcript")))
    assertArrayEquals(b("hkdf", "key"), BleCrypto.sessionKey(b("hkdf", "secret"), b("hkdf", "salt"), s("hkdf", "info")))
  }

  @Test fun sealingMatchesBothWays() {
    val key = b("session", "key")
    val host = BleSession(key, BleSession.Side.HOST)
    assertArrayEquals(b("session", "host1"), host.seal(b("session", "plain1")))
    assertArrayEquals(b("session", "host2"), host.seal(b("session", "plain2")))
    val remote = BleSession(key, BleSession.Side.REMOTE)
    assertArrayEquals(b("session", "plain1"), remote.open(b("session", "host1")))
    assertArrayEquals(b("session", "plain2"), remote.open(b("session", "host2")))
    assertNull("a replay is refused", remote.open(b("session", "host2")))
    assertArrayEquals(b("session", "plain1"), BleSession(key, BleSession.Side.HOST).open(b("session", "remote1")))
  }

  @Test fun framesMatchAndReassemble() {
    val frames = v.getJSONObject("frames")
    val expected = (0 until frames.getJSONArray("frames").length()).map { B64.decode(frames.getJSONArray("frames").getString(it))!! }
    val made = BleFrames.split(b("frames", "message"), frames.getInt("id"), frames.getInt("maxFrame"))
    assertEquals(expected.size, made.size)
    expected.zip(made).forEach { (e, m) -> assertArrayEquals(e, m) }
    val assembler = BleFrames.Assembler()
    val whole = made.map { assembler.add(it, 0.0) }.last()
    assertArrayEquals(b("frames", "message"), whole)
  }

  @Test fun androidRemotePairsWithAnIphoneCamera() {
    val remote = BleRemoteHandshake(BleRemoteHandshake.Mode.Pair(s("pair", "code").toByteArray()), s("pair", "remoteId"),
      s("pair", "remoteName"), b("pair", "remoteNonce"), b("pair", "remotePriv"))
    val hello = json(remote.hello())
    val swiftHello = json(b("pair", "hello"))
    for (key in listOf("t", "kind", "remoteId", "remoteName", "nonce", "pub")) assertEquals(key, swiftHello.get(key), hello.get(key))

    val proof = remote.receive(b("pair", "challenge")) as BleRemoteHandshake.Outcome.Send
    assertEquals(json(b("pair", "proof")).getString("proof"), json(proof.data).getString("proof"))

    val paired = remote.receive(b("pair", "accept")) as BleRemoteHandshake.Outcome.Paired
    assertEquals(s("pair", "hostId"), paired.host.id)
    assertEquals(s("pair", "hostName"), paired.host.name)
    assertArrayEquals(b("pair", "pairKey"), paired.host.key)
  }

  @Test fun androidCameraPairsWithAnIphoneRemote() {
    val offer = PairingOffer(s("pair", "hostId"), s("pair", "hostName"), b("pair", "secret"), s("pair", "code"), 1_000_000.0)
    val host = BleHostHandshake(s("pair", "hostId"), s("pair", "hostName"), b("pair", "hostNonce"), b("pair", "hostPriv"))
    val challenge = host.receive(b("pair", "hello"), offer, { null }, 1_000_500.0) as BleHostHandshake.Outcome.Send
    val swiftChallenge = json(b("pair", "challenge"))
    for (key in listOf("t", "hostId", "hostName", "nonce", "pub")) assertEquals(key, swiftChallenge.get(key), json(challenge.data).get(key))

    val paired = host.receive(b("pair", "proof"), offer, { null }, 1_000_600.0, { b("pair", "pairKey") }) as BleHostHandshake.Outcome.Paired
    assertEquals(s("pair", "pairedRemoteId"), paired.remote.id)
    assertEquals(json(b("pair", "accept")).getString("hostProof"), json(paired.send).getString("hostProof"))

    // The iPhone remote would now open our sealed `paired`: a remote in the same state (proved equal above) does.
    val remote = BleRemoteHandshake(BleRemoteHandshake.Mode.Pair(s("pair", "code").toByteArray()), s("pair", "remoteId"),
      s("pair", "remoteName"), b("pair", "remoteNonce"), b("pair", "remotePriv"))
    remote.receive(challenge.data)
    val done = remote.receive(paired.send) as BleRemoteHandshake.Outcome.Paired
    assertArrayEquals(b("pair", "pairKey"), done.host.key)
  }

  @Test fun androidRemoteReconnectsToAnIphoneCamera() {
    val host = TrustedPeer(s("pair", "hostId"), s("pair", "hostName"), b("reconnect", "pairKey"))
    val remote = BleRemoteHandshake(BleRemoteHandshake.Mode.Reconnect(host), s("pair", "remoteId"), s("pair", "remoteName"),
      b("reconnect", "remoteNonce"))
    val swiftHello = json(b("reconnect", "hello"))
    val hello = json(remote.hello())
    for (key in listOf("t", "kind", "remoteId", "nonce")) assertEquals(key, swiftHello.get(key), hello.get(key))
    assertTrue(!hello.has("pub"))

    val proof = remote.receive(b("reconnect", "challenge")) as BleRemoteHandshake.Outcome.Send
    assertEquals(json(b("reconnect", "proof")).getString("proof"), json(proof.data).getString("proof"))
    val connected = remote.receive(b("reconnect", "accept")) as BleRemoteHandshake.Outcome.Connected
    val state = RemoteMessage.decode(connected.session.open(b("reconnect", "hostSealedState"))!!) as RemoteMessage.State
    assertEquals(RemoteMessage.State(true, 2, 1_700_000_000_000.0), state)
  }

  @Test fun androidCameraReconnectsAnIphoneRemote() {
    val peer = TrustedPeer(s("pair", "remoteId"), s("pair", "remoteName"), b("reconnect", "pairKey"))
    val host = BleHostHandshake(s("pair", "hostId"), s("pair", "hostName"), b("reconnect", "hostNonce"))
    val challenge = host.receive(b("reconnect", "hello"), null, { if (it == peer.id) peer else null }, 0.0) as BleHostHandshake.Outcome.Send
    assertEquals(json(b("reconnect", "challenge")).getString("hostProof"), json(challenge.data).getString("hostProof"))
    val connected = host.receive(b("reconnect", "proof"), null, { if (it == peer.id) peer else null }, 0.0)
    assertTrue(connected is BleHostHandshake.Outcome.Connected)
  }

  @Test fun wrongCodeAndUnknownRemoteAreRefused() {
    val offer = PairingOffer(s("pair", "hostId"), s("pair", "hostName"), b("pair", "secret"), "111111", 1_000_000.0)
    val host = BleHostHandshake(s("pair", "hostId"), s("pair", "hostName"), b("pair", "hostNonce"), b("pair", "hostPriv"))
    host.receive(b("pair", "hello"), offer, { null }, 1_000_500.0)
    val refused = host.receive(b("pair", "proof"), offer, { null }, 1_000_600.0) as BleHostHandshake.Outcome.Refuse
    assertEquals(RemoteMessage.Reason.WRONG, (BleHandshakeMessage.decode(refused.send) as BleHandshakeMessage.Refused).reason)
    assertEquals(1, offer.failedAttempts)

    val unknown = BleHostHandshake("h", "n").receive(b("reconnect", "hello"), null, { null }, 0.0)
    assertTrue(BleHandshakeMessage.decode((unknown as BleHostHandshake.Outcome.Refuse).send) is BleHandshakeMessage.Unpaired)
  }

  @Test fun messagesRoundTripAndIgnoreJunk() {
    val all = listOf(RemoteMessage.Save, RemoteMessage.Stop, RemoteMessage.Start, RemoteMessage.Forget, RemoteMessage.Preview(true),
      RemoteMessage.State(false, 0, null), RemoteMessage.Result(true), RemoteMessage.Ping("ab"), RemoteMessage.Pong("ab"),
      RemoteMessage.Refused(RemoteMessage.Reason.EXPIRED))
    for (m in all) assertEquals(m, RemoteMessage.decode(m.data))
    assertNull(RemoteMessage.decode("""{"cmd":"explode"}""".toByteArray()))
    assertNull(RemoteMessage.decode("not json".toByteArray()))
    assertNotNull(RemoteMessage.decode("""{"recording":true,"clipCount":1,"startedAt":5}""".toByteArray()))
  }
}
