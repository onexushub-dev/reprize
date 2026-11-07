package expo.modules.replaycamera.remote

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.ArrayDeque
import java.util.UUID

/** The BLE contract shared with the iPhone (RemoteHost.swift): one service, `rx` written by the remote, `tx` notified. */
object RemoteBle {
  val SERVICE: UUID = UUID.fromString("6E3F1001-8C1B-4F6E-9D4B-2A7C5E0B1A10")
  val RX: UUID = UUID.fromString("6E3F1002-8C1B-4F6E-9D4B-2A7C5E0B1A10")
  val TX: UUID = UUID.fromString("6E3F1003-8C1B-4F6E-9D4B-2A7C5E0B1A10")
  val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  /** The camera phone's advertised name: paired remotes only, or a pairing open. */
  const val NAME = "Reprize"
  const val PAIRING_NAME = "Reprize+"
  /** An Android camera phone cannot choose the name it advertises, so an open pairing is a second service id in the scan response. */
  val PAIRING: UUID = UUID.fromString("6E3F1004-8C1B-4F6E-9D4B-2A7C5E0B1A10")

  /** The camera phone also advertises: Android 12+ "Nearby devices" again (before that nothing extra is asked). */
  fun hostPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
    else emptyArray()

  fun hostGranted(context: Context): Boolean =
    hostPermissions().all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

  /** What scanning and connecting need: Android 12+ "Nearby devices", before that the location permission. */
  fun permissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

  fun granted(context: Context): Boolean =
    permissions().all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
}

/**
 * Remote-phone side of the phone remote, over Bluetooth LE: the Android port of RemoteController.swift, speaking the
 * same protocol, so an Android phone controls an iPhone camera (and later an Android one).
 *
 * The phone is a BLE central. While the remote screen is open it scans for the camera phone's service and connects; on
 * a drop it scans again at once (an iPhone changes its Bluetooth address every few minutes, so the scan, not a saved
 * address, finds it). It also pairs: from the `reprize://pair` link (the QR secret) or from the 6 digits typed.
 * No camera preview on Android for now (the iPhone sends it over Apple-only peer-to-peer Wi-Fi).
 * Every step logs to logcat (tag `ReprizeRemote`).
 */
@SuppressLint("MissingPermission")
class RemoteController(context: Context) {
  companion object {
    private const val TAG = "ReprizeRemote"
    /** A phone that turned out not to be ours is left alone this long. */
    private const val BLOCK_MS = 30_000L
    private const val PAIR_TIMEOUT_MS = 20_000L
    /** A connection that never gets to the handshake is given up after this. */
    private const val CONNECT_TIMEOUT_MS = 12_000L
    private const val REQUESTED_MTU = 517

    @Volatile private var instance: RemoteController? = null

    fun shared(context: Context): RemoteController =
      instance ?: synchronized(this) { instance ?: RemoteController(context.applicationContext).also { instance = it } }
  }

  /** (event name, body), like the iOS module. */
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null

  private val context = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private val hosts = TrustedPeers(PrefsPeerStore(context, "reprize.remote.hosts"))
  private val manager = context.getSystemService(BluetoothManager::class.java)
  private val adapter: BluetoothAdapter? get() = manager?.adapter

  private var wanted = false
  /** The QR secret or the code's bytes while pairing. */
  private var pairKey: ByteArray? = null
  private val pairTimeout = Runnable { if (pairKey != null) fail("notFound") }
  private var scanning = false
  private var gatt: BluetoothGatt? = null
  private var rx: BluetoothGattCharacteristic? = null
  private var mtu = 23
  private var handshake: BleRemoteHandshake? = null
  private var session: BleSession? = null
  private var assembler = BleFrames.Assembler()
  private var nextMessageId = 0
  private val writes = ArrayDeque<ByteArray>()
  private var writing = false
  private val blocked = HashMap<String, Long>()
  /** The camera's address on the last good link: `unpaired` is only believed from it (a stranger's is ignored). */
  private var lastCameraAddress: String? = null
  private var lastLink: String? = null
  private var receiverOn = false
  private val connectTimeout = Runnable {
    if (session == null && gatt != null) {
      Log.i(TAG, "connection did not reach the handshake in time")
      closeGatt()
      lookForCamera()
    }
  }

  private fun onMain(work: () -> Unit) = if (Looper.myLooper() == Looper.getMainLooper()) work() else { main.post(work); Unit }

  // ---- JS API

  fun start() = onMain { wanted = true; refresh() }

  fun stop() = onMain { wanted = false; refresh() }

  val host: TrustedPeer? get() = hosts.all.firstOrNull()

