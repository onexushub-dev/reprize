import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { repo } from '../data/mmkv';
import { useT } from '../i18n/useT';
import { openPaywall } from '../payments/feedback';
import { CourtesySheet, type CourtesyChoice } from './CourtesySheet';

/** Longest wait for the sheet to finish closing on iOS before the paywall opens anyway. */
const DISMISS_FALLBACK_MS = 800;

/**
 * The courtesy gate before a received recording leaves the app without Pro, as a promise: `ask(sessionId)` resolves
 * true when the export goes on (a courtesy already spent on it, or spent now); render `sheet` once in the screen.
 * "Assinar o PRO" resolves false and opens the paywall once the sheet has closed (iOS drops a native screen presented
 * while a Modal is still sliding away); after buying, Save or Send again goes through as Pro.
 */
export function useCourtesyGate(): { ask: (sessionId: string) => Promise<boolean>; sheet: ReactNode } {
  const { t } = useT();
  const [shareId, setShareId] = useState<string | null>(null);
  const [clips, setClips] = useState(0);
  // A fresh sheet for every ask: it starts by reading how many courtesies are left.
  const [asked, setAsked] = useState(0);
  const request = useRef<{ sessionId: string; resolve: (go: boolean) => void } | null>(null);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ask = useCallback(
    (sessionId: string) =>
      new Promise<boolean>((resolve) => {
        const session = repo.getSession(sessionId);
        if (session === undefined || session.received === undefined || session.received.courtesy === true) {
          resolve(true);
          return;
        }
        request.current = { sessionId, resolve };
        setAsked((n) => n + 1);
        setClips(session.received.total);
        setShareId(session.received.shareId);
      }),
    [],
  );

  const paywall = useCallback(() => {
    if (waiting.current === null) return;
    clearTimeout(waiting.current);
    waiting.current = null;
    void openPaywall(t, 'received_export');
  }, [t]);

  const choose = useCallback(
    (choice: CourtesyChoice) => {
      const r = request.current;
      request.current = null;
      setShareId(null);
      if (r === null) return;
      if (choice === 'go') repo.setReceivedCourtesy(r.sessionId);
      r.resolve(choice === 'go');
      if (choice === 'pro') waiting.current = setTimeout(paywall, Platform.OS === 'ios' ? DISMISS_FALLBACK_MS : 0);
    },
    [paywall],
  );

  useEffect(
    () => () => {
      if (waiting.current !== null) clearTimeout(waiting.current);
    },
    [],
  );

  return {
    ask,
    sheet: <CourtesySheet key={asked} visible={shareId !== null} shareId={shareId} clips={clips} onChoose={choose} onDismissed={paywall} />,
  };
}
