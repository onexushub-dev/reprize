import { useSyncExternalStore } from 'react';
import { AppState, Linking } from 'react-native';

import { hasStoreUpdate, storeUrl } from './storeCheck';

/** Coming back after this long counts as opening the app again; a quick trip to another app does not. */
const REOPEN_AFTER_MS = 30 * 60 * 1000;

// Kept in memory on purpose: closing the notice lasts until the app is opened again.
let visible = false;
let checking = false;
const listeners = new Set<() => void>();

function setVisible(next: boolean) {
  if (next === visible) return;
  visible = next;
  listeners.forEach((listener) => listener());
}

async function check() {
  if (checking) return;
  checking = true;
  try {
    setVisible(await hasStoreUpdate());
  } finally {
    checking = false;
  }
}

/** Checks the store now and on every return after a long time away. Returns the function that stops it. */
export function startUpdateNotice(): () => void {
  void check();
  let leftAt: number | undefined;
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'background') {
      leftAt = Date.now();
    } else if (next === 'active' && leftAt !== undefined) {
      const reopened = Date.now() - leftAt >= REOPEN_AFTER_MS;
      leftAt = undefined;
      if (reopened) void check();
    }
  });
  return () => sub.remove();
}

export function dismissUpdateNotice() {
  setVisible(false);
}

/** Opens the app's store page; the notice closes, since the player already acted on it. */
export function openUpdateInStore() {
  dismissUpdateNotice();
  void Linking.openURL(storeUrl()).catch(() => {});
}

export const isUpdateNoticeVisible = () => visible;

export function subscribeUpdateNotice(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdateNotice() {
  return useSyncExternalStore(subscribeUpdateNotice, isUpdateNoticeVisible);
}
