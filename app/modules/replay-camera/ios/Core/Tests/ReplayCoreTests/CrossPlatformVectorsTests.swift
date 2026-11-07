import CryptoKit
import Foundation
import XCTest
@testable import ReplayCore

/// Fixed-input runs of the BLE remote protocol, written as JSON for the Android port to replay (its tests read
/// `android/src/test/resources/remote-vectors.json`). Regenerate after a protocol change:
///
///     VECTORS_OUT=../../android/src/test/resources/remote-vectors.json swift test --filter CrossPlatformVectorsTests
///
/// Without `VECTORS_OUT` the test only checks that the runs still complete.
final class CrossPlatformVectorsTests: XCTestCase {
  private func bytes(_ seed: UInt8, _ count: Int = 32) -> Data { Data((0..<count).map { UInt8(truncatingIfNeeded: Int(seed) &* 7 &+ $0) }) }
  private func b64(_ data: Data) -> String { data.base64EncodedString() }

  func testWritesVectors() throws {
    var out: [String: Any] = [:]

    // X25519
    let a = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: bytes(1))
    let b = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: bytes(2))
    let shared = try a.sharedSecretFromKeyAgreement(with: b.publicKey).withUnsafeBytes { Data($0) }
    out["x25519"] = ["privA": b64(bytes(1)), "privB": b64(bytes(2)), "pubA": b64(a.publicKey.rawRepresentation),
                     "pubB": b64(b.publicKey.rawRepresentation), "shared": b64(shared)]

    // HMAC and HKDF
    let transcript = Data("lance-ble-1|test|".utf8) + bytes(3, 40)
    out["mac"] = ["key": b64(bytes(4)), "label": "remote|", "transcript": b64(transcript),
                  "mac": b64(BleCrypto.mac(key: bytes(4), label: "remote|", transcript: transcript))]
    let derived = BleCrypto.sessionKey(secret: SymmetricKey(data: bytes(5)), transcript: transcript, info: "lance-session")
    out["hkdf"] = ["secret": b64(bytes(5)), "salt": b64(transcript), "info": "lance-session",
                   "key": b64(derived.withUnsafeBytes { Data($0) })]

    // Sealing: the first two messages from each side.
    let sessionKey = SymmetricKey(data: bytes(6))
    var host = BleSession(key: sessionKey, side: .host)
    var remote = BleSession(key: sessionKey, side: .remote)
    let plain1 = Data(#"{"cmd":"save"}"#.utf8)
    let plain2 = Data(#"{"recording":true,"clipCount":3}"#.utf8)
    out["session"] = ["key": b64(bytes(6)), "plain1": b64(plain1), "plain2": b64(plain2),
                      "host1": b64(host.seal(plain1)!), "host2": b64(host.seal(plain2)!),
                      "remote1": b64(remote.seal(plain1)!)]

    // Frames
    let message = Data((0..<50).map { UInt8($0) })
    out["frames"] = ["message": b64(message), "id": 513, "maxFrame": 20,
                     "frames": BleFrames.split(message, id: 513, maxFrame: 20).map(b64)]

    // Pairing by code, both sides.
    let remoteKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: bytes(7))
    let hostKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: bytes(8))
    let code = "042917"
    var offer: PairingOffer? = PairingOffer(hostId: "HOST-ID-1", hostName: "iPhone 16#ab12", secret: bytes(9, 16),
                                            code: code, createdAt: 1_000_000)
    var remoteSide = BleRemoteHandshake(mode: .pair(key: Data(code.utf8)), remoteId: "REMOTE-ID-1",
                                        remoteName: "POCO X3#cd34", nonce: bytes(10, 16), privateKey: remoteKey)
    var hostSide = BleHostHandshake(hostId: "HOST-ID-1", hostName: "iPhone 16#ab12", nonce: bytes(11, 16), privateKey: hostKey)
    let hello = remoteSide.hello()
    guard case let .send(challenge) = hostSide.receive(hello, offer: &offer, trusted: { _ in nil }, now: 1_000_500) else {
      return XCTFail("no challenge")
    }
    guard case let .send(proof) = remoteSide.receive(challenge) else { return XCTFail("no proof") }
    guard case let .paired(paired, accept, _) = hostSide.receive(proof, offer: &offer, trusted: { _ in nil }, now: 1_000_600,
                                                                 newPairKey: { self.bytes(12) }) else {
      return XCTFail("not paired on the host")
    }
    guard case let .paired(hostPeer, _) = remoteSide.receive(accept) else { return XCTFail("not paired on the remote") }
    XCTAssertEqual(hostPeer.key, bytes(12))
    out["pair"] = ["code": code, "secret": b64(bytes(9, 16)), "remoteId": "REMOTE-ID-1", "remoteName": "POCO X3#cd34",
                   "hostId": "HOST-ID-1", "hostName": "iPhone 16#ab12",
                   "remotePriv": b64(bytes(7)), "remoteNonce": b64(bytes(10, 16)),
                   "hostPriv": b64(bytes(8)), "hostNonce": b64(bytes(11, 16)), "pairKey": b64(bytes(12)),
                   "hello": b64(hello), "challenge": b64(challenge), "proof": b64(proof), "accept": b64(accept),
                   "pairedRemoteId": paired.id]

    // Reconnect with the pair key, both sides.
    let pairKey = bytes(12)
    var reRemote = BleRemoteHandshake(mode: .reconnect(host: TrustedPeer(id: "HOST-ID-1", name: "iPhone 16#ab12", key: pairKey)),
                                      remoteId: "REMOTE-ID-1", remoteName: "POCO X3#cd34", nonce: bytes(13, 16))
    var reHost = BleHostHandshake(hostId: "HOST-ID-1", hostName: "iPhone 16#ab12", nonce: bytes(14, 16))
    var noOffer: PairingOffer?
    let trusted = { (id: String) in id == "REMOTE-ID-1" ? TrustedPeer(id: id, name: "POCO X3#cd34", key: pairKey) : nil }
    let reHello = reRemote.hello()
    guard case let .send(reChallenge) = reHost.receive(reHello, offer: &noOffer, trusted: trusted, now: 0) else {
      return XCTFail("no reconnect challenge")
    }
    guard case let .send(reProof) = reRemote.receive(reChallenge) else { return XCTFail("no reconnect proof") }
    guard case let .connected(_, reAccept, hostSession) = reHost.receive(reProof, offer: &noOffer, trusted: trusted, now: 0) else {
      return XCTFail("not connected on the host")
    }
    guard case .connected = reRemote.receive(reAccept) else { return XCTFail("not connected on the remote") }
    var sealer = hostSession
    let stateSealed = sealer.seal(RemoteMessage.state(recording: true, clipCount: 2, startedAt: 1_700_000_000_000).data)!
    out["reconnect"] = ["pairKey": b64(pairKey), "remoteNonce": b64(bytes(13, 16)), "hostNonce": b64(bytes(14, 16)),
                        "hello": b64(reHello), "challenge": b64(reChallenge), "proof": b64(reProof), "accept": b64(reAccept),
                        "hostSealedState": b64(stateSealed)]

    guard let path = ProcessInfo.processInfo.environment["VECTORS_OUT"] else { return }
    let json = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
    try json.write(to: URL(fileURLWithPath: path))
  }
}
