package expo.modules.replaycamera.remote

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val PREFS = "reprize.remote"

/** Who this phone is to the other one (iOS `DeviceIdentity`): a random id that stays the same, and a name to show. */
object DeviceIdentity {
  private const val MAX_LENGTH = 30

  fun id(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.getString("deviceId", null)?.let { return it }
    val fresh = UUID.randomUUID().toString().uppercase()
    prefs.edit().putString("deviceId", fresh).apply()
    return fresh
  }

  /** The name the person chose, else the phone's own name in Settings ("POCO X3 NFC"), else "model#code". */
  fun name(context: Context): String {
    val custom = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("deviceName", null)?.trim()
    if (!custom.isNullOrEmpty()) return custom.take(MAX_LENGTH)
    val system = runCatching { Settings.Global.getString(context.contentResolver, "device_name") }.getOrNull()?.trim()
    if (!system.isNullOrEmpty()) return system.take(MAX_LENGTH)
    return "${Build.MODEL}#${id(context).take(4)}".take(MAX_LENGTH)
  }

  fun setCustomName(context: Context, name: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("deviceName", name.trim().take(MAX_LENGTH)).apply()
  }
}

/**
 * The trusted list of one role, in the app's preferences, encrypted with an Android Keystore key (the pair keys never
 * sit in plain text; the iPhone keeps them in the Keychain).
 */
class PrefsPeerStore(context: Context, private val account: String) : PeerKeyStore {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .build())
    return generator.generateKey()
  }

  override fun load(): List<TrustedPeer> = runCatching {
    val stored = prefs.getString(account, null) ?: return emptyList()
    val bytes = B64.decode(stored) ?: return emptyList()
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
    val items = JSONArray(String(cipher.doFinal(bytes, 12, bytes.size - 12)))
    (0 until items.length()).mapNotNull { i ->
      val item = items.getJSONObject(i)
      B64.decode(item.getString("key"))?.let { TrustedPeer(item.getString("id"), item.getString("name"), it) }
    }
  }.getOrElse { emptyList() }

  override fun save(peers: List<TrustedPeer>) {
    runCatching {
      val items = JSONArray()
      peers.forEach { items.put(JSONObject().put("id", it.id).put("name", it.name).put("key", B64.encode(it.key))) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key())
      prefs.edit().putString(account, B64.encode(cipher.iv + cipher.doFinal(items.toString().toByteArray()))).apply()
    }
  }

  private companion object {
    const val ALIAS = "reprize.remote.peers"
  }
}
