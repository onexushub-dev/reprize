/**
 * Bluetooth permissions for the phone remote (this phone as the remote of a camera phone, over BLE):
 * - Android 12+: BLUETOOTH_SCAN (declared never used for location, so no location prompt) and BLUETOOTH_CONNECT.
 * - BLUETOOTH_ADVERTISE: this phone as the camera phone waits for its remote (advertises the service).
 * - Android 11 and older: scanning needs the location permission (and the legacy BLUETOOTH ones); capped at API 30.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSIONS = [
  { name: 'android.permission.BLUETOOTH_SCAN', attrs: { 'android:usesPermissionFlags': 'neverForLocation' } },
  { name: 'android.permission.BLUETOOTH_CONNECT' },
  { name: 'android.permission.BLUETOOTH_ADVERTISE' },
  { name: 'android.permission.BLUETOOTH', attrs: { 'android:maxSdkVersion': '30' } },
  { name: 'android.permission.BLUETOOTH_ADMIN', attrs: { 'android:maxSdkVersion': '30' } },
  { name: 'android.permission.ACCESS_FINE_LOCATION', attrs: { 'android:maxSdkVersion': '30' } },
];

module.exports = function withAndroidBluetooth(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const list = (manifest['uses-permission'] = manifest['uses-permission'] || []);
    for (const p of PERMISSIONS) {
      const existing = list.filter((e) => e.$['android:name'] === p.name);
      existing.forEach((e) => list.splice(list.indexOf(e), 1));
      list.push({ $: { 'android:name': p.name, ...(p.attrs || {}) } });
    }
    const features = (manifest['uses-feature'] = manifest['uses-feature'] || []);
    if (!features.some((f) => f.$['android:name'] === 'android.hardware.bluetooth_le')) {
      features.push({ $: { 'android:name': 'android.hardware.bluetooth_le', 'android:required': 'false' } });
    }
    return cfg;
  });
};