  fun forget() = onMain {
    if (session != null) send(RemoteMessage.Forget)
    hosts.all.forEach { hosts.remove(it.id) }
    lastCameraAddress = null
    // Give the message a moment to leave before the link is cut.
    main.postDelayed({ if (pairKey == null) { closeGatt(); refresh() } }, 500)
    emitStatus()
  }

  /** `secret`: the base64url text of the `reprize://pair` link. The result arrives as `onRemotePairing`. */
  fun pairWithLink(secret: String) = onMain {
    val key = decodeSecret(secret) ?: return@onMain fail("notFound")
    beginPairing(key)
  }

  fun pairWithCode(code: String) = onMain { beginPairing(code.toByteArray()) }

  fun save() = onMain { send(RemoteMessage.Save) }

  fun endRecording() = onMain { send(RemoteMessage.Stop) }

  fun startRecording() = onMain { send(RemoteMessage.Start) }

  /** Permissions or Bluetooth changed (the module asked for them): look again and tell the screen. */
  /** An iPhone camera says it by name ("Reprize+"); an Android one by the second service id. */
  private fun isPairingOpen(result: ScanResult): Boolean =
    result.scanRecord?.deviceName == RemoteBle.PAIRING_NAME ||
      result.scanRecord?.serviceUuids?.contains(ParcelUuid(RemoteBle.PAIRING)) == true

  fun permissionsChanged() = onMain { refresh() }

  // ---- Lifecycle

  private val active get() = wanted || pairKey != null

  private fun refresh() {
    if (active) {
      registerReceiver()
      lookForCamera()
    } else {
      stopScan()
      closeGatt()
      unregisterReceiver()
    }
    emitStatus()
  }

