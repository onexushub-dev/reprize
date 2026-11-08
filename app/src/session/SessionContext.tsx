import * as Haptics from 'expo-haptics';
import { createContext, type ReactNode, useContext, useEffect } from 'react';

import * as camera from '../../modules/replay-camera';
import { removeFile, repo } from '../data/mmkv';
import { currentLocale } from '../i18n';
import { payments } from '../payments';
import { triggerAllowed } from '../payments/limits';
import { usePlan } from '../share/entitlement';
import { focusQueue } from '../focus/appFocusQueue';
import { focusHold } from '../focus/focusQueue';
// TEMP(diag-remote)
import { diag, diagFlags } from '../diag/diagLog';
import { useSessionDiag } from '../diag/useSessionDiag';
import { useBluetoothRemote } from '../triggers/useBluetoothRemote';
import { emitRemoteEnd } from '../triggers/remoteCommands';
import { RECORDING_VOLUME, useRecordingVolume } from './useRecordingVolume';
import { type ReplaySession, type SessionDeps, useReplaySession } from './useReplaySession';
import { useWatchTriggerGate } from './useWatchTriggerGate';

/**
 * The Bluetooth remote in a game: a press saves a clip, a 3 s hold ends the recording (the recording screen does it),
 * and the volume is parked loud so the chimes reach the court. Its link coming back never saves a clip (linkMonitor).
 */
function useGameRemote(enabled: boolean, onPress: () => void): void {
  useBluetoothRemote(enabled, onPress, { onHold: emitRemoteEnd, parkAt: RECORDING_VOLUME });
}

const appDeps: SessionDeps = {
  camera,
  repo,
  deleteFile: removeFile,
  haptic: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  now: Date.now,
  locale: currentLocale,
  startDecision: payments.startDecision,
  useRemote: useGameRemote,
  onClipSaved: (clipId) => {
    const clip = repo.getClip(clipId);
    diag(`clipe salvo (${clip ? clip.source : '?'})`); // TEMP(diag-remote)
    focusQueue.enqueue(clipId);
  },
  diagGestureOff: () => diagFlags().gestureOff, // TEMP(diag)
};

const SessionContext = createContext<ReplaySession | null>(null);

/** One game at a time, shared by setup, recording and end-of-game screens. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useReplaySession(appDeps);
  // TEMP(diag-remote): what each recording goes through, for the Diagnóstico screen.
  useSessionDiag(session);
  // The watch trigger is paid: the recording's own plan decides (the next start's outside one), held for the whole of a
  // recording that has started.
  const recording = session.state.phase === 'recording';
  const plan = usePlan(recording ? session.state.sessionId : undefined);
  // The chimes loud enough for the court: the remote's hook parks the volume there while it listens; otherwise here.
  const remoteListens = recording && triggerAllowed('remote', session.state.paid ? 'paid' : 'free');
  useRecordingVolume(recording && !remoteListens);
  useWatchTriggerGate(recording, triggerAllowed('watch', plan), camera.watchSetSaveAllowed);

  // The camera and the heat come first: no Modo Foco analysis while the camera is on, on the setup screen or recording
  // (a running one is stopped and redone afterwards).
  const hold = focusHold(recording || session.state.camera !== 'off');
  useEffect(() => focusQueue.setHold(hold), [hold]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): ReplaySession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
