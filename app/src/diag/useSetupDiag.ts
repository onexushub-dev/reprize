// TEMP(diag): what the setup screen costs, for the Diagnóstico screen (2026-11-08 spec §3, §6).
import { useEffect, useRef } from 'react';

import { diagPower } from '../../modules/replay-camera';
import { DIAGNOSTICS_ENABLED, diag } from './diagLog';

/** One line a minute while the setup screen is the visible one. */
export const SETUP_PULSE_MS = 60_000;

/** The setup screen's camera paused for inactivity (2026-11-08 spec §3.2). */
export function diagSetupPaused(): void {
  diag('preparo: câmera pausada por inatividade (35 s sem toque; a câmera segue ligada para o controle)');
}

/** And back: by a touch, a remote press, or the pause simply ending (a recording, another screen, a sheet). */
export function diagSetupResumed(cause: 'toque' | 'controle' | 'fim'): void {
  diag(
    cause === 'fim'
      ? 'preparo: pausa encerrada (gravação, outra tela ou folha aberta)'
      : `preparo: câmera ligada de novo (${cause})`,
  );
}

function power(): string {
  try {
    return diagPower();
  } catch {
    return '';
  }
}

/**
 * While `onSetup` (the setup screen visible, nothing recording): a pulse a minute with battery, heat and whether the
 * camera is on or paused, to compare the setup screen's cost before and after a change.
 */
export function useSetupDiag(onSetup: boolean, paused: boolean): void {
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!onSetup || !DIAGNOSTICS_ENABLED) return;
    diag(`preparo: na tela — ${power()}`);
    let minute = 0;
    const pulse = setInterval(() => {
      minute += 1;
      diag(`preparo: pulso ${minute} min — câmera ${pausedRef.current ? 'pausada' : 'ligada'} — ${power()}`);
    }, SETUP_PULSE_MS);
    return () => clearInterval(pulse);
  }, [onSetup]);
}
