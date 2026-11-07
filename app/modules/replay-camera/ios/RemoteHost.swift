import CoreBluetooth
import Foundation
import os

/// Camera-phone side of the phone remote, over Bluetooth LE (spec 2026-10-23-ble-remote-design.md).
///
/// The phone is a BLE peripheral: it advertises one service while the app is open and a remote is paired (or a pairing is
/// open). Each remote that subscribes runs the handshake in `BleHostHandshake`; after it, every message is sealed
/// (`BleSession`). A tap on a remote becomes `onTrigger('phone')`; the recording state and the save results go back to
/// every connected remote. The camera view for the remote's preview goes over Wi-Fi (`PreviewServer`).
/// Rules and formats live in Core (`BleHandshake`, `BleFrames`, `PairingOffer`, `RemoteMessage`, `TrustedPeers`).
final class RemoteHost: NSObject {
  static let shared = RemoteHost()
  static let serviceUUID = CBUUID(string: "6E3F1001-8C1B-4F6E-9D4B-2A7C5E0B1A10")
  static let rxUUID = CBUUID(string: "6E3F1002-8C1B-4F6E-9D4B-2A7C5E0B1A10")
  static let txUUID = CBUUID(string: "6E3F1003-8C1B-4F6E-9D4B-2A7C5E0B1A10")
  /// The advertised name says whether a pairing is open, so a remote that is pairing only talks to such phones.
  static let advertisedName = "Reprize"
  static let advertisedPairingName = "Reprize+"
  /// An Android camera phone cannot choose the name it advertises, so it says "a pairing is open" with this second service id.
  static let pairingServiceUUID = CBUUID(string: "6E3F1004-8C1B-4F6E-9D4B-2A7C5E0B1A10")

  /// Console.app (filter: subsystem `Reprize`, category `RemoteHost`) shows each step.
  private static let log = Logger(subsystem: "Reprize", category: "RemoteHost")
  /// How often every connected remote hears from this phone, recording or not. The remote calls the link silent after 12 s.
  private static let beatEvery: TimeInterval = 5
  /// How long a "are you there?" waits for the answer.
  private static let pingTimeout: TimeInterval = 3
  /// How long the host stays up after nothing wants it any more.
  private static let teardownGrace: TimeInterval = 3
  /// One remote per camera phone (the remote side is already one camera per remote): a phone paired on an older day,
  /// lying around the court, can never save or stop someone else's game. The Keychain list can hold more (`TrustedPeers`).
  static let maxRemotes = 1
  /// The preview service stops when no remote has asked for pictures for this long.
  private static let previewIdle: TimeInterval = 10

  /// Same shape as WatchBridge.emit: (event name, body).
  var emit: ((String, [String: Any]) -> Void)?
  /// A remote asked for (or stopped) the pictures of the camera view; wired to the capture in the module.
  var onPreview: ((Bool) -> Void)?

  /// One subscribed remote phone.
  private final class Link {
    let central: CBCentral
    var handshake: BleHostHandshake
    var session: BleSession?
    /// Set once the remote proved who it is.
    var remoteId: String?
    var assembler = BleFrames.Assembler()
    var nextMessageId: UInt16 = 0
    /// Refused or dropped: everything it sends from now on is ignored (a peripheral cannot cut a central off).
    var closed = false
    var previewGranted = false

    init(central: CBCentral, handshake: BleHostHandshake) {
      self.central = central
      self.handshake = handshake
    }

    var authenticated: Bool { session != nil && remoteId != nil && !closed }
  }

