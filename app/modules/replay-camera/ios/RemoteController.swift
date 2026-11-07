import CoreBluetooth
import Foundation
import os
import UIKit

/// Remote-phone side of the phone remote, over Bluetooth LE (spec 2026-10-23-ble-remote-design.md).
///
/// The phone is a BLE central. It keeps a connection request pending to the paired camera phone at all times: iOS completes
/// it by itself as soon as the camera is in range and advertising, even after a drop in the middle of a recording, so there
/// is nothing to retry by hand. A scan runs alongside for a camera that changed its Bluetooth identity (reinstall, reset).
/// It also pairs: from the `reprize://pair` link (the QR secret) or from the 6 digits typed.
/// Rules and formats live in Core (`BleHandshake`, `BleFrames`, `RemoteMessage`, `TrustedPeers`).
final class RemoteController: NSObject {
  static let shared = RemoteController()

  private static let log = Logger(subsystem: "Reprize", category: "RemoteController")
  /// Where the camera phone's Bluetooth identity is remembered: "hostId|peripheral uuid".
  private static let rememberedKey = "reprize.remote.cameraPeripheral"
  /// A phone that turned out not to be ours is left alone this long.
  private static let blockFor: TimeInterval = 30
  private static let pairTimeout: TimeInterval = 20
  /// How long the pending connection gets to finish once the camera phone is seen advertising, before the remote
  /// connects to what it saw instead.
  private static let pendingGrace: TimeInterval = 2

  /// Same shape as WatchBridge.emit: (event name, body).
  var emit: ((String, [String: Any]) -> Void)?

  private enum PairMode {
    case link(hostId: String, secret: Data)
    case code(String)

    var key: Data {
      switch self {
      case let .link(_, secret): return secret
      case let .code(code): return Data(code.utf8)
      }
    }
  }

  private let hosts = TrustedPeers(store: KeychainPeerStore(account: "reprize.remote.hosts"))
  private var central: CBCentralManager?
  private var bluetooth: CBManagerState = .unknown
  /// The camera phone we are connecting or connected to.
  private var camera: CBPeripheral?
  private var rx: CBCharacteristic?
  private var handshake: BleRemoteHandshake?
  private var session: BleSession?
  private var assembler = BleFrames.Assembler()
  private var nextMessageId: UInt16 = 0
  private var wanted = false
  private var pairMode: PairMode?
  private var pairTimer: DispatchWorkItem?
  private var blocked: [UUID: Date] = [:]
  /// Waiting to see whether the pending connection finishes now that a camera phone is advertising.
  private var pendingCheck: DispatchWorkItem?
  private let previewClient = PreviewClient()
  private var previewWanted = false
  private var previewLink: (service: String, token: Data, key: Data)?
  /// The last link state told to the screen.
  private var lastLink: String?

  private override init() {
    super.init()
    previewClient.onFrame = { [weak self] jpeg in
      DispatchQueue.main.async { self?.emit?("onRemoteFrame", ["jpeg": jpeg.base64EncodedString()]) }
    }
    NotificationCenter.default.addObserver(self, selector: #selector(cameToFront), name: UIApplication.didBecomeActiveNotification,
                                           object: nil)
  }

  private func onMain<T>(_ work: () -> T) -> T {
    Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
  }

  // MARK: JS API

  /// The remote screen is in front: keep the link to the paired camera phone up.
  func start() { onMain { wanted = true; refresh() } }

  func stop() { onMain { wanted = false; refresh() } }

  var host: TrustedPeer? { onMain { hosts.all.first } }

