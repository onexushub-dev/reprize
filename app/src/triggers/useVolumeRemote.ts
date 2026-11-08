import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { VolumeManager } from 'react-native-volume-manager';

import { addReplayListener, diagCaptureState, outputVolume, setCaptureButtons } from '../../modules/replay-camera';
import type { ReplayCameraModuleEvents } from '../../modules/replay-camera';
import { diag } from '../diag/diagLog'; // TEMP(diag-remote): every diag() call in this file
import { createPressReader, REMOTE_HOLD_MS } from './pressHold';

/** Where the volume is parked: room above and below, so any remote press changes it. */
const PARK = 0.5;
/** A level this close to the top or bottom leaves too little room for presses: the volume is parked at PARK instead. */
const EDGE = 0.2;
const TOLERANCE = 0.01;
/** Volume events this soon after our own setVolume are its echo (Android reports a rounded step). */
const ECHO_MS = 300;
/**
 * After the hook starts, or the app comes back to the front, volume changes are the system's, not a press: the screen
 * that stops listening puts the phone's volume back, and iOS moves it when the camera's audio restarts. They are
 * ignored, and once this time has passed the volume is parked again.
 */
export const ARM_MS = 1500;
/** iOS applies a volume change a moment later: the real level is checked after this. */
export const SETTLE_MS = 400;
/** While listening, how often the real volume is compared with the parked level (one cheap native read). */
export const WATCH_MS = 3000;
/** A parking that did not take is tried this many times in all. */
const PARK_TRIES = 3;
/**
 * How far the volume is moved first on a retry, so the library's slider sees a new value. Down, never up: a remote
 * presses "volume up", so the nudge can never look like one.
 */
const NUDGE = 0.05;
/**
 * iOS reports a nudge late, past ECHO_MS (2026-11-05 log: "CLIQUE (volume 0.55)" right after "tentando de novo", when
 * the nudge still went up): a volume event at the nudged level this soon after it is the nudge, not a press.
 */
const NUDGE_ECHO_MS = 2000;
/**
 * A press moves the volume one step (1/16 on iOS buttons, 0.05 seen from remotes, 1/15 on Android); two at most if
 * the remote repeats. A bigger move is the system's: a new audio route reporting its own volume (the earpiece at 1.00
 * when the camera restarted, 2026-10-31 log, which saved a clip nobody asked for).
 */
export const MAX_PRESS_STEP = 0.13;

export type VolumeRemoteOptions = {
  /**
   * The button held `REMOTE_HOLD_MS` (capture events only: the volume path cannot tell a hold): start or end a
   * recording (2026-11-07 spec §5.1). Without it a hold is just a press.
   */
  onHold?: () => void;
  /**
   * Where the volume path parks the volume, at least (the player's own level when higher and still with room for a
   * press): during a recording the chimes must reach the court (2026-11-07 spec §5.3). The player's level comes back
   * when the hook stops.
   */
  parkAt?: number;
};

/** Screens listening to the remote right now: capture buttons stay on while any of them is. */
let captureButtonUsers = 0;

/** Turns the capture-event path on for one more listener; returns whether the phone has it (iOS 17.2+). */
function captureButtonsOn(): boolean {
  captureButtonUsers += 1;
  if (typeof setCaptureButtons !== 'function') return false;
  try {
    return setCaptureButtons(true); // every time: it also moves to the window that is key now
  } catch {
    return false;
  }
}

function captureButtonsOff(): void {
  captureButtonUsers = Math.max(0, captureButtonUsers - 1);
  if (captureButtonUsers > 0 || typeof setCaptureButtons !== 'function') return;
  try {
    setCaptureButtons(false);
  } catch {
    // the buttons go back to the volume when the camera stops anyway
  }
}

/** A native event subscription, or a no-op where the module has none (Android builds, tests). */
function listen<E extends 'onCaptureButton' | 'onAudioChange'>(
  event: E,
  fn: ReplayCameraModuleEvents[E]
): { remove: () => void } {
  if (typeof addReplayListener !== 'function') return { remove: () => {} };
  try {
    return addReplayListener(event, fn);
  } catch {
    return { remove: () => {} };
  }
}

/** The phone's real volume (iOS), or undefined where only the library's own reading exists (Android, tests). */
function realVolume(): number | undefined {
  if (typeof outputVolume !== 'function') return undefined;
  try {
    return outputVolume();
  } catch {
    return undefined;
  }
}