  private var manager: CBPeripheralManager?
  private var tx: CBMutableCharacteristic?
  private var serviceAdded = false
  /// What is being advertised now: nil = nothing, false = paired remotes only, true = a pairing is open.
  private var advertisedPairing: Bool?
  private var bluetooth: CBManagerState = .unknown
  private var links: [UUID: Link] = [:]
  /// Notifications waiting for room in the system queue, in order.
  private var outbox: [(frame: Data, central: CBCentral)] = []
  private let trusted = TrustedPeers(store: KeychainPeerStore(account: "reprize.remote.controllers"))
  private var offer: PairingOffer?
  private var wanted = false
  private var lastState: RemoteMessage = .state(recording: false, clipCount: 0, startedAt: nil)
  private var heartbeat: DispatchSourceTimer?
  /// Open "are you there?" questions: token → (remote id, when it was sent).
  private var checks: [String: (remoteId: String, sentAt: Date)] = [:]
  /// Pending shutdown; see `scheduleTeardown`.
  private var teardown: DispatchWorkItem?
  private let preview = PreviewServer()
  private var lastPreviewAsk: Date?

  private override init() {
    super.init()
  }

  private func onMain<T>(_ work: () -> T) -> T {
    Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
  }

  private var nowMs: Double { Date().timeIntervalSince1970 * 1000 }

  // MARK: JS API

  /// The app is open: wait for the paired remotes. Asked again while running (the app came back to the front), it also
  /// starts advertising over, since iOS may have dropped it while the app was away.
  func start() {
    onMain {
      keepNewestRemote()
      if wanted { advertisedPairing = nil }
      wanted = true
      refresh()
    }
  }

  func stop() { onMain { wanted = false; refresh() } }

  /// One picture of the camera view for the remotes that opened the preview.
  func sendFrame(_ jpeg: Data) { preview.send(jpeg) }

  var peers: [TrustedPeer] { onMain { trusted.all } }

  /// Whether this remote has an authenticated link right now.
  func isConnected(id: String) -> Bool { onMain { links.values.contains { $0.authenticated && $0.remoteId == id } } }

  /// How many remotes are connected right now (a screen that opens later cannot have heard the status events).
  var controllers: Int { onMain { authenticatedLinks.count } }

