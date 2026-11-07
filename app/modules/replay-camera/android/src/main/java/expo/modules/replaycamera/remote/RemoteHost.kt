package expo.modules.replaycamera.remote

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import java.io.File
import java.util.ArrayDeque

/**
 * Camera-phone side of the phone remote, over Bluetooth LE: the Android port of RemoteHost.swift, speaking the same
 * protocol, so an iPhone (or another Android) controls this phone.
 *
 * The phone is a BLE peripheral with a GATT server: it advertises one service while the app wants remotes and a
 * remote is paired (or a pairing is open). Each remote that subscribes to `tx` runs the handshake in `BleHostHandshake`;
 * after it every message is sealed. A tap on the remote becomes `onTrigger('phone')`; the recording state and the save
 * results go back to every connected remote.
 *
 * Differences from the iPhone: Android cannot choose its advertised name, so an open pairing is a second service id
 * (`RemoteBle.PAIRING`) in the scan response; and a refused link is cut off from here. No camera preview.
 * Every step logs to logcat (tag `ReprizeHost`).
 */
@SuppressLint("MissingPermission")
class RemoteHost(private val context: Context) {
  companion object {
    private const val TAG = "ReprizeHost"
    private const val BEAT_MS = 5_000L
    private const val PING_TIMEOUT_MS = 3_000L
    private const val TEARDOWN_GRACE_MS = 3_000L
    private const val CUT_DELAY_MS = 600L
    /** One remote per camera phone, like the iPhone. */
    const val MAX_REMOTES = 1

    @Volatile private var instance: RemoteHost? = null

    fun shared(context: Context): RemoteHost =
      instance ?: synchronized(this) { instance ?: RemoteHost(context.applicationContext).also { instance = it } }
  }

  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null

  private class Link(val device: BluetoothDevice, var handshake: BleHostHandshake) {
    var session: BleSession? = null
    var remoteId: String? = null
    val assembler = BleFrames.Assembler()
    var nextMessageId = 0
    var mtu = 23
    var closed = false
    val authenticated get() = session != null && remoteId != null && !closed
  }

  private val main = Handler(Looper.getMainLooper())
  private val trusted = TrustedPeers(PrefsPeerStore(context, "reprize.remote.controllers"))
  private val links = HashMap<String, Link>()
  private val outbox = ArrayDeque<Pair<Link, ByteArray>>()
  private var sending = false
  private var gatt: BluetoothGattServer? = null
  private var tx: BluetoothGattCharacteristic? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertisedPairing: Boolean? = null
  private var offer: PairingOffer? = null
  private var wanted = false
  private var beating = false
  private var lastState: RemoteMessage = RemoteMessage.State(false, 0, null)
  private val checks = HashMap<String, Pair<String, Long>>()
  private var teardown: Runnable? = null

  private val now get() = System.currentTimeMillis().toDouble()

