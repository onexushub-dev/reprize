import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { repo } from '../data/mmkv';
import { forgetRemote, forgetRemoteLink, knownRemotes, learnRemoteAtPress } from './bluetoothRemote';
import {
  clearRemotePress,
  hasRemotePress,
  isRemoteSheetOpen,
  markRemotePress,
  remotePressExpiresIn,
  subscribeRemotePress,
} from './remoteTest';

const usedBefore = () => repo.getPrefs().remoteTestedAt !== undefined;

/** The Bluetooth remote's proof of life: a press this launch, and whether it was ever heard before. */
export function useRemoteTest() {
  const [pressed, setPressed] = useState(hasRemotePress);
  const [testedBefore, setTestedBefore] = useState(usedBefore);

  useEffect(() => {
    const sync = () => {
      setPressed(hasRemotePress());
      setTestedBefore(usedBefore());
    };
    sync(); // a press may have been heard between the first render and now
    const off = subscribeRemotePress(sync);
    // A press stops counting after a while (the remote may have been switched off): look again then.
    const left = remotePressExpiresIn();
    const timer = left === undefined ? undefined : setTimeout(sync, left + 50);
    return () => {
      off();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pressed]);

  /** A press of the remote was heard. */
  const press = useCallback(() => {
    if (!usedBefore()) repo.setPrefs({ remoteTestedAt: Date.now() });
    // Which Bluetooth device it is, so its link can be followed without a press; first, so the sheet knows it is coming.
    void learnRemoteAtPress();
    markRemotePress();
  }, []);

  /** Drops what the app remembers (the iOS pairing itself is removed by the player in Ajustes > Bluetooth). */
  const forget = useCallback(() => {
    repo.setPrefs({ remoteTestedAt: undefined });
    forgetRemoteLink();
    clearRemotePress();
  }, []);

  /** One remote of the list; the last one forgotten takes the sheet back to its first-time steps. */
  const forgetOne = useCallback(
    (id: string) => {
      forgetRemote(id);
      if (knownRemotes().length === 0) forget();
    },
    [forget],
  );

  return { pressed, testedBefore, press, forget, forgetOne };
}

/** Whether the Dispositivos sheet is open over the setup screen. */
export function useRemoteSheetOpen(): boolean {
  return useSyncExternalStore(subscribeRemotePress, isRemoteSheetOpen);
}
