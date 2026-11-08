import { useCallback, useEffect, useRef } from 'react';

import { bluetoothConnected } from '../../modules/replay-camera';
import { repo } from '../data/mmkv';
import { diag } from '../diag/diagLog'; // TEMP(diag-remote)
import { describeLinkEvent } from '../diag/remoteLinkDiag'; // TEMP(diag-remote)
import { linkOf } from '../devices/bluetoothRemote';
import { createLinkMonitor, type LinkMonitor } from './linkMonitor';
import { useVolumeRemote, type VolumeRemoteOptions } from './useVolumeRemote';

/** TEMP(diag-remote): while listening, how often the remote's link is looked at, for the diagnostic log only. */
export const LINK_POLL_MS = 500;

/**
 * The Bluetooth selfie remote: its presses (useVolumeRemote), and nothing else. Its link dropping and coming back
 * (asleep, or out of range and back) never saves a clip (2026-11-03, see linkMonitor); while listening, the link is
 * followed for the diagnostic log only, for a BLE remote the app has learnt (devices/bluetoothRemote).
 */
export function useBluetoothRemote(enabled: boolean, onPress: () => void, options: VolumeRemoteOptions = {}): void {
  const onPressRef = useRef(onPress);
  useEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);
  const monitor = useRef<LinkMonitor | undefined>(undefined);

  const { onHold, parkAt } = options;
  const holdRef = useRef(onHold);
  useEffect(() => {
    holdRef.current = onHold;
  }, [onHold]);
  const hasHold = onHold !== undefined;
  const hold = useCallback(() => {
    if (monitor.current !== undefined) monitor.current.press();
    const fn = holdRef.current;
    if (fn !== undefined) fn();
  }, []);
  useVolumeRemote(
    enabled,
    () => {
      if (monitor.current !== undefined) monitor.current.press();
      onPressRef.current();
    },
    { onHold: hasHold ? hold : undefined, parkAt },
  );

  // TEMP(diag-remote): the link's drops and comebacks, with how long after a press and how long away (range vs sleep).
  useEffect(() => {
    if (!enabled) return;
    const links = createLinkMonitor({ now: () => Date.now(), onLink: (e) => diag(describeLinkEvent(e)) });
    monitor.current = links;
    let active = true;
    let busy = false;
    const look = async () => {
      const knownId = repo.getPrefs().remoteBleId;
      if (knownId === undefined || busy) return;
      busy = true;
      try {
        const link = linkOf(await bluetoothConnected(false), knownId);
        if (active) links.link(link === 'connected' ? true : link === 'missing' ? false : undefined);
      } catch {
        if (active) links.link(undefined);
      } finally {
        busy = false;
      }
    };
    void look();
    const timer = setInterval(() => void look(), LINK_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
      monitor.current = undefined;
    };
  }, [enabled]);
}
