import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Whether the app is the one on screen (not minimised, not behind the app switcher or another app). */
export function isActiveState(state: AppStateStatus | string | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

/**
 * Whether the app is on screen. Waits that dim the screen (the setup's pause, the recording's economy) only run while
 * it is: JS timers keep running for a while after the app is minimised, and a pause reached there dimmed the phone's
 * screen outside the app (Victor, 2026-11-10).
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => isActiveState(AppState.currentState));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setActive(isActiveState(next)));
    return () => sub.remove();
  }, []);
  return active;
}
