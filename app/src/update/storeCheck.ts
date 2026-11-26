import * as Application from 'expo-application';
import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';

import { isPlayUpdateAvailable } from '../../modules/replay-camera';
import { isNewerVersion } from './version';

const APP_STORE_ID = '6833159162';
const PLAY_PACKAGE = 'app.reprize.mobile';
const LOOKUP_TIMEOUT_MS = 5000;

type LookupResult = { version?: string; minimumOsVersion?: string };

/** The App Store's public lookup, in the store of the device region. The timestamp avoids its stale cached answers. */
async function appStoreHasUpdate(): Promise<boolean> {
  const current = Application.nativeApplicationVersion;
  const bundleId = Application.applicationId;
  if (!current || !bundleId) return false;

  const region = getLocales()[0].regionCode?.toLowerCase();
  const country = region ? `&country=${encodeURIComponent(region)}` : '';
  const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}${country}&t=${Date.now()}`;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) return false;
    const body = (await response.json()) as { results?: LookupResult[] };
    const latest = body.results?.[0];
    if (!latest?.version || !isNewerVersion(latest.version, current)) return false;
    // A version that needs a newer iOS than this iPhone has cannot be installed, so it is not offered.
    return !latest.minimumOsVersion || !isNewerVersion(latest.minimumOsVersion, String(Platform.Version));
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the store has a newer version for this phone. Offline, on error or outside the stores: false. */
export async function hasStoreUpdate(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') return await isPlayUpdateAvailable();
    if (Platform.OS === 'ios') return await appStoreHasUpdate();
    return false;
  } catch {
    return false;
  }
}

/** The app's page in the store of this platform. */
export function storeUrl(): string {
  return Platform.OS === 'android'
    ? `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`
    : `https://apps.apple.com/app/id${APP_STORE_ID}`;
}
