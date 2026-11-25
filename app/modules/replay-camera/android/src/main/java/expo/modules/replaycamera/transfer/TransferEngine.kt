package expo.modules.replaycamera.transfer

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

/**
 * The Android side of sharing's background transfers (sharing design §5.4 and §5.5), the same contract as the iPhone's
 * `BackgroundUploader` and `BackgroundDownloader`: the same functions, statuses (`running`, `paused`, `done`,
 * `failed`), entry fields and events, so the app's queues (src/cloud/uploadQueue.ts, receiveQueue.ts) run unchanged.
 *
 * One engine per direction. The state of every file is kept in `store` (SharedPreferences in the app), so a relaunch
 * knows what finished and `restore` starts again whatever was left running when the process died. A failed file starts
 * again from its first byte, up to `TransferRules.MAX_ATTEMPTS`. `keeper` keeps the process alive while there is work
 * (a WorkManager worker in the foreground) and wakes it when Wi-Fi comes back for Wi-Fi-only files.
 */
class TransferEngine(
  private val kind: Kind,
  private val store: Store,
  private val transport: Transport,
  private val metered: () -> Boolean,
  private val keeper: Keeper,
  private val scope: CoroutineScope,
  private val now: () -> Double,
) {
  enum class Kind(val done: String, val retry: String, val progress: String?, val field: String) {
    UPLOAD("onUploadDone", "onUploadRetry", "onUploadProgress", "sent"),
    DOWNLOAD("onDownloadDone", "onDownloadRetry", null, "received"),
  }

  /** One file to send (`url` a presigned PUT) or to receive (`url` a presigned GET, `path` where it goes). */
  data class Item(
    val id: String,
    val path: String,
    val url: String,
    val contentType: String = "video/mp4",
    val cellular: Boolean = true,
    val priority: Double = -1.0,
  )

  interface Store {
    fun load(): MutableMap<String, JSONObject>
    fun save(state: Map<String, JSONObject>)
  }

  /** The state as one JSON text, as the app's SharedPreferences keeps it. */
  open class MemoryStore : Store {
    protected open var text: String = "{}"
    override fun load(): MutableMap<String, JSONObject> {
      val json = JSONObject(text)
      return json.keys().asSequence().associateWith { json.getJSONObject(it) }.toMutableMap()
    }
    override fun save(state: Map<String, JSONObject>) {
      text = JSONObject().apply { state.forEach { (id, entry) -> put(id, entry) } }.toString()
    }
  }

  interface Transport {
    /** One PUT of the whole file; returns the HTTP status. Throws on a network error. */
    suspend fun upload(path: String, url: String, contentType: String, onProgress: (Long, Long) -> Unit): Int
    /** One GET written to `tempPath`; returns the HTTP status. Throws on a network error. */
    suspend fun download(url: String, tempPath: String, onProgress: (Long, Long) -> Unit): Int
    fun size(path: String): Long
    fun move(from: String, to: String)
  }

  interface Keeper {
    /** There is work: keep the process going (in the background too). */
    fun keepAlive()
    /** Only Wi-Fi-only files are left and the phone is on mobile data: run again when Wi-Fi is back. */
    fun waitForWifi()
  }

  /** Sends a module event; set by the module while it lives. Events sent with no listener are lost: the state is not. */
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null

  private val lock = Any()
  /** The transfer going on for each file, with its token: a replaced transfer that reports late is ignored. */
  private val jobs = HashMap<String, Pair<String, Job>>()
  private val lastProgress = HashMap<String, Long>()

  // ---- State

  private fun update(id: String, change: (JSONObject) -> Unit): JSONObject = synchronized(lock) {
    val state = store.load()
    val entry = state[id] ?: JSONObject().put("id", id)
    change(entry)
    state[id] = entry
    store.save(state)
    entry
  }

  private fun stored(id: String): JSONObject? = synchronized(lock) { store.load()[id] }

  // ---- API (the same as the iPhone's)

  /** Queues the files and starts them (or keeps them `paused`). An id already known is replaced: the URL may be fresh. */
  fun start(items: List<Item>, paused: Boolean) {
    val replaced = mutableListOf<Job>()
    for (raw in items) {
      val item = raw.copy(path = TransferRules.localPath(raw.path))
      synchronized(lock) { jobs.remove(item.id)?.let { replaced += it.second } }
      update(item.id) { e ->
        e.put("path", item.path).put("url", item.url)
        if (kind == Kind.UPLOAD) {
          e.put("contentType", item.contentType).put("cellular", item.cellular).put("priority", item.priority)
          e.put("bytes", transport.size(item.path).toDouble())
        } else {
          e.put("bytes", 0.0).put("moved", false)
        }
        e.put(kind.field, 0.0).put("attempts", 0).put("status", if (paused) "paused" else "running").put("queuedAt", now())
        e.remove("error")
        e.remove("finishedAt")
      }
    }
    replaced.forEach { it.cancel() }
    pump()
  }

  /** Stops every running transfer and keeps it `paused` (a recording started, or the phone is too hot). */
  fun pause() {
    val stopped = synchronized(lock) {
      val state = store.load()
      state.values.filter { it.optString("status") == "running" }.forEach { it.put("status", "paused") }
      store.save(state)
      val all = jobs.values.map { it.second }
      jobs.clear()
      all
    }
    stopped.forEach { it.cancel() }
  }

  /** Starts again every paused file from its first byte; uploads take the mobile data choice of now. */
  fun resume(cellular: Boolean) {
    synchronized(lock) {
      val state = store.load()
      for (e in state.values.filter { it.optString("status") == "paused" }) {
        e.put("status", "running").put(kind.field, 0.0).put("attempts", 0)
        if (kind == Kind.UPLOAD) e.put("cellular", cellular)
      }
      store.save(state)
    }
    pump()
  }

  /** Cancels these files and forgets them (an expired or turned-off share; a clip already in its recording). */
  fun remove(ids: List<String>) {
    val stopped = synchronized(lock) {
      val state = store.load()
      ids.forEach { state.remove(it) }
      store.save(state)
      ids.mapNotNull { jobs.remove(it)?.second }
    }
    stopped.forEach { it.cancel() }
    pump()
  }

  /** Every file the engine knows about, as the app reads it. */
  fun state(): List<Map<String, Any?>> = synchronized(lock) { store.load().values.map { toMap(it) } }

  /** Cancels every transfer and forgets every file. */
  fun reset() {
    val stopped = synchronized(lock) {
      store.save(emptyMap())
      val all = jobs.values.map { it.second }
      jobs.clear()
      all
    }
    stopped.forEach { it.cancel() }
  }

  /** On launch (and when the network changes): starts again whatever is running with no transfer behind it. */
  fun restore() = pump()

  /** Nothing going on and nothing that could start now. */
  fun idle(): Boolean = synchronized(lock) {
    jobs.isEmpty() && TransferRules.next(candidates(store.load()), emptySet(), 1, metered()).isEmpty()
  }

  // ---- Running

  private fun candidates(state: Map<String, JSONObject>) = state.values.map {
    TransferRules.Candidate(
      it.optString("id"), it.optString("status"), it.optBoolean("cellular", true), it.optDouble("priority", -1.0), it.optDouble("queuedAt", 0.0),
    )
  }

  private fun pump() {
    val started = mutableListOf<Job>()
    var keepAlive = false
    var waitWifi = false
    synchronized(lock) {
      val state = store.load()
      val all = candidates(state)
      val isMetered = metered()
      val next = TransferRules.next(all, jobs.keys, TransferRules.CONNECTIONS - jobs.size, isMetered)
      for (id in next) {
        val entry = state[id] ?: continue
        val token = UUID.randomUUID().toString()
        entry.put("token", token).put("attempts", entry.optInt("attempts", 0) + 1)
        if (!entry.has("startedAt")) entry.put("startedAt", now())
        if (kind == Kind.DOWNLOAD) entry.put("moved", false)
        val snapshot = JSONObject(entry.toString())
        val job = scope.launch(start = CoroutineStart.LAZY) { run(id, token, snapshot) }
        jobs[id] = token to job
        started += job
      }
      store.save(state)
      keepAlive = jobs.isNotEmpty()
      waitWifi = jobs.isEmpty() && TransferRules.waitsForWifi(all, isMetered)
    }
    if (keepAlive) keeper.keepAlive()
    if (waitWifi) keeper.waitForWifi()
    started.forEach { it.start() }
  }

  private suspend fun run(id: String, token: String, entry: JSONObject) {
    val path = entry.optString("path")
    val url = entry.optString("url")
    var status = 0
    var error: String? = null
    var cancelled = false
    try {
      status = when (kind) {
        Kind.UPLOAD -> transport.upload(path, url, entry.optString("contentType", "video/mp4")) { sent, total -> progress(id, token, sent, total) }
        Kind.DOWNLOAD -> transport.download(url, "$path.part") { received, total -> progress(id, token, received, total) }
      }
      if (kind == Kind.DOWNLOAD && status in 200..299) {
        try {
          transport.move("$path.part", path)
          update(id) { it.put("moved", true).put("bytes", transport.size(path).toDouble()) }
        } catch (e: Exception) {
          error = "move: ${e.message}"
        }
      }
    } catch (e: CancellationException) {
      cancelled = true
      error = "cancelled"
    } catch (e: Exception) {
      error = e.message ?: e.javaClass.simpleName
    }
    complete(id, token, status, error, cancelled)
  }

  private fun progress(id: String, token: String, done: Long, total: Long) {
    val time = System.nanoTime() / 1_000_000
    val due = synchronized(lock) {
      if (jobs[id]?.first != token) return
      val gap = if (kind == Kind.UPLOAD) 500 else 1000
      val last = lastProgress[id]
      val ok = last == null || time - last > gap || done == total
      if (ok) lastProgress[id] = time
      ok
    }
    if (!due) return
    update(id) { e ->
      e.put(kind.field, done.toDouble())
      if (kind == Kind.DOWNLOAD && total > 0) e.put("bytes", total.toDouble())
    }
    kind.progress?.let { name -> emit?.invoke(name, mapOf("id" to id, "sent" to done.toDouble(), "total" to total.toDouble())) }
  }

  private fun complete(id: String, token: String, httpStatus: Int, error: String?, cancelled: Boolean) {
    var event: Pair<String, Map<String, Any?>>? = null
    synchronized(lock) {
      if (jobs[id]?.first == token) jobs.remove(id)
      val entry = stored(id) ?: return@synchronized
      if (entry.optString("token") != token) return@synchronized
      val running = entry.optString("status") == "running"
      val attempts = entry.optInt("attempts", 0)
      val reason = error ?: "HTTP $httpStatus"
      when (TransferRules.outcome(httpStatus, error, cancelled, running, attempts)) {
        TransferRules.Outcome.DONE -> event = finish(id, true, httpStatus, null)
        TransferRules.Outcome.FAIL -> event = finish(id, false, httpStatus, reason)
        TransferRules.Outcome.RETRY -> event = kind.retry to mapOf("id" to id, "attempt" to attempts, "error" to reason)
        TransferRules.Outcome.IGNORE -> Unit
      }
    }
    event?.let { (name, body) -> emit?.invoke(name, body) }
    pump()
  }

  private fun finish(id: String, ok: Boolean, httpStatus: Int, error: String?): Pair<String, Map<String, Any?>> {
    val entry = update(id) { e ->
      e.put("status", if (ok) "done" else "failed").put("httpStatus", httpStatus).put("finishedAt", now())
      if (error == null) e.remove("error") else e.put("error", error)
      if (ok) e.put(kind.field, e.optDouble("bytes", 0.0))
    }
    return kind.done to (toMap(entry) + ("ok" to ok))
  }

  private companion object {
    val INTS = setOf("attempts", "httpStatus")
    val HIDDEN = setOf("token", "moved", "url", "contentType", "cellular", "priority")

    /** The entry as the app reads it (UploadEntry, DownloadEntry): numbers as doubles, counters as ints. */
    fun toMap(entry: JSONObject): Map<String, Any?> {
      val out = LinkedHashMap<String, Any?>()
      for (key in entry.keys()) {
        if (key in HIDDEN && key != "url") continue
        val value = entry.get(key)
        out[key] = when {
          value is Number && key in INTS -> value.toInt()
          value is Number -> value.toDouble()
          value == JSONObject.NULL -> null
          else -> value
        }
      }
      return out
    }
  }
}