  private val bluetoothReceiver = object : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent) {
      when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
        BluetoothAdapter.STATE_ON -> onMain { lookForCamera(); emitStatus() }
        BluetoothAdapter.STATE_OFF -> onMain {
          // Every link is gone with it, without a disconnect callback.
          scanning = false
          closeGatt()
          emitStatus()
        }
      }
    }
  }

  private fun registerReceiver() {
    if (receiverOn) return
    ContextCompat.registerReceiver(context, bluetoothReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
      ContextCompat.RECEIVER_NOT_EXPORTED)
    receiverOn = true
  }

  private fun unregisterReceiver() {
    if (!receiverOn) return
    runCatching { context.unregisterReceiver(bluetoothReceiver) }
    receiverOn = false
  }

  private fun usable(): Boolean = RemoteBle.granted(context) && adapter?.isEnabled == true

  /** Scan for the camera phone's service unless a link is up or being made. */
  private fun lookForCamera() {
    if (!active || !usable() || gatt != null || session != null) return
    if (pairKey == null && hosts.all.isEmpty()) return
    if (scanning) return
    val scanner = adapter?.bluetoothLeScanner ?: return
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(RemoteBle.SERVICE)).build()
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    runCatching { scanner.startScan(listOf(filter), settings, scanCallback) }
      .onSuccess { scanning = true; Log.i(TAG, "scanning") }
      .onFailure { Log.e(TAG, "scan failed to start: $it") }
  }

  private fun stopScan() {
    if (!scanning) return
    scanning = false
    runCatching { adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) = onMain { discovered(result) }
    override fun onScanFailed(errorCode: Int) = onMain {
      Log.e(TAG, "scan failed: $errorCode")
      scanning = false
      main.postDelayed({ lookForCamera() }, 2_000)
    }
  }

  private fun discovered(result: ScanResult) {
    if (!active || gatt != null || session != null) return
    val device = result.device
    val since = blocked[device.address]
    if (since != null && SystemClock.elapsedRealtime() - since < BLOCK_MS) return
    // While pairing, only a camera with a pairing open: a nearby one that is not pairing never gets an attempt.
    if (pairKey != null && !isPairingOpen(result)) return
    Log.i(TAG, "connecting to ${device.address.takeLast(5)} (${result.scanRecord?.deviceName})")
    stopScan()
    connect(device)
  }

  private fun connect(device: BluetoothDevice) {
    resetLink()
    gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    main.removeCallbacks(connectTimeout)
    main.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
  }

  private fun closeGatt() {
    main.removeCallbacks(connectTimeout)
    gatt?.let { runCatching { it.disconnect(); it.close() } }
    gatt = null
    resetLink()
  }

  /** Everything about the current link. */
  private fun resetLink() {
    rx = null
    mtu = 23
    handshake = null
    session = null
    assembler = BleFrames.Assembler()
    writes.clear()
    writing = false
  }

  private fun beginPairing(key: ByteArray) {
    pairKey = key
    main.removeCallbacks(pairTimeout)
    main.postDelayed(pairTimeout, PAIR_TIMEOUT_MS)
    // Pairing needs its own handshake: let go of the current link first.
    stopScan()
    closeGatt()
    refresh()
  }

  private fun fail(reason: String) {
    val wasPairing = pairKey != null
    pairKey = null
    main.removeCallbacks(pairTimeout)
    if (wasPairing && session == null) closeGatt()
    emit?.invoke("onRemotePairing", mapOf("phase" to "failed", "reason" to reason))
    refresh()
  }

  private fun emitStatus() {
    // The same app runs both sides: `side` tells the screens whose status this is.
    val body = mutableMapOf<String, Any?>("side" to "remote")
    when {
      !RemoteBle.granted(context) -> { body["link"] = "denied"; body["reason"] = "unauthorized" }
      adapter?.isEnabled != true -> { body["link"] = "denied"; body["reason"] = "off" }
      session != null && pairKey == null -> body["link"] = "connected"
      else -> body["link"] = if (active) "searching" else "idle"
    }
    hosts.all.firstOrNull()?.let { body["peerName"] = it.name }
    lastLink = body["link"] as String
    emit?.invoke("onRemoteStatus", body)
  }

  private fun block(why: String) {
    val address = gatt?.device?.address
    Log.i(TAG, "leaving ${address?.takeLast(5)} alone: $why")
    if (address != null) blocked[address] = SystemClock.elapsedRealtime()
    closeGatt()
  }

  // ---- Sending

  private fun send(message: RemoteMessage) {
    val current = session ?: return
    writeRaw(current.seal(message.data))
  }

  private fun writeRaw(message: ByteArray) {
    if (gatt == null || rx == null) return
    BleFrames.split(message, nextMessageId, mtu - 3).forEach(writes::add)
    nextMessageId = (nextMessageId + 1) and 0xFFFF
    pump()
  }

  /** Android runs one GATT operation at a time: the next frame goes when the last write is acknowledged. */
  private fun pump() {
    if (writing) return
    val g = gatt ?: return
    val characteristic = rx ?: return
    val frame = writes.pollFirst() ?: return
    writing = true
    val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeCharacteristic(characteristic, frame, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      @Suppress("DEPRECATION")
      characteristic.value = frame
      @Suppress("DEPRECATION")
      g.writeCharacteristic(characteristic)
    }
    if (!ok) {
      writing = false
      Log.e(TAG, "write refused; retrying")
      writes.addFirst(frame)
      main.postDelayed({ pump() }, 50)
    }
  }

  // ---- Receiving

  private fun startHandshake() {
    val key = pairKey
    val host = hosts.all.firstOrNull()
    val mode = when {
      key != null -> BleRemoteHandshake.Mode.Pair(key)
      host != null -> BleRemoteHandshake.Mode.Reconnect(host)
      else -> return closeGatt()
    }
    val created = BleRemoteHandshake(mode, DeviceIdentity.id(context), DeviceIdentity.name(context))
    handshake = created
    writeRaw(created.hello())
  }

  private fun handle(message: ByteArray) {
    val current = session
    if (current != null) {
      // The only plain message after the handshake: the camera phone removed this remote.
      if (message.firstOrNull() == BleWire.HANDSHAKE) {
        if (BleHandshakeMessage.decode(message) is BleHandshakeMessage.Unpaired) heardUnpaired()
        return
      }
      val plain = current.open(message) ?: return
      RemoteMessage.decode(plain)?.let(::received)
      return
    }
    val shake = handshake ?: return
    val address = gatt?.device?.address
    when (val outcome = shake.receive(message)) {
      is BleRemoteHandshake.Outcome.Send -> writeRaw(outcome.data)
      is BleRemoteHandshake.Outcome.Paired -> {
        hosts.all.forEach { hosts.remove(it.id) } // a remote has one camera phone
        hosts.add(outcome.host)
        lastCameraAddress = address
        pairKey = null
        main.removeCallbacks(pairTimeout)
        main.removeCallbacks(connectTimeout)
        session = outcome.session
        handshake = null
        Log.i(TAG, "paired with ${outcome.host.id.take(8)}")
        emit?.invoke("onRemotePairing", mapOf("phase" to "paired", "peer" to mapOf("id" to outcome.host.id, "name" to outcome.host.name)))
        emitStatus()
      }
      is BleRemoteHandshake.Outcome.Connected -> {
        lastCameraAddress = address
        main.removeCallbacks(connectTimeout)
        session = outcome.session
        handshake = null
        Log.i(TAG, "connected")
        emitStatus()
      }
      is BleRemoteHandshake.Outcome.Failed -> {
        when (val failure = outcome.failure) {
          is BleHandshakeFailure.Refused ->
            if (pairKey != null) fail(failure.reason.raw) else block("refused ${failure.reason.raw}")
          BleHandshakeFailure.Unpaired ->
            if (pairKey != null) block("unpaired while pairing")
            else if (address != null && address == lastCameraAddress) heardUnpaired()
            // Another camera phone that does not know us: not ours, nothing to forget.
            else block("another camera")
          BleHandshakeFailure.WrongHost -> block("could not prove it is our camera")
          BleHandshakeFailure.Malformed -> block("bad handshake message")
        }
        lookForCamera()
      }
    }
  }

  /** Our camera phone says it does not know this remote any more: forget it, like "Esquecer" here. */
  private fun heardUnpaired() {
    Log.i(TAG, "the camera phone removed this remote")
    hosts.all.forEach { hosts.remove(it.id) }
    lastCameraAddress = null
    closeGatt()
    emit?.invoke("onRemotePairing", mapOf("phase" to "failed", "reason" to "denied"))
    refresh()
  }

  private fun received(message: RemoteMessage) {
    // A sealed message is proof the link is up: make sure the screen agrees.
    if (lastLink != "connected") emitStatus()
    when (message) {
      is RemoteMessage.State -> emit?.invoke("onRemoteState",
        mutableMapOf<String, Any?>("recording" to message.recording, "clipCount" to message.clipCount)
          .also { body -> message.startedAt?.let { body["startedAt"] = it } })
      is RemoteMessage.Result -> emit?.invoke("onRemoteResult", mapOf("saved" to message.saved))
      // The camera phone's "Verificar": answer at once.
      is RemoteMessage.Ping -> send(RemoteMessage.Pong(message.token))
      else -> {}
    }
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) = onMain {
      if (g != gatt) {
        runCatching { g.close() }
        return@onMain
      }
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
        if (!g.requestMtu(REQUESTED_MTU)) g.discoverServices()
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        val wasConnected = session != null
        Log.i(TAG, if (wasConnected) "link lost (status $status)" else "disconnected before linking (status $status)")
        runCatching { g.close() }
        gatt = null
        main.removeCallbacks(connectTimeout)
        resetLink()
        emitStatus()
        main.postDelayed({ lookForCamera() }, 300)
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, value: Int, status: Int) = onMain {
      if (g != gatt) return@onMain
      if (status == BluetoothGatt.GATT_SUCCESS) mtu = value
      g.discoverServices()
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = onMain {
      if (g != gatt) return@onMain
      val service = g.getService(RemoteBle.SERVICE) ?: return@onMain block("no remote service")
      val write = service.getCharacteristic(RemoteBle.RX)
      val notify = service.getCharacteristic(RemoteBle.TX)
      if (write == null || notify == null) return@onMain block("no remote characteristics")
      rx = write
      g.setCharacteristicNotification(notify, true)
      val cccd = notify.getDescriptor(RemoteBle.CCCD) ?: return@onMain block("cannot subscribe")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
      } else {
        @Suppress("DEPRECATION")
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        @Suppress("DEPRECATION")
        g.writeDescriptor(cccd)
      }
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) = onMain {
      if (g != gatt || descriptor.uuid != RemoteBle.CCCD) return@onMain
      if (status != BluetoothGatt.GATT_SUCCESS) return@onMain block("could not subscribe ($status)")
      startHandshake()
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) = onMain {
      if (g != gatt) return@onMain
      writing = false
      if (status != BluetoothGatt.GATT_SUCCESS) Log.e(TAG, "write failed ($status)")
      pump()
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      val copy = value.copyOf()
      onMain { notified(g, characteristic, copy) }
    }

    @Deprecated("Android 12 and older")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
      @Suppress("DEPRECATION")
      val copy = characteristic.value?.copyOf() ?: return
      onMain { notified(g, characteristic, copy) }
    }
  }

  private fun notified(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
    if (g != gatt || characteristic.uuid != RemoteBle.TX) return
    assembler.add(value, SystemClock.elapsedRealtime() / 1000.0)?.let(::handle)
  }

  private fun decodeSecret(text: String): ByteArray? {
    var base64 = text.replace("-", "+").replace("_", "/")
    while (base64.length % 4 != 0) base64 += "="
    return B64.decode(base64)?.takeIf { it.size == 16 }
  }
}