  /// Asks a remote "are you there?". The answer arrives as `onRemoteCheck` {id, ok, ms}: `ok` is false when the remote is
  /// not linked or does not answer in `pingTimeout` seconds.
  func check(id: String) {
    onMain {
      guard let link = authenticatedLinks.first(where: { $0.remoteId == id }) else {
        emit?("onRemoteCheck", ["id": id, "ok": false, "ms": 0])
        return
      }
      let token = String(UUID().uuidString.prefix(8))
      checks[token] = (id, Date())
      sendSealed(.ping(token: token), to: link)
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.pingTimeout) { [weak self] in
        guard let self, self.checks.removeValue(forKey: token) != nil else { return }
        self.emit?("onRemoteCheck", ["id": id, "ok": false, "ms": 0])
      }
    }
  }

  func remove(id: String) {
    onMain {
      trusted.remove(id: id)
      preview.revoke(remoteId: id)
      for link in links.values where link.remoteId == id {
        // It cannot be cut off from here: tell it, and it forgets this phone and disconnects.
        sendRaw(BleHandshakeMessage.unpaired.wire, to: link)
        link.closed = true
      }
      refresh()
    }
  }

  /// A phone updated from the time of up to 4 remotes keeps only the most recently paired one. The others are told, so
  /// they forget this phone the next time they connect (the same as "Remover").
  private func keepNewestRemote() {
    for dropped in trusted.keepNewest(Self.maxRemotes) {
      Self.log.info("only one remote now: removed \(String(dropped.id.prefix(8)), privacy: .public)")
      preview.revoke(remoteId: dropped.id)
      for link in links.values where link.remoteId == dropped.id {
        sendRaw(BleHandshakeMessage.unpaired.wire, to: link)
        link.closed = true
      }
    }
  }

  /// Opens a pairing (QR + code). Nil while a remote is paired: it has to be removed first (one remote per camera phone).
  func beginPairing() -> (url: String, code: String, expiresAt: Double, qrPath: String)? {
    onMain {
      guard trusted.all.count < Self.maxRemotes else { return nil }
      let fresh = PairingOffer.make(hostId: DeviceIdentity.id, hostName: DeviceIdentity.name, now: nowMs)
      guard let qrPath = QRCode.png(for: fresh.qrURL) else { return nil }
      offer = fresh
      refresh()
      return (fresh.qrURL, fresh.code, fresh.createdAt + PairingOffer.validFor * 1000, qrPath)
    }
  }

  func endPairing() { onMain { offer = nil; refresh() } }

  /// Called by JS whenever the recording changes; the remotes get the new state at once.
  func sync(recording: Bool, clipCount: Int, startedAt: Double?) {
    onMain {
      lastState = .state(recording: recording, clipCount: clipCount, startedAt: startedAt)
      pushState()
    }
  }

  /// Only to remotes that are connected now: a vibration for an old save would just be noise.
  func signal(saved: Bool) {
    onMain { for link in authenticatedLinks { sendSealed(.result(saved: saved), to: link) } }
  }

  // MARK: Lifecycle

  private var authenticatedLinks: [Link] { links.values.filter { $0.authenticated } }

  /// Runs while the app wants remotes, or while a pairing is open.
  private func refresh() {
    let active = wanted || offer != nil
    if active {
      teardown?.cancel()
      teardown = nil
      if manager == nil {
        manager = CBPeripheralManager(delegate: self, queue: .main)
      }
      startHeartbeat()
      updateAdvertising()
    } else {
      scheduleTeardown()
    }
    emitStatus()
  }

  /// The setup screen and the pairing sheet hand the host over to each other, so for a moment nothing may want it.
  /// Wait a little: if something wants the host back in time, the links are never touched.
  private func scheduleTeardown() {
    guard teardown == nil else { return }
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.teardown = nil
      guard !(self.wanted || self.offer != nil) else { return }
      self.tearDownNow()
    }
    teardown = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.teardownGrace, execute: work)
  }

  private func tearDownNow() {
    manager?.stopAdvertising()
    manager?.removeAllServices()
    manager = nil
    tx = nil
    serviceAdded = false
    advertisedPairing = nil
    dropAllLinks()
    heartbeat?.cancel()
    heartbeat = nil
    emitStatus()
  }

  private func dropAllLinks() {
    let hadAuthenticated = !authenticatedLinks.isEmpty
    links.removeAll()
    outbox.removeAll()
    checks.removeAll()
    preview.stop()
    lastPreviewAsk = nil
    if hadAuthenticated { onPreview?(false) }
  }

  private func addService() {
    guard let manager, manager.state == .poweredOn, !serviceAdded, tx == nil else { return }
    let rx = CBMutableCharacteristic(type: Self.rxUUID, properties: [.write], value: nil, permissions: [.writeable])
    let notify = CBMutableCharacteristic(type: Self.txUUID, properties: [.notify], value: nil, permissions: [.readable])
    let service = CBMutableService(type: Self.serviceUUID, primary: true)
    service.characteristics = [rx, notify]
    tx = notify
    manager.add(service)
  }

  /// Advertise only when there is something to answer: an open pairing or at least one paired remote.
  private func updateAdvertising() {
    guard let manager, manager.state == .poweredOn, serviceAdded else { return }
    let pairing = offer != nil
    let wantsAdvertising = pairing || !trusted.all.isEmpty
    let target: Bool? = wantsAdvertising ? pairing : nil
    if target == advertisedPairing, target == nil || manager.isAdvertising { return }
    manager.stopAdvertising()
    advertisedPairing = target
    guard wantsAdvertising else { return }
    manager.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID],
      CBAdvertisementDataLocalNameKey: pairing ? Self.advertisedPairingName : Self.advertisedName,
    ])
  }

  private func emitStatus() {
    let active = wanted || offer != nil
    // The same app runs both sides, and both send this event: `side` tells the screens whose status it is.
    var body: [String: Any] = ["side": "camera", "controllers": authenticatedLinks.count]
    switch bluetooth {
    case .unauthorized:
      body["link"] = "denied"
      body["reason"] = "unauthorized"
    case .poweredOff:
      body["link"] = "denied"
      body["reason"] = "off"
    default:
      if !authenticatedLinks.isEmpty { body["link"] = "connected" } else { body["link"] = active ? "searching" : "idle" }
    }
    emit?("onRemoteStatus", body)
  }

  /// A beat every `beatEvery` seconds to every connected remote, whatever the game is doing, so a waiting remote does not
  /// call the link lost. It also closes the preview service once nobody has asked for pictures for a while.
  private func startHeartbeat() {
    guard heartbeat == nil else { return }
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + Self.beatEvery, repeating: Self.beatEvery)
    timer.setEventHandler { [weak self] in
      guard let self else { return }
      self.pushState()
      if let asked = self.lastPreviewAsk, Date().timeIntervalSince(asked) > Self.previewIdle {
        self.lastPreviewAsk = nil
        self.preview.stop()
      }
    }
    timer.resume()
    heartbeat = timer
  }

  private func pushState() {
    for link in authenticatedLinks { sendSealed(lastState, to: link) }
  }

  // MARK: Sending

  private func sendSealed(_ message: RemoteMessage, to link: Link) {
    guard var session = link.session, let sealed = session.seal(message.data) else { return }
    link.session = session
    sendRaw(sealed, to: link)
  }

  private func sendRaw(_ message: Data, to link: Link) {
    let frames = BleFrames.split(message, id: link.nextMessageId, maxFrame: link.central.maximumUpdateValueLength)
    link.nextMessageId &+= 1
    for frame in frames { outbox.append((frame, link.central)) }
    flush()
  }

  private func flush() {
    guard let manager, let tx else { return outbox.removeAll() }
    while let next = outbox.first {
      if !manager.updateValue(next.frame, for: tx, onSubscribedCentrals: [next.central]) { return }
      outbox.removeFirst()
    }
  }

  // MARK: Receiving

  private func handle(_ message: Data, from link: Link) {
    guard !link.closed else { return }
    if link.session != nil {
      guard var session = link.session, let plain = session.open(message), let command = RemoteMessage.decode(data: plain) else { return }
      link.session = session
      received(command, from: link)
      return
    }
    let outcome = link.handshake.receive(message, offer: &offer, trusted: { [trusted] id in trusted.peer(id: id) }, now: nowMs)
    switch outcome {
    case let .send(data):
      sendRaw(data, to: link)
    case let .paired(remote, data, session):
      guard trusted.add(remote) else {
        Self.log.error("pairing refused: the list of remotes is full")
        sendRaw(BleHandshakeMessage.refused(.closed).wire, to: link)
        link.closed = true
        return
      }
      offer = nil  // spent: one remote per code
      Self.log.info("pairing with \(String(remote.id.prefix(8)), privacy: .public) complete")
      link.session = session
      link.remoteId = remote.id
      sendRaw(data, to: link)
      emit?("onRemotePairing", ["phase": "paired", "peer": ["id": remote.id, "name": remote.name]])
      sendSealed(lastState, to: link)
      refresh()
    case let .connected(remoteId, data, session):
      Self.log.info("remote \(String(remoteId.prefix(8)), privacy: .public) connected")
      // A remote that connects again replaces its older link (the old one may not have noticed it is gone yet).
      for other in links.values where other !== link && other.remoteId == remoteId { other.closed = true }
      link.session = session
      link.remoteId = remoteId
      sendRaw(data, to: link)
      sendSealed(lastState, to: link)
      emitStatus()
    case let .refuse(data):
      let who = link.handshake.remoteId.map { String($0.prefix(8)) } ?? "?"
      Self.log.info("remote \(who, privacy: .public) refused")
      sendRaw(data, to: link)
      link.closed = true
      if let current = offer, current.isLocked {
        emit?("onRemotePairing", ["phase": "offerEnded", "reason": "locked"])
      }
    case .drop:
      let who = link.handshake.remoteId.map { String($0.prefix(8)) } ?? "?"
      Self.log.error("remote \(who, privacy: .public) dropped: bad handshake message or proof")
      link.closed = true
    }
  }

  /// Only `save`, `stop`, `start`, `preview`, `forget` and `pong` from an authenticated remote count. JS decides whether the
  /// game is in a state where each one makes sense.
  private func received(_ message: RemoteMessage, from link: Link) {
    guard let remoteId = link.remoteId else { return }
    switch message {
    case .save:
      emit?("onTrigger", ["source": "phone", "at": nowMs])
    case .stop:
      emit?("onRemoteStop", [:])
    case .start:
      emit?("onRemoteStart", [:])
    case let .preview(on):
      if on {
        lastPreviewAsk = Date()
        preview.start()
        if !link.previewGranted {
          let grant = preview.grant(remoteId: remoteId)
          sendSealed(.previewLink(service: grant.service, token: grant.token, key: grant.key), to: link)
          link.previewGranted = true
        }
      }
      onPreview?(on)
    case let .pong(token):
      if let open = checks.removeValue(forKey: token), open.remoteId == remoteId {
        let ms = Int(Date().timeIntervalSince(open.sentAt) * 1000)
        emit?("onRemoteCheck", ["id": open.remoteId, "ok": true, "ms": ms])
      }
    case .forget:
      // The remote was unpaired on its own side: drop it here too, so the two lists agree.
      trusted.remove(id: remoteId)
      preview.revoke(remoteId: remoteId)
      link.closed = true
      refresh()
    default:
      break
    }
  }

  private func linkFor(_ central: CBCentral) -> Link {
    if let existing = links[central.identifier] { return existing }
    let created = Link(central: central, handshake: BleHostHandshake(hostId: DeviceIdentity.id, hostName: DeviceIdentity.name))
    links[central.identifier] = created
    return created
  }

  private func dropLink(_ central: CBCentral) {
    guard let link = links.removeValue(forKey: central.identifier) else { return }
    outbox.removeAll { $0.central.identifier == central.identifier }
    if let id = link.remoteId { Self.log.info("remote \(String(id.prefix(8)), privacy: .public) disconnected") }
    if authenticatedLinks.isEmpty {
      onPreview?(false)
      preview.stop()
      lastPreviewAsk = nil
    }
    emitStatus()
  }
}