/** TEMP(diag-remote): one line with what the capture-event path has installed right now (native, async). */
function logCaptureState(when: string): void {
  if (typeof diagCaptureState !== 'function') return;
  diagCaptureState()
    .then((state) => {
      if (state !== undefined) diag(`controle: captura ${when}: ${state}`);
    })
    .catch(() => {});
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bluetooth selfie remotes press "volume up". While enabled, each volume change counts as one press;
 * the volume is parked back at a fixed level (and the system HUD hidden) so the next press registers too.
 * The phone's own volume is restored when the hook stops.
 *
 * 2026-10-28 field log: on iOS the library sets the volume through a hidden slider that goes stale, so some parkings
 * did not take; the volume crept up a step per press until it sat at the top, where a press changes nothing and the
 * remote "stopped working" until a new recording reset the volume. So on iOS every parking is checked against the
 * real volume and retried, and a watch every few seconds puts a volume that drifted back in place.
 *
 * Second field log (same day): changes ignored while arming or away used to become the parked level, so the parked
 * level itself could end up at the top (presses made with Control Center open, or the previous screen putting back a
 * full volume) and the watch then kept the volume there. The parked level is now chosen once, when the hook starts,
 * and never taken from what the volume did meanwhile.
 *
 * 2026-10-31 field logs: (1) a camera restart (thermal step) reported the earpiece's volume, 1.00, and it counted as a
 * press: a move bigger than a step is never a press now, and an audio route change or camera restart rearms. (2) For
 * minutes no volume change arrived at all while the remote was pressed, until the app had been away for a while. So on
 * iOS 17.2+ presses are also taken as capture events (`setCaptureButtons`), which do not go through the volume; a press
 * taken that way leaves the volume alone, so the two paths never count the same press.
 *
 * 2026-11-05 field logs: the capture events now arrive (on the camera preview, see CaptureButtons), so on iOS 17.2+ the
 * volume path is only the fallback (no preview on screen, the camera restarting). Its retry nudge goes down and its
 * late echo is ignored: it used to count as a press.
 */
export function useVolumeRemote(enabled: boolean, onPress: () => void, options: VolumeRemoteOptions = {}): void {
  const onPressRef = useRef(onPress);
  useEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);
  const onHoldRef = useRef(options.onHold);
  useEffect(() => {
    onHoldRef.current = options.onHold;
  }, [options.onHold]);
  const parkAt = options.parkAt;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let original: number | undefined;
    let parked = PARK;
    let lastOwnSet = -Infinity;
    /** The last nudge set while retrying a parking, to know its late echo. */
    let lastNudge: { volume: number; at: number } | undefined;
    let armedAt = Date.now() + ARM_MS;
    let parking: Promise<void> = Promise.resolve();
    const startVolume = realVolume();
    const native = startVolume !== undefined;
    /** The last level any volume event reported: a press is one step away from it. */
    let last = startVolume !== undefined ? startVolume : PARK;

    const setOwn = async (volume: number) => {
      lastOwnSet = Date.now();
      await VolumeManager.setVolume(volume, { showUI: false, playSound: false });
    };

    // Park, then adopt the level the OS actually set (volume comes in steps on Android). On iOS, check it took.
    const park = async () => {
      const target = parked;
      for (let attempt = 0; attempt < PARK_TRIES && active; attempt += 1) {
        if (attempt > 0) {
          const nudged = target - NUDGE > 0.1 ? target - NUDGE : target + NUDGE;
          lastNudge = { volume: nudged, at: Date.now() };
          await setOwn(nudged);
        }
        await setOwn(target);
        if (!native) {
          const { volume } = await VolumeManager.getVolume();
          parked = volume;
          last = volume;
          return;
        }
        await wait(SETTLE_MS);
        const real = realVolume();
        // A parking does not always report itself (the slider already held that value, or the route put the volume
        // back silently): the next press is measured from where the volume really is.
        if (real !== undefined) last = real;
        if (real === undefined || Math.abs(real - target) < TOLERANCE) return;
        if (!active) return;
        diag(`controle: volume ficou em ${real.toFixed(2)} (esperado ${target.toFixed(2)}), tentando de novo`);
      }
      if (active) diag('controle: FALHOU ao devolver o volume');
    };
    // One parking at a time: a press during a retry waits for it instead of racing it.
    const queuePark = () => {
      parking = parking.then(park).catch(() => diag('controle: FALHOU ao devolver o volume'));
    };

    const away = () => AppState.currentState === 'background' || AppState.currentState === 'inactive';

    // Wait out the system's own volume changes, then put the volume back where presses have room.
    let rearmTimer: ReturnType<typeof setTimeout> | undefined;
    const rearm = () => {
      armedAt = Date.now() + ARM_MS;
      if (rearmTimer !== undefined) clearTimeout(rearmTimer);
      rearmTimer = setTimeout(() => {
        rearmTimer = undefined;
        if (active && !away()) queuePark();
      }, ARM_MS);
    };

    const listener = VolumeManager.addVolumeListener(({ volume }) => {
      if (!active) return;
      const level = volume.toFixed(2);
      const jump = Math.abs(volume - last) > MAX_PRESS_STEP;
      last = volume;
      const isAway = away();
      if (Date.now() < armedAt || isAway) {
        // Not a press, and not where the volume belongs either: it is parked again once armed (rearm).
        diag(`controle: volume ${level} ignorado (${isAway ? 'app fora da tela' : 'armando'})`);
        return;
      }
      const echo = Date.now() - lastOwnSet < ECHO_MS || Math.abs(volume - parked) < TOLERANCE;
      if (echo) return;
      const nudgeEcho =
        lastNudge !== undefined &&
        Math.abs(volume - lastNudge.volume) < TOLERANCE &&
        Date.now() - lastNudge.at < NUDGE_ECHO_MS;
      if (nudgeEcho) return;
      if (jump) {
        diag(`controle: volume ${level} ignorado (salto do sistema)`);
        rearm();
        return;
      }
      diag(`controle: CLIQUE (volume ${level})`);
      logCaptureState('no clique pelo volume');
      onPressRef.current();
      queuePark();
    });

    // A press taken as a capture event never moves the volume: nothing to park. It arrives as `began` and `ended`, so
    // a hold can start or end a recording; without a hold handler (or from an older build) every press is a press.
    const buttons = captureButtonsOn();
    let lastButton = 'secondary';
    const reader = createPressReader({
      onPress: (ms) => {
        diag(`controle: CLIQUE (captura, ${lastButton}${ms === undefined ? '' : `, ${ms} ms`})`);
        onPressRef.current();
      },
      onHold: () => {
        const hold = onHoldRef.current;
        if (hold === undefined) {
          diag(`controle: CLIQUE (captura, ${lastButton}, segurado ${REMOTE_HOLD_MS / 1000} s, sem acao de segurar)`);
          onPressRef.current();
          return;
        }
        diag(`controle: SEGURADO ${REMOTE_HOLD_MS / 1000} s (captura, ${lastButton})`);
        hold();
      },
    });
    const buttonListener = listen('onCaptureButton', ({ button, phase, ms }) => {
      if (!active || away()) return;
      lastButton = button;
      if (phase === 'began') reader.began();
      else if (phase === 'ended') reader.ended(ms);
      else {
        diag(`controle: CLIQUE (captura, ${button})`);
        onPressRef.current();
      }
    });
    // The camera restarting or a new audio route moves the volume by itself: not a press.
    const audioListener = listen('onAudioChange', ({ reason }) => {
      if (!active) return;
      diag(`controle: aguardando o sistema (${reason})`);
      rearm();
    });

    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') rearm();
    });

    // A volume that drifted from the parked level (a parking that never took) leaves less room, or none, for presses.
    const watch = native
      ? setInterval(() => {
          if (!active || away() || Date.now() < armedAt || Date.now() - lastOwnSet < WATCH_MS) return;
          const real = realVolume();
          if (real === undefined) return;
          last = real;
          if (Math.abs(real - parked) < TOLERANCE) return;
          diag(`controle: volume fora do lugar (${real.toFixed(2)}, esperado ${parked.toFixed(2)}), devolvendo`);
          queuePark();
        }, WATCH_MS)
      : undefined;

    // Stops listening and gives the phone its volume (and the system HUD) back.
    const stop = () => {
      diag('controle: parou de escutar');
      active = false;
      reader.dispose();
      if (watch !== undefined) clearInterval(watch);
      if (rearmTimer !== undefined) clearTimeout(rearmTimer);
      listener.remove();
      buttonListener.remove();
      audioListener.remove();
      captureButtonsOff();
      appState.remove();
      VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => {});
      if (original !== undefined) setOwn(original).catch(() => {});
    };

    diag(`controle: escutando ${buttons ? '(volume + captura)' : '(volume)'}`);
    VolumeManager.showNativeVolumeUI({ enabled: false }).catch(() => {});
    (startVolume !== undefined ? Promise.resolve({ volume: startVolume }) : VolumeManager.getVolume())
      .then(({ volume }) => {
        original = volume;
        last = volume;
        // Near the top or bottom a press can't move the volume far, so park in the middle; a recording parks at
        // `parkAt` at least, so its chimes reach the court.
        if (parkAt !== undefined) parked = volume > parkAt && volume <= 1 - EDGE ? volume : parkAt;
        else parked = volume > 1 - EDGE || volume < EDGE ? PARK : volume;
        if (active) {
          queuePark();
          rearm(); // and again after the previous screen has put its volume back
        }
      })
      .catch(() => {});

    return stop;
  }, [enabled, parkAt]);
}