  private fun onMain(work: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) work() else main.post(work)
  }

  private fun <T> onMainResult(work: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) return work()
    val latch = java.util.concurrent.CountDownLatch(1)
    var result: T? = null
    main.post { result = work(); latch.countDown() }
    latch.await()
    @Suppress("UNCHECKED_CAST") return result as T
  }

  private val adapter get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

  // ---- JS API

  fun start() = onMain {
    keepNewestRemote()
    wanted = true
    advertisedPairing = null
    refresh()
  }

  fun stop() = onMain { wanted = false; refresh() }

  val peers: List<TrustedPeer> get() = onMainResult { trusted.all }

  fun isConnected(id: String) = onMainResult { links.values.any { it.authenticated && it.remoteId == id } }

  val controllers: Int get() = onMainResult { authenticated().size }

  fun check(id: String) = onMain {
    val link = authenticated().firstOrNull { it.remoteId == id }
    if (link == null) {
      emit?.invoke("onRemoteCheck", mapOf("id" to id, "ok" to false, "ms" to 0))
      return@onMain
    }
    val token = java.util.UUID.randomUUID().toString().take(8)
    checks[token] = id to System.currentTimeMillis()
    sendSealed(RemoteMessage.Ping(token), link)
    main.postDelayed({
      if (checks.remove(token) != null) emit?.invoke("onRemoteCheck", mapOf("id" to id, "ok" to false, "ms" to 0))
    }, PING_TIMEOUT_MS)
  }

  fun remove(id: String) = onMain {
    trusted.remove(id)
    links.values.filter { it.remoteId == id }.forEach { link ->
      sendRaw(BleHandshakeMessage.Unpaired.wire, link) // it forgets this phone and disconnects
      close(link)
    }
    refresh()
  }

  private fun keepNewestRemote() {
    for (dropped in trusted.keepNewest(MAX_REMOTES)) {
      Log.i(TAG, "only one remote now: removed ${dropped.id.take(8)}")
      links.values.filter { it.remoteId == dropped.id }.forEach { sendRaw(BleHandshakeMessage.Unpaired.wire, it); close(it) }
    }
  }

  /** Opens a pairing: null while a remote is paired (one remote per camera phone). */
  fun beginPairing(): Map<String, Any?>? = onMainResult {
    if (trusted.all.size >= MAX_REMOTES) return@onMainResult null
    val fresh = PairingOffer.make(DeviceIdentity.id(context), DeviceIdentity.name(context), now)
    // A new file name per offer: the screen caches an image by its address, and an old QR holds an old secret.
    context.cacheDir.listFiles { f -> f.name.startsWith("pairing-qr") }?.forEach { it.delete() }
    val qr = QrImage.png(fresh.qrUrl, File(context.cacheDir, "pairing-qr-${fresh.code}.png")) ?: return@onMainResult null
    offer = fresh
    refresh()
    mapOf("url" to fresh.qrUrl, "code" to fresh.code, "expiresAt" to fresh.createdAt + PairingOffer.VALID_FOR * 1000, "qrPath" to qr.absolutePath)
  }

  fun endPairing() = onMain { offer = null; refresh() }

  fun sync(recording: Boolean, clipCount: Int, startedAt: Double?) = onMain {
    lastState = RemoteMessage.State(recording, clipCount, startedAt)
    pushState()
  }

  fun signal(saved: Boolean) = onMain { authenticated().forEach { sendSealed(RemoteMessage.Result(saved), it) } }

  fun permissionsChanged() = onMain { refresh() }

  // ---- Lifecycle

  private fun authenticated() = links.values.filter { it.authenticated }

  private fun refresh() {
    if (wanted || offer != null) {
      teardown?.let(main::removeCallbacks)
      teardown = null
      openServer()
      startBeat()
      updateAdvertising()
    } else if (teardown == null) {
      val work = Runnable {
        teardown = null
        if (!(wanted || offer != null)) tearDownNow()
      }
      teardown = work
      main.postDelayed(work, TEARDOWN_GRACE_MS)
    }
    emitStatus()
  }

  private fun tearDownNow() {
    runCatching { advertiser?.stopAdvertising(advertiseCallback) }
    advertisedPairing = null
    runCatching { gatt?.close() }
    gatt = null
    tx = null
    links.clear()
    outbox.clear()
    sending = false
    checks.clear()
    beating = false
    emitStatus()
  }

  private fun openServer() {
    if (gatt != null) return
    val adapter = adapter ?: return
    if (!adapter.isEnabled || !RemoteBle.hostGranted(context)) return
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val server = manager.openGattServer(context, serverCallback) ?: return
    val rx = BluetoothGattCharacteristic(RemoteBle.RX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE)
    val notify = BluetoothGattCharacteristic(RemoteBle.TX, BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ)
    notify.addDescriptor(BluetoothGattDescriptor(RemoteBle.CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
    val service = BluetoothGattService(RemoteBle.SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    service.addCharacteristic(rx)
    service.addCharacteristic(notify)
    tx = notify
    gatt = server
    serviceReady = false
    server.addService(service)
  }

  @Volatile private var serviceReady = false

  private fun updateAdvertising() {
    if (!serviceReady) return
    val adapter = adapter ?: return
    val pairing = offer != null
    val wants = pairing || trusted.all.isNotEmpty()
    val target: Boolean? = if (wants) pairing else null
    if (target == advertisedPairing) return
    runCatching { advertiser?.stopAdvertising(advertiseCallback) }
    advertisedPairing = target
    if (!wants) return
    val le = adapter.bluetoothLeAdvertiser
    if (le == null) {
      Log.e(TAG, "no advertiser")
      advertisedPairing = null
      return
    }
    advertiser = le
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder().setIncludeDeviceName(false).addServiceUuid(ParcelUuid(RemoteBle.SERVICE)).build()
    val response = AdvertiseData.Builder().setIncludeDeviceName(false).also { if (pairing) it.addServiceUuid(ParcelUuid(RemoteBle.PAIRING)) }.build()
    Log.i(TAG, "advertising (pairing=$pairing)")
    le.startAdvertising(settings, data, response, advertiseCallback)
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartFailure(errorCode: Int) {
      Log.e(TAG, "advertising failed: $errorCode")
      main.post { advertisedPairing = null }
    }
  }

  private fun emitStatus() {
    val body = HashMap<String, Any?>()
    body["side"] = "camera"
    body["controllers"] = authenticated().size
    val active = wanted || offer != null
    val adapter = adapter
    when {
      adapter == null || !adapter.isEnabled -> { body["link"] = "denied"; body["reason"] = "off" }
      active && !RemoteBle.hostGranted(context) -> { body["link"] = "denied"; body["reason"] = "unauthorized" }
      authenticated().isNotEmpty() -> body["link"] = "connected"
      else -> body["link"] = if (active) "searching" else "idle"
    }
    emit?.invoke("onRemoteStatus", body)
  }

  private fun startBeat() {
    if (beating) return
    beating = true
    main.postDelayed(object : Runnable {
      override fun run() {
        if (!beating) return
        pushState()
        main.postDelayed(this, BEAT_MS)
      }
    }, BEAT_MS)
  }

  private fun pushState() = authenticated().forEach { sendSealed(lastState, it) }

  // ---- Sending

  private fun sendSealed(message: RemoteMessage, link: Link) {
    val sealed = link.session?.seal(message.data) ?: return
    sendRaw(sealed, link)
  }

  private fun sendRaw(message: ByteArray, link: Link) {
    val frames = BleFrames.split(message, link.nextMessageId, maxOf(20, link.mtu - 3))
    link.nextMessageId = (link.nextMessageId + 1) and 0xFFFF
    frames.forEach { outbox.add(link to it) }
    pump()
  }

  /** One notification at a time: the next goes when `onNotificationSent` says the stack took the last. */
  private fun pump() {
    if (sending) return
    val server = gatt
    val characteristic = tx
    val next = outbox.poll() ?: return
    if (server == null || characteristic == null) { outbox.clear(); return }
    sending = true
    @Suppress("DEPRECATION")
    val ok = runCatching {
      characteristic.value = next.second
      server.notifyCharacteristicChanged(next.first.device, characteristic, false)
    }.getOrDefault(false)
    if (!ok) { sending = false; pump() }
  }

  /** A peripheral on Android can cut a central off, after the last message had time to leave. */
  private fun close(link: Link) {
    link.closed = true
    main.postDelayed({ runCatching { gatt?.cancelConnection(link.device) } }, CUT_DELAY_MS)
  }

  // ---- Receiving

  private fun handle(message: ByteArray, link: Link) {
    if (link.closed) return
    val open = link.session
    if (open != null) {
      val plain = open.open(message) ?: return
      RemoteMessage.decode(plain)?.let { received(it, link) }
      return
    }
    when (val outcome = link.handshake.receive(message, offer, { trusted.peer(it) }, now)) {
      is BleHostHandshake.Outcome.Send -> sendRaw(outcome.data, link)
      is BleHostHandshake.Outcome.Paired -> {
        if (!trusted.add(outcome.remote)) {
          Log.e(TAG, "pairing refused: the list of remotes is full")
          sendRaw(BleHandshakeMessage.Refused(RemoteMessage.Reason.CLOSED).wire, link)
          close(link)
          return
        }
        offer = null // spent: one remote per code
        Log.i(TAG, "pairing with ${outcome.remote.id.take(8)} complete")
        link.session = outcome.session
        link.remoteId = outcome.remote.id
        sendRaw(outcome.send, link)
        emit?.invoke("onRemotePairing", mapOf("phase" to "paired", "peer" to mapOf("id" to outcome.remote.id, "name" to outcome.remote.name)))
        sendSealed(lastState, link)
        refresh()
      }
      is BleHostHandshake.Outcome.Connected -> {
        Log.i(TAG, "remote ${outcome.remoteId.take(8)} connected")
        links.values.filter { it !== link && it.remoteId == outcome.remoteId }.forEach { close(it) }
        link.session = outcome.session
        link.remoteId = outcome.remoteId
        sendRaw(outcome.send, link)
        sendSealed(lastState, link)
        emitStatus()
      }
      is BleHostHandshake.Outcome.Refuse -> {
        Log.i(TAG, "remote ${link.handshake.remoteId?.take(8) ?: "?"} refused (${String(outcome.send).take(60)}; attempts=${offer?.failedAttempts}, locked=${offer?.isLocked})")
        sendRaw(outcome.send, link)
        close(link)
        if (offer?.isLocked == true) emit?.invoke("onRemotePairing", mapOf("phase" to "offerEnded", "reason" to "locked"))
      }
      BleHostHandshake.Outcome.Drop -> {
        Log.e(TAG, "remote ${link.handshake.remoteId?.take(8) ?: "?"} dropped: bad handshake message or proof")
        close(link)
      }
    }
  }

  private fun received(message: RemoteMessage, link: Link) {
    val remoteId = link.remoteId ?: return
    when (message) {
      RemoteMessage.Save -> emit?.invoke("onTrigger", mapOf("source" to "phone", "at" to now))
      RemoteMessage.Stop -> emit?.invoke("onRemoteStop", emptyMap())
      RemoteMessage.Start -> emit?.invoke("onRemoteStart", emptyMap())
      is RemoteMessage.Pong -> checks.remove(message.token)?.let { (id, sentAt) ->
        if (id == remoteId) emit?.invoke("onRemoteCheck", mapOf("id" to id, "ok" to true, "ms" to (System.currentTimeMillis() - sentAt).toInt()))
      }
      RemoteMessage.Forget -> {
        trusted.remove(remoteId)
        close(link)
        refresh()
      }
      else -> Unit // the camera view is not offered on Android
    }
  }

  private fun linkFor(device: BluetoothDevice): Link =
    links.getOrPut(device.address) { Link(device, BleHostHandshake(DeviceIdentity.id(context), DeviceIdentity.name(context))) }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService) {
      main.post {
        Log.i(TAG, "service added: $status")
        serviceReady = status == BluetoothGatt.GATT_SUCCESS
        updateAdvertising()
      }
    }

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      main.post {
        if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          val link = links.remove(device.address) ?: return@post
          outbox.removeAll { it.first === link }
          link.remoteId?.let { Log.i(TAG, "remote ${it.take(8)} disconnected") }
          if (link.remoteId == null) offer?.let { current -> link.handshake.remoteId?.let(current::release) }
          advertisedPairing = null // Android may have stopped advertising while connected
          updateAdvertising()
          emitStatus()
        }
      }
    }

    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
      main.post { links[device.address]?.mtu = mtu }
    }

    override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
                                          preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) {
      if (responseNeeded) runCatching { gatt?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null) }
      if (descriptor.uuid != RemoteBle.CCCD || descriptor.characteristic.uuid != RemoteBle.TX) return
      val subscribing = value.isNotEmpty() && value[0].toInt() != 0
      main.post {
        if (subscribing) {
          // A fresh subscription is a fresh link: whatever this central said before does not count any more.
          links.remove(device.address)
          linkFor(device)
        } else {
          links.remove(device.address)
          emitStatus()
        }
      }
    }

    override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
                                              preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) {
      if (responseNeeded) runCatching { gatt?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value) }
      if (characteristic.uuid != RemoteBle.RX) return
      main.post {
        val link = linkFor(device)
        link.assembler.add(value, System.currentTimeMillis() / 1000.0)?.let { handle(it, link) }
      }
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
      main.post { sending = false; pump() }
    }
  }
}