  /// Unpairs from this side. When the camera phone is connected it is told first, so it drops this remote too.
  func forget() {
    onMain {
      if session != nil { send(.forget) }
      for item in hosts.all { hosts.remove(id: item.id) }
      UserDefaults.standard.removeObject(forKey: Self.rememberedKey)
      let leaving = camera
      // Give the message a moment to leave before the link is cut.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        guard let self, let leaving, self.camera === leaving || self.camera == nil else { return }
        self.central?.cancelPeripheralConnection(leaving)
      }
      resetLink()
      camera = nil
      emitStatus()
    }
  }

  /// `secret` is the base64url text of the `reprize://pair` link. The result arrives as `onRemotePairing`.
  func pair(hostId: String, secret: String, hostName: String) {
    onMain {
      guard let key = Self.decodeSecret(secret) else { return fail("notFound") }
      beginPairing(.link(hostId: hostId, secret: key))
    }
  }

  func pair(code: String) { onMain { beginPairing(.code(code)) } }

  func save() { onMain { send(.save) } }

  /// Asks the camera phone to end the recording.
  func endRecording() { onMain { send(.stop) } }

  /// Asks the camera phone to start a new recording.
  func startRecording() { onMain { send(.start) } }

  /// The camera view is open (`true`, said again every second) or closed.
  func preview(_ on: Bool) {
    onMain {
      previewWanted = on
      send(.preview(on: on))
      if on, let link = previewLink {
        previewClient.open(service: link.service, token: link.token, key: link.key)
      } else if !on {
        previewClient.close()
      }
    }
  }

  // MARK: Lifecycle

  private var active: Bool { wanted || pairMode != nil }

  private func refresh() {
    if active {
      if central == nil {
        central = CBCentralManager(delegate: self, queue: .main,
                                   options: [CBCentralManagerOptionRestoreIdentifierKey: "reprize.remote.central"])
      } else {
        lookForCamera()
      }
    } else {
      central?.stopScan()
      if let camera { central?.cancelPeripheralConnection(camera) }
      camera = nil
      resetLink()
    }
    emitStatus()
  }

  /// Back in front: tell the screen again how the link is. Status events sent while the app was in the background (the
  /// link usually stays up there) can be missed by the screen, which then showed "Reconectando" over a working link.
  @objc private func cameToFront() {
    onMain {
      if active && session == nil { lookForCamera() }
      emitStatus()
    }
  }

  /// Everything about the current link, not the camera we are trying to reach.
  private func resetLink() {
    rx = nil
    handshake = nil
    session = nil
    assembler = BleFrames.Assembler()
    previewLink = nil
    previewClient.close()
  }

  private func rememberedPeripheral() -> UUID? {
    guard let host = hosts.all.first, let saved = UserDefaults.standard.string(forKey: Self.rememberedKey) else { return nil }
    let parts = saved.split(separator: "|").map(String.init)
    guard parts.count == 2, parts[0] == host.id else { return nil }
    return UUID(uuidString: parts[1])
  }

  private func remember(_ peripheral: CBPeripheral, hostId: String) {
    UserDefaults.standard.set("\(hostId)|\(peripheral.identifier.uuidString)", forKey: Self.rememberedKey)
  }

  /// A pending connection to the remembered camera (it never times out) plus a scan for a camera with a new identity.
  /// While pairing, only the scan, and only phones that have a pairing open.
  private func lookForCamera() {
    guard let central, central.state == .poweredOn, active, session == nil else { return }
    if pairMode == nil {
      guard !hosts.all.isEmpty else { return }
      if camera == nil, let id = rememberedPeripheral(), let known = central.retrievePeripherals(withIdentifiers: [id]).first {
        camera = known
      }
      if let camera, camera.state != .connected {
        camera.delegate = self
        central.connect(camera, options: nil)
      }
    }
    central.scanForPeripherals(withServices: [RemoteHost.serviceUUID], options: nil)
  }

  private func beginPairing(_ mode: PairMode) {
    pairMode = mode
    pairTimer?.cancel()
    let timeout = DispatchWorkItem { [weak self] in
      guard let self, self.pairMode != nil else { return }
      self.fail("notFound")
    }
    pairTimer = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.pairTimeout, execute: timeout)
    // Pairing needs its own handshake: let go of the current link first.
    if let camera { central?.cancelPeripheralConnection(camera) }
    camera = nil
    resetLink()
    refresh()
  }

  private func fail(_ reason: String) {
    let wasPairing = pairMode != nil
    pairMode = nil
    pairTimer?.cancel()
    if wasPairing, let camera, session == nil { central?.cancelPeripheralConnection(camera) }
    emit?("onRemotePairing", ["phase": "failed", "reason": reason])
    refresh()
  }

  private func emitStatus() {
    // The same app runs both sides, and both send this event: `side` tells the screens whose status it is.
    var body: [String: Any] = ["side": "remote"]
    switch bluetooth {
    case .unauthorized:
      body["link"] = "denied"
      body["reason"] = "unauthorized"
    case .poweredOff:
      body["link"] = "denied"
      body["reason"] = "off"
    default:
      if session != nil && pairMode == nil { body["link"] = "connected" } else { body["link"] = active ? "searching" : "idle" }
    }
    if let name = hosts.all.first?.name { body["peerName"] = name }
    lastLink = body["link"] as? String
    emit?("onRemoteStatus", body)
  }

  private func block(_ peripheral: CBPeripheral, why: String) {
    let who = String(peripheral.identifier.uuidString.prefix(8))
    Self.log.info("leaving \(who, privacy: .public) alone: \(why, privacy: .public)")
    blocked[peripheral.identifier] = Date()
    central?.cancelPeripheralConnection(peripheral)
    if camera === peripheral { camera = nil }
    resetLink()
  }

  // MARK: Sending

  private func send(_ message: RemoteMessage) {
    guard var current = session, let sealed = current.seal(message.data) else { return }
    session = current
    writeRaw(sealed)
  }

  private func writeRaw(_ message: Data) {
    guard let camera, let rx else { return }
    let frames = BleFrames.split(message, id: nextMessageId, maxFrame: camera.maximumWriteValueLength(for: .withResponse))
    nextMessageId &+= 1
    for frame in frames { camera.writeValue(frame, for: rx, type: .withResponse) }
  }

  // MARK: Receiving

  private func startHandshake() {
    let mode: BleRemoteHandshake.Mode
    if let pairing = pairMode {
      mode = .pair(key: pairing.key)
    } else if let host = hosts.all.first {
      mode = .reconnect(host: host)
    } else {
      if let camera { central?.cancelPeripheralConnection(camera) }
      return
    }
    let created = BleRemoteHandshake(mode: mode, remoteId: DeviceIdentity.id, remoteName: DeviceIdentity.name)
    handshake = created
    writeRaw(created.hello())
  }

  private func handle(_ message: Data) {
    if session != nil {
      // The only plain message after the handshake: the camera phone removed this remote.
      if let first = message.first, first == BleWire.handshake {
        if case .unpaired? = BleHandshakeMessage.decode(message) { heardUnpaired() }
        return
      }
      guard var current = session, let plain = current.open(message), let decoded = RemoteMessage.decode(data: plain) else { return }
      session = current
      received(decoded)
      return
    }
    guard var current = handshake, let camera else { return }
    let outcome = current.receive(message)
    handshake = current
    switch outcome {
    case let .send(data):
      writeRaw(data)
    case let .paired(host, linkSession):
      for item in hosts.all { hosts.remove(id: item.id) }  // a remote has one camera phone
      hosts.add(host)
      remember(camera, hostId: host.id)
      pairMode = nil
      pairTimer?.cancel()
      session = linkSession
      handshake = nil
      central?.stopScan()
      Self.log.info("paired with \(String(host.id.prefix(8)), privacy: .public)")
      emit?("onRemotePairing", ["phase": "paired", "peer": ["id": host.id, "name": host.name]])
      emitStatus()
    case let .connected(linkSession):
      if let host = hosts.all.first { remember(camera, hostId: host.id) }
      session = linkSession
      handshake = nil
      central?.stopScan()
      Self.log.info("connected")
      if previewWanted { send(.preview(on: true)) }
      emitStatus()
    case let .failed(failure):
      switch failure {
      case let .refused(reason):
        if pairMode != nil {
          fail(reason.rawValue)
        } else {
          block(camera, why: "refused \(reason.rawValue)")
        }
      case .unpaired:
        if pairMode != nil {
          block(camera, why: "unpaired while pairing")
        } else if camera.identifier == rememberedPeripheral() {
          heardUnpaired()
        } else {
          // Another camera phone that does not know us: not ours, nothing to forget.
          block(camera, why: "another camera")
        }
      case .wrongHost:
        block(camera, why: "could not prove it is our camera")
      case .malformed:
        block(camera, why: "bad handshake message")
      }
      lookForCamera()
    }
  }

  /// Our camera phone says it does not know this remote any more: forget it, like the remote's own "Esquecer".
  private func heardUnpaired() {
    Self.log.info("the camera phone removed this remote")
    for item in hosts.all { hosts.remove(id: item.id) }
    UserDefaults.standard.removeObject(forKey: Self.rememberedKey)
    if let camera { central?.cancelPeripheralConnection(camera) }
    camera = nil
    resetLink()
    emit?("onRemotePairing", ["phase": "failed", "reason": "denied"])
    emitStatus()
  }

  private func received(_ message: RemoteMessage) {
    // A sealed message is proof the link is up: make sure the screen agrees.
    if lastLink != "connected" { emitStatus() }
    switch message {
    case let .state(recording, clipCount, startedAt):
      var body: [String: Any] = ["recording": recording, "clipCount": clipCount]
      if let startedAt { body["startedAt"] = startedAt }
      emit?("onRemoteState", body)
    case let .result(saved):
      emit?("onRemoteResult", ["saved": saved])
    case let .ping(token):
      // The camera phone asks "are you there?" (its Verificar button): answer at once.
      send(.pong(token: token))
    case let .previewLink(service, token, key):
      previewLink = (service, token, key)
      if previewWanted { previewClient.open(service: service, token: token, key: key) }
    default:
      break
    }
  }

  private static func decodeSecret(_ text: String) -> Data? {
    var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64 += "=" }
    guard let data = Data(base64Encoded: base64), data.count == 16 else { return nil }
    return data
  }
}

