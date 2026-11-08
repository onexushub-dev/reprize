import { useEffect } from 'react';
import { VolumeManager } from 'react-native-volume-manager';

/**
 * The system volume during a recording, at least: the save chime must reach the court (2026-11-07: at 0.40 in a noisy
 * gym nobody heard it, so players pressed again to be sure). The remote's volume path parks here too (`parkAt`), with
 * one press step of room left below the top.
 */
export const RECORDING_VOLUME = 0.75;

/**
 * While `active` (a recording the remote is not listening to: the remote's own hook does it otherwise), raises the
 * volume to `RECORDING_VOLUME` when it is lower, and gives the player's level back when it ends.
 */
export function useRecordingVolume(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let live = true;
    let original: number | undefined;
    try {
      VolumeManager.getVolume()
        .then(({ volume }) => {
          if (!live || volume >= RECORDING_VOLUME) return;
          original = volume;
          return VolumeManager.setVolume(RECORDING_VOLUME, { showUI: false, playSound: false });
        })
        .catch(() => {});
    } catch {
      // no volume control here (tests, a build without the module): the chimes play at the player's level
    }
    return () => {
      live = false;
      if (original === undefined) return;
      try {
        VolumeManager.setVolume(original, { showUI: false, playSound: false }).catch(() => {});
      } catch {
        // see above
      }
    };
  }, [active]);
}