extension RemoteHost: CBPeripheralManagerDelegate {
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    bluetooth = peripheral.state
    Self.log.info("bluetooth state \(peripheral.state.rawValue, privacy: .public)")
    if peripheral.state == .poweredOn {
      addService()
    } else {
      // Bluetooth off (or not allowed): every link is gone and the service must be added again later.
      tx = nil
      serviceAdded = false
      advertisedPairing = nil
      dropAllLinks()
    }
    emitStatus()
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    if let error {
      Self.log.error("service not added: \(error.localizedDescription, privacy: .public)")
      tx = nil
      return
    }
    serviceAdded = true
    updateAdvertising()
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    if let error {
      Self.log.error("advertising failed: \(error.localizedDescription, privacy: .public)")
      advertisedPairing = nil
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    guard characteristic.uuid == Self.txUUID else { return }
    // A fresh subscription is a fresh link: whatever this central said before does not count any more.
    links.removeValue(forKey: central.identifier)
    _ = linkFor(central)
    // Ask for the shortest connection interval: a command and its answer cross faster, and a weak link at a distance
    // retries sooner. It costs a little more battery on both phones, only while the remote is linked.
    peripheral.setDesiredConnectionLatency(.low, for: central)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    guard characteristic.uuid == Self.txUUID else { return }
    dropLink(central)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests where request.characteristic.uuid == Self.rxUUID {
      guard let value = request.value else { continue }
      let link = linkFor(request.central)
      if let message = link.assembler.add(value, now: Date().timeIntervalSince1970) {
        handle(message, from: link)
      }
    }
    if let first = requests.first { peripheral.respond(to: first, withResult: .success) }
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    flush()
  }
}