extension RemoteController: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    bluetooth = central.state
    Self.log.info("bluetooth state \(central.state.rawValue, privacy: .public)")
    if central.state == .poweredOn {
      lookForCamera()
    } else {
      // Turning Bluetooth off ends every link without a disconnect callback: treat it as a drop here.
      camera = nil
      resetLink()
    }
    emitStatus()
  }

  func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
    if let restored = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first {
      camera = restored
      restored.delegate = self
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard active, session == nil else { return }
    if let since = blocked[peripheral.identifier], Date().timeIntervalSince(since) < Self.blockFor { return }
    let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String
    if pairMode != nil {
      let ids = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
        + (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
      guard name == RemoteHost.advertisedPairingName || ids.contains(RemoteHost.pairingServiceUUID) else { return }
    }
    if let current = camera {
      if current.state == .connecting && pairMode == nil {
        // The pending connection usually finishes by itself. It does not when the camera phone came back under a new
        // Bluetooth identity (the remote opened first, the camera after): give it a moment, then use what was seen.
        connectIfStillPending(seen: peripheral)
        return
      }
      if current.identifier == peripheral.identifier { return }
      central.cancelPeripheralConnection(current)
    }
    camera = peripheral
    peripheral.delegate = self
    central.connect(peripheral, options: nil)
  }

  /// A camera phone is advertising our service but the pending connection has not finished: after `pendingGrace`, drop it
  /// and connect to the phone that was seen. A phone that is not ours fails the handshake and is left alone for a while.
  private func connectIfStillPending(seen: CBPeripheral) {
    guard pendingCheck == nil else { return }
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.pendingCheck = nil
      guard self.active, self.session == nil, self.pairMode == nil, let central = self.central,
            let current = self.camera, current.state == .connecting else { return }
      if let since = self.blocked[seen.identifier], Date().timeIntervalSince(since) < Self.blockFor { return }
      let who = String(seen.identifier.uuidString.prefix(8))
      Self.log.info("pending connection did not finish: connecting to the advertising phone \(who, privacy: .public)")
      central.cancelPeripheralConnection(current)
      self.camera = seen
      seen.delegate = self
      central.connect(seen, options: nil)
    }
    pendingCheck = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.pendingGrace, execute: work)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard peripheral === camera else { return central.cancelPeripheralConnection(peripheral) }
    resetLink()
    peripheral.discoverServices([RemoteHost.serviceUUID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard peripheral === camera else { return }
    resetLink()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.lookForCamera() }
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard peripheral === camera else { return }
    let wasConnected = session != nil
    resetLink()
    if wasConnected {
      Self.log.info("link lost: \(error.map { $0.localizedDescription } ?? "no error", privacy: .public)")
    }
    emitStatus()
    // Ask again at once: iOS keeps the request open and completes it when the camera phone is back.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.lookForCamera() }
  }
}

extension RemoteController: CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let service = peripheral.services?.first(where: { $0.uuid == RemoteHost.serviceUUID }) else {
      return block(peripheral, why: "no remote service")
    }
    peripheral.discoverCharacteristics([RemoteHost.rxUUID, RemoteHost.txUUID], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    for characteristic in service.characteristics ?? [] {
      if characteristic.uuid == RemoteHost.rxUUID { rx = characteristic }
      if characteristic.uuid == RemoteHost.txUUID { peripheral.setNotifyValue(true, for: characteristic) }
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard characteristic.uuid == RemoteHost.txUUID, peripheral === camera else { return }
    guard error == nil, characteristic.isNotifying, rx != nil else { return block(peripheral, why: "could not subscribe") }
    startHandshake()
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard peripheral === camera, characteristic.uuid == RemoteHost.txUUID, let value = characteristic.value else { return }
    if let message = assembler.add(value, now: Date().timeIntervalSince1970) { handle(message) }
  }
}
