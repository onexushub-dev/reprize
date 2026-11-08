import { act, renderHook } from '@testing-library/react-native';

import { sessionSummary, track } from '../../analytics';
import { createRepo, type KV } from '../../data/repo';
import type { StartDecision } from '../../payments/types';
import { SETTLE_MS, type SessionDeps, useReplaySession } from '../useReplaySession';

jest.mock('../../analytics', () => ({ track: jest.fn(), sessionSummary: { note: jest.fn() } }));

type Listener = (e: any) => void;

function fakeDeps() {
  const startDecision = jest.fn(async (): Promise<StartDecision> => ({ kind: 'free' }));
  const useRemote = jest.fn((_enabled: boolean, _onPress: () => void) => {});
  const listeners = new Map<string, Listener>();
  const map = new Map<string, string>();
  const kv: KV = { getString: (k) => map.get(k), set: (k, v) => void map.set(k, v), delete: (k) => void map.delete(k) };
  let n = 0;
  let t = 1000;
  const deleted: string[] = [];
  let pendingSave: ((v: { clipPath: string; durationMs: number; shortSide?: number }) => void) | undefined;
  const camera = {
    startSession: jest.fn(async () => {}),
    stopSession: jest.fn(async () => {}),
    saveClip: jest.fn(
      () => new Promise<{ clipPath: string; durationMs: number; shortSide?: number }>((resolve) => (pendingSave = resolve))
    ),
    setGestureEnabled: jest.fn(),
    // Two fixed lenses (Android) unless a test says otherwise.
    getZoomRange: jest.fn((): { min: number; max: number; continuous: boolean } => ({ min: 0.5, max: 1, continuous: false })),
    setZoom: jest.fn(),
    signalSaved: jest.fn(),
    setVoiceEnabled: jest.fn(),
    getSpeechPermission: jest.fn((): 'granted' | 'denied' | 'undetermined' => 'granted'),
    watchSync: jest.fn(),
    watchSignal: jest.fn(),
    remoteSync: jest.fn(),
    remoteSignal: jest.fn(),
    signalSaveFailed: jest.fn(),
    addReplayListener: jest.fn((event: string, fn: Listener) => {
      listeners.set(event, fn);
      return { remove: () => listeners.delete(event) };
    }),
  };
  const deps: SessionDeps = {
    camera,
    repo: createRepo(kv, { exists: () => true, sizeBytes: () => 1 }, () => `id-${++n}`),
    deleteFile: (p) => void deleted.push(p),
    haptic: jest.fn(),
    now: () => t,
    locale: () => 'pt-BR',
    startDecision,
    useRemote,
    onClipSaved: jest.fn(),
  };
  return {
    deps,
    startDecision,
    useRemote,
    camera,
    deleted,
    // Every game written, with clips or not (listSessions only lists games with clips).
    sessionIds: (): string[] => JSON.parse(map.get('reprize:v1:sessions') ?? '[]'),
    emit: (event: string, e: any = {}) => listeners.get(event)?.(e),
    advance: (ms: number) => void (t += ms),
    finishSave: (v: { clipPath: string; durationMs: number; shortSide?: number } = { clipPath: '/c.mp4', durationMs: 60000 }) => pendingSave?.(v),
  };
}

async function started() {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('futevolei'));
  return { ...f, view };
}

test('trigger saves a clip and records it in the repo', async () => {
  const { view, camera, deps, finishSave } = await started();

  await act(async () => view.result.current.trigger('screen'));
  expect(camera.saveClip).toHaveBeenCalledWith({ source: 'screen', at: 1000, keepMs: 5000 }); // the 3 s minimum cut + 2 s
  await act(async () => finishSave());

  const sessionId = view.result.current.state.sessionId!;
  expect(deps.repo.listClips(sessionId)).toMatchObject([{ source: 'screen', path: '/c.mp4', durationMs: 60000 }]);
  expect(view.result.current.state).toMatchObject({ clipCount: 1, lastSaved: { number: 1, source: 'screen' } });
});

test('ignores trigger while saving', async () => {
  const { view, camera, advance } = await started();

  await act(async () => view.result.current.trigger('screen'));
  advance(3500); // past the bus debounce, but the first save hasn't finished
  await act(async () => view.result.current.trigger('remote'));

  expect(camera.saveClip).toHaveBeenCalledTimes(1);
});

test('native onTrigger goes through the bus', async () => {
  const { view, camera, emit, finishSave, advance } = await started();
  advance(SETTLE_MS);

  await act(async () => emit('onTrigger', { source: 'gesture', at: 1 }));
  await act(async () => finishSave());

  expect(camera.saveClip).toHaveBeenCalledWith({ source: 'gesture', at: 1000 + SETTLE_MS, keepMs: 5000 });
  expect(view.result.current.state.lastSaved?.source).toBe('gesture');
});

test('the Diagnóstico gesture switch keeps the gesture off in a recording that would use it', async () => {
  const f = fakeDeps();
  f.deps.diagGestureOff = () => true;
  f.startDecision.mockResolvedValue({ kind: 'pro' });
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('musculacao'));
  expect(f.camera.setGestureEnabled).toHaveBeenLastCalledWith(false);
});

test('undoLast deletes the clip file and the record', async () => {
  const { view, deps, deleted, finishSave } = await started();
  await act(async () => view.result.current.trigger('screen'));
  await act(async () => finishSave());

  await act(async () => view.result.current.undoLast());

  expect(deleted).toEqual(['/c.mp4']);
  expect(deps.repo.listClips(view.result.current.state.sessionId!)).toEqual([]);
  expect(view.result.current.state.clipCount).toBe(0);
});

test('stop ends the repo session and returns its id', async () => {
  const { view, deps, advance } = await started();
  advance(60_000);

  let id: string | undefined;
  await act(async () => {
    id = await view.result.current.stop();
  });

  expect(id).toBe(view.result.current.state.sessionId);
  expect(deps.repo.getSession(id!)?.endedAt).toBe(61_000);
  expect(view.result.current.state.phase).toBe('ended');
});

test('start failure returns to idle with the error code', async () => {
  const f = fakeDeps();
  f.camera.startSession.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'LOW_STORAGE' }));
  const view = await renderHook(() => useReplaySession(f.deps));

  await act(() => view.result.current.start('beachTennis'));

  expect(view.result.current.state).toMatchObject({ phase: 'idle', error: 'LOW_STORAGE' });
});

test('native error ends the session in the repo and keeps the clip count', async () => {
  const { view, deps, emit } = await started();

  await act(async () => emit('onError', { code: 'ENCODER_FAILED', message: 'thermal' }));

  const id = view.result.current.state.sessionId!;
  expect(view.result.current.state).toMatchObject({ phase: 'ended', thermalStop: true });
  expect(deps.repo.getSession(id)?.endedAt).toBeDefined();
});

test('prepare turns the camera on so starting the game is immediate', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));

  await act(() => view.result.current.prepare('beachTennis', 'free'));
  expect(f.camera.startSession).toHaveBeenCalledTimes(1);
  expect(view.result.current.state.camera).toBe('on');

  await act(() => view.result.current.start('outro'));
  expect(f.camera.startSession).toHaveBeenCalledTimes(1);
  expect(view.result.current.state.phase).toBe('recording');
});

test('a saved sport opens the same camera as the free mode: wide framing, 1080p60, the fixed 60s buffer', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.prepare('musculacao', 'paid'));
  expect(f.camera.startSession).toHaveBeenLastCalledWith({ lens: 'wide', zoom: 1, maxQuality: '1080p60', bufferSeconds: 60, audio: true });
});

test('every sport id runs with the same settings, so switching between them does not reopen the camera', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.prepare('beachTennis', 'paid'));
  await act(() => view.result.current.prepare('musculacao', 'paid'));
  f.startDecision.mockResolvedValue({ kind: 'pro' });

  expect(f.camera.stopSession).not.toHaveBeenCalled();
  expect(f.camera.startSession).toHaveBeenCalledTimes(1);

  await act(() => view.result.current.start('musculacao'));
  expect(f.camera.setGestureEnabled).toHaveBeenLastCalledWith(true);
  expect(f.camera.setVoiceEnabled).toHaveBeenLastCalledWith(false, 'pt-BR');
});

test('with two fixed lenses (Android), a zoom that crosses 1x reopens the camera with the other lens', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.prepare('quadra', 'paid'));
  expect(f.camera.startSession).toHaveBeenLastCalledWith({ lens: 'wide', zoom: 1, maxQuality: '1080p60', bufferSeconds: 60, audio: true });
  f.deps.repo.setPrefs({ modeSettings: { quadra: { zoom: 0.5 } } });
  await act(() => view.result.current.prepare('quadra', 'paid'));
  expect(f.camera.startSession).toHaveBeenLastCalledWith({ lens: 'ultraWide', zoom: 0.5, maxQuality: '1080p60', bufferSeconds: 60, audio: true });
  expect(f.camera.startSession).toHaveBeenCalledTimes(2);
});

test('a lens saved before zoom existed still opens the same lens', async () => {
  const f = fakeDeps();
  f.deps.repo.setPrefs({ modeSettings: { quadra: { lens: 'wide' } } });
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.prepare('quadra', 'paid'));
  expect(f.camera.startSession).toHaveBeenLastCalledWith({ lens: 'wide', zoom: 1, maxQuality: '1080p60', bufferSeconds: 60, audio: true });
});

describe('continuous zoom (iOS)', () => {
  const continuous = { min: 0.5, max: 5, continuous: true };

  test('opens with the saved zoom as the starting zoom', async () => {
    const f = fakeDeps();
    f.camera.getZoomRange.mockReturnValue(continuous);
    f.deps.repo.setPrefs({ modeSettings: { quadra: { zoom: 2 } } });
    const view = await renderHook(() => useReplaySession(f.deps));
    await act(() => view.result.current.prepare('quadra', 'paid'));
    expect(f.camera.startSession).toHaveBeenLastCalledWith({ lens: 'wide', zoom: 2, maxQuality: '1080p60', bufferSeconds: 60, audio: true });
  });

  test('a zoom saved above the range is clamped when the camera opens', async () => {
    const f = fakeDeps();
    f.camera.getZoomRange.mockReturnValue({ min: 1, max: 5, continuous: true });
    f.deps.repo.setPrefs({ modeSettings: { quadra: { zoom: 0.5 } } });
    const view = await renderHook(() => useReplaySession(f.deps));
    await act(() => view.result.current.prepare('quadra', 'paid'));
    expect(f.camera.startSession).toHaveBeenLastCalledWith({ lens: 'wide', zoom: 1, maxQuality: '1080p60', bufferSeconds: 60, audio: true });
  });

  test('changing the zoom never reopens the camera', async () => {
    const f = fakeDeps();
    f.camera.getZoomRange.mockReturnValue(continuous);
    const view = await renderHook(() => useReplaySession(f.deps));
    await act(() => view.result.current.prepare('quadra', 'paid'));
    f.deps.repo.setPrefs({ modeSettings: { quadra: { zoom: 2 } } });
    await act(() => view.result.current.prepare('quadra', 'paid'));
    expect(f.camera.startSession).toHaveBeenCalledTimes(1);
    expect(f.camera.stopSession).not.toHaveBeenCalled();
  });

  test('a zoom saved meanwhile is applied to the running camera, once', async () => {
    const f = fakeDeps();
    f.camera.getZoomRange.mockReturnValue(continuous);
    const view = await renderHook(() => useReplaySession(f.deps));
    await act(() => view.result.current.prepare('quadra', 'paid'));
    f.deps.repo.setPrefs({ modeSettings: { quadra: { zoom: 2 } } });
    await act(() => view.result.current.prepare('quadra', 'paid'));
    await act(() => view.result.current.prepare('quadra', 'paid'));
    expect(f.camera.setZoom).toHaveBeenCalledTimes(1);
    expect(f.camera.setZoom).toHaveBeenCalledWith(2, false);
  });

  test('a zoom set through the session is not applied a second time by the next prepare', async () => {
    const f = fakeDeps();
    f.camera.getZoomRange.mockReturnValue(continuous);
    const view = await renderHook(() => useReplaySession(f.deps));
    await act(() => view.result.current.prepare('quadra', 'paid'));
    await act(async () => view.result.current.setZoom(2, true));
    expect(f.camera.setZoom).toHaveBeenCalledWith(2, true);
    f.deps.repo.setPrefs({ modeSettings: { quadra: { zoom: 2 } } });
    await act(() => view.result.current.prepare('quadra', 'paid'));
    expect(f.camera.setZoom).toHaveBeenCalledTimes(1);
  });
});

test('a camera that fails to open reports its code before any game starts', async () => {
  const f = fakeDeps();
  f.camera.startSession.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'CAMERA_PERMISSION' }));
  const view = await renderHook(() => useReplaySession(f.deps));

  await act(() => view.result.current.prepare('beachTennis', 'free'));

  expect(view.result.current.state).toMatchObject({ camera: 'off', error: 'CAMERA_PERMISSION', phase: 'idle' });
});

test('stop turns the camera off', async () => {
  const { view, camera } = await started();
  await act(async () => {
    await view.result.current.stop();
  });
  expect(camera.stopSession).toHaveBeenCalled();
  expect(view.result.current.state.camera).toBe('off');
});

test('signals the save the moment the trigger is accepted, before the file is ready', async () => {
  const { view, camera, advance } = await started();
  advance(SETTLE_MS);

  await act(async () => view.result.current.trigger('gesture'));

  expect(camera.signalSaved).toHaveBeenCalledWith({ sound: true, flash: true });
  expect(camera.saveClip).toHaveBeenCalled(); // still pending
});

test('respects the sound and flash preferences', async () => {
  const { view, camera, deps } = await started();
  deps.repo.setPrefs({ soundOnSave: false, flashOnSave: true });

  await act(async () => view.result.current.trigger('screen'));

  expect(camera.signalSaved).toHaveBeenCalledWith({ sound: false, flash: true });
});

test('a failed save plays the failure signal', async () => {
  const { view, camera } = await started();
  camera.saveClip.mockRejectedValueOnce(new Error('x'));

  await act(async () => view.result.current.trigger('screen'));

  expect(camera.signalSaveFailed).toHaveBeenCalledWith({ sound: true });
});

test('starting a game applies the voice preference', async () => {
  const f = fakeDeps();
  f.deps.repo.setPrefs({ voiceEnabled: true });
  const view = await renderHook(() => useReplaySession(f.deps));

  await act(() => view.result.current.start('beachTennis'));

  expect(f.camera.setVoiceEnabled).toHaveBeenLastCalledWith(true, 'pt-BR');
});

test('after a native error the camera is reopened for the next game', async () => {
  const { view, camera, emit } = await started();
  await act(async () => emit('onError', { code: 'ENCODER_FAILED', message: 'thermal' }));
  await act(async () => view.result.current.reset());

  await act(() => view.result.current.prepare('beachTennis', 'free'));

  expect(camera.startSession).toHaveBeenCalledTimes(2);
});

test('the gesture only runs during the game, not while positioning', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));

  await act(() => view.result.current.prepare('beachTennis', 'free'));
  expect(f.camera.setGestureEnabled).toHaveBeenLastCalledWith(false);

  await act(() => view.result.current.start('beachTennis'));
  expect(f.camera.setGestureEnabled).toHaveBeenLastCalledWith(true);
});

test('release turns the camera off while idle, but never during a game', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.prepare('beachTennis', 'free'));
  await act(() => view.result.current.release());
  expect(f.camera.stopSession).toHaveBeenCalledTimes(1);
  expect(view.result.current.state.camera).toBe('off');

  await act(() => view.result.current.start('beachTennis'));
  await act(() => view.result.current.release());
  expect(f.camera.stopSession).toHaveBeenCalledTimes(1);
});

/** Moves the clock, triggers a save and finishes it with a file `durationMs` long. */
async function saveAfter(f: ReturnType<typeof fakeDeps>, view: Awaited<ReturnType<typeof started>>['view'], afterMs: number, durationMs: number) {
  f.advance(afterMs);
  await act(async () => view.result.current.trigger('screen'));
  await act(async () => f.finishSave({ clipPath: `/c${f.deps.now()}.mp4`, durationMs }));
}

const trims = (f: ReturnType<typeof fakeDeps>, view: Awaited<ReturnType<typeof started>>['view']) =>
  f.deps.repo.listClips(view.result.current.state.sessionId!).map((c) => c.trim);

test('each clip is cut to the chosen length, but never back past the previous clip (30s, saves at 0:30, 0:45, 1:00, 2:47)', async () => {
  const f = fakeDeps();
  f.deps.repo.setPrefs({ modeSettings: { quadra: { cutSeconds: 30 } } }); // a Pro player who picked 30s
  f.startDecision.mockResolvedValue({ kind: 'pro' });
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));

  await saveAfter(f, view, 30_000, 30_000); // 0:30 → 30s
  await saveAfter(f, view, 15_000, 45_000); // 0:45 → 15s
  await saveAfter(f, view, 15_000, 60_000); // 1:00 → 15s
  await saveAfter(f, view, 107_000, 60_000); // 2:47 → 30s

  expect(trims(f, view)).toEqual([
    { startMs: 0, endMs: 30_000 },
    { startMs: 30_000, endMs: 45_000 },
    { startMs: 45_000, endMs: 60_000 },
    { startMs: 30_000, endMs: 60_000 },
  ]);
});

test('a save keeps only its cut and a 2 s margin of the buffer, and the cuts stay the same (30s: 0:30, 0:45, 1:30)', async () => {
  const f = fakeDeps();
  f.deps.repo.setPrefs({ modeSettings: { quadra: { cutSeconds: 30 } } }); // a Pro player who picked 30s
  f.startDecision.mockResolvedValue({ kind: 'pro' });
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));

  // The native side copies about `keepMs` (whole segments), or the whole buffer when it holds less.
  await saveAfter(f, view, 30_000, 30_000); // 0:30 → 30s cut; only 30s recorded so far
  await saveAfter(f, view, 15_000, 17_000); // 0:45 → 15s cut, 17s file
  await saveAfter(f, view, 45_000, 32_000); // 1:30 → 30s cut, 32s file

  expect(f.camera.saveClip.mock.calls.map((c: unknown[]) => (c[0] as { keepMs: number }).keepMs)).toEqual([
    32_000, 17_000, 32_000,
  ]);
  expect(trims(f, view)).toEqual([
    { startMs: 0, endMs: 30_000 },
    { startMs: 2_000, endMs: 17_000 },
    { startMs: 2_000, endMs: 32_000 },
  ]);
  const clips = f.deps.repo.listClips(view.result.current.state.sessionId!);
  expect(clips.map((c) => c.trim.endMs - c.trim.startMs)).toEqual([30_000, 15_000, 30_000]);
  // The editor never reaches the margin: the bounds are the cut.
  expect(clips.map((c) => c.bounds)).toEqual(clips.map((c) => c.trim));
});

test('the clip keeps the resolution the camera saved it in (4K), and none is stored when the camera does not say', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));
  f.advance(30_000);
  await act(async () => view.result.current.trigger('screen'));
  await act(async () => f.finishSave({ clipPath: '/4k.mp4', durationMs: 32_000, shortSide: 2160 }));
  f.advance(30_000);
  await act(async () => view.result.current.trigger('screen'));
  await act(async () => f.finishSave({ clipPath: '/old.mp4', durationMs: 32_000 }));
  const clips = f.deps.repo.listClips(view.result.current.state.sessionId!);
  expect(clips.map((c) => c.shortSide)).toEqual([2160, undefined]);
});

test('the saved state carries the length the clip really got, for the popup', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));

  await saveAfter(f, view, 30_000, 30_000);
  await saveAfter(f, view, 7_000, 37_000); // 7s after the last clip

  expect(view.result.current.state.lastSaved).toMatchObject({ number: 2, cutMs: 7_000 });
});

test('the clip length the player picked is the longest cut', async () => {
  const f = fakeDeps();
  f.deps.repo.setPrefs({ modeSettings: { quadra: { cutSeconds: 15 } } });
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));

  await saveAfter(f, view, 40_000, 40_000); // 40s into the recording, but only 15s asked for
  await saveAfter(f, view, 8_000, 48_000); // 8s later: only the 8s since the last clip

  expect(trims(f, view)).toEqual([
    { startMs: 25_000, endMs: 40_000 },
    { startMs: 40_000, endMs: 48_000 },
  ]);
});

test('a save right after another still cuts at least the debounce window, never an empty clip', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));

  await saveAfter(f, view, 500, 60_000); // half a second into the recording

  expect(trims(f, view)).toEqual([{ startMs: 57_000, endMs: 60_000 }]);
});

test('undoing a clip gives its span back to the next save', async () => {
  const f = fakeDeps();
  f.deps.repo.setPrefs({ modeSettings: { quadra: { cutSeconds: 30 } } }); // a Pro player who picked 30s
  f.startDecision.mockResolvedValue({ kind: 'pro' });
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));

  await saveAfter(f, view, 30_000, 30_000); // 0:30
  await saveAfter(f, view, 15_000, 45_000); // 0:45
  await act(async () => view.result.current.undoLast());
  await saveAfter(f, view, 5_000, 50_000); // 0:50 → back to the 0:30 clip: 20s

  expect(trims(f, view)).toEqual([
    { startMs: 0, endMs: 30_000 },
    { startMs: 30_000, endMs: 50_000 },
  ]);
});

test('a new recording starts counting from its own start', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));
  await saveAfter(f, view, 45_000, 45_000);
  await act(() => view.result.current.stop());

  f.advance(100_000);
  await act(() => view.result.current.start('quadra'));
  await saveAfter(f, view, 10_000, 60_000); // 10s after the new start, not 110s after the last clip

  expect(trims(f, view)).toEqual([{ startMs: 50_000, endMs: 60_000 }]);
});

test('voice stays off natively when the phone may not listen', async () => {
  const f = fakeDeps();
  f.camera.getSpeechPermission.mockReturnValue('denied');
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('musculacao'));
  expect(f.camera.setVoiceEnabled).toHaveBeenLastCalledWith(false, 'pt-BR');
});

test('starting a recording tells the watch', async () => {
  const { camera } = await started();
  expect(camera.watchSync).toHaveBeenLastCalledWith({ recording: true, clipCount: 0, startedAt: 1000 });
});

test('a saved clip syncs the new count and signals success', async () => {
  const { view, camera, finishSave } = await started();
  await act(async () => view.result.current.trigger('watch'));
  await act(async () => finishSave());
  expect(camera.watchSync).toHaveBeenLastCalledWith({ recording: true, clipCount: 1, startedAt: 1000 });
  expect(camera.watchSignal).toHaveBeenCalledTimes(1);
  expect(camera.watchSignal).toHaveBeenCalledWith(true);
});

test('a failed save signals failure and leaves the count', async () => {
  const { view, camera } = await started();
  camera.saveClip.mockRejectedValueOnce(new Error('x'));
  await act(async () => view.result.current.trigger('watch'));
  expect(camera.watchSignal).toHaveBeenCalledWith(false);
  expect(camera.watchSync).toHaveBeenLastCalledWith({ recording: true, clipCount: 0, startedAt: 1000 });
});

test('a second watch tap inside the debounce gives one save and one haptic', async () => {
  const { view, camera, emit, advance, finishSave } = await started();
  await act(async () => emit('onTrigger', { source: 'watch', at: 1 }));
  await act(async () => finishSave());
  advance(500);
  await act(async () => emit('onTrigger', { source: 'watch', at: 2 }));
  expect(camera.saveClip).toHaveBeenCalledTimes(1);
  expect(camera.watchSignal).toHaveBeenCalledTimes(1);
  expect(view.result.current.state.clipCount).toBe(1);
});

test('undo syncs the lower count without a signal', async () => {
  const { view, camera, finishSave } = await started();
  await act(async () => view.result.current.trigger('watch'));
  await act(async () => finishSave());
  camera.watchSignal.mockClear();
  await act(async () => view.result.current.undoLast());
  expect(camera.watchSync).toHaveBeenLastCalledWith({ recording: true, clipCount: 0, startedAt: 1000 });
  expect(camera.watchSignal).not.toHaveBeenCalled();
});

test('stopping sends an idle state', async () => {
  const { view, camera, finishSave } = await started();
  await act(async () => view.result.current.trigger('watch'));
  await act(async () => finishSave());
  await act(async () => {
    await view.result.current.stop();
  });
  expect(camera.watchSync).toHaveBeenLastCalledWith({ recording: false, clipCount: 0 });
});

test('a native stop (thermal) also sends an idle state', async () => {
  const { camera, emit } = await started();
  await act(async () => emit('onError', { code: 'ENCODER_FAILED', message: 'thermal' }));
  expect(camera.watchSync).toHaveBeenLastCalledWith({ recording: false, clipCount: 0 });
});

test('a watch tap outside a recording is ignored', async () => {
  const f = fakeDeps();
  await renderHook(() => useReplaySession(f.deps));
  await act(async () => f.emit('onTrigger', { source: 'watch', at: 1 }));
  expect(f.camera.saveClip).not.toHaveBeenCalled();
  expect(f.camera.watchSignal).not.toHaveBeenCalled();
});

test('a watch tap outside a recording does not use up the 3 s debounce of the first real tap', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(async () => f.emit('onTrigger', { source: 'watch', at: 1 })); // stale watch screen, nothing recording
  await act(() => view.result.current.start('quadra'));
  await act(async () => view.result.current.trigger('screen')); // same instant
  expect(f.camera.saveClip).toHaveBeenCalledTimes(1);
});

test('a tap on the remote phone saves a clip with the phone as source', async () => {
  const { view, camera, emit, finishSave } = await started();
  await act(async () => emit('onTrigger', { source: 'phone', at: 1 }));
  await act(async () => finishSave());
  expect(camera.saveClip).toHaveBeenCalledWith({ source: 'phone', at: 1000, keepMs: 5000 });
  expect(view.result.current.state.lastSaved?.source).toBe('phone');
});

test('two phone taps inside the debounce give one save', async () => {
  const { camera, emit, advance, finishSave } = await started();
  await act(async () => emit('onTrigger', { source: 'phone', at: 1 }));
  await act(async () => finishSave());
  advance(500);
  await act(async () => emit('onTrigger', { source: 'phone', at: 2 }));
  expect(camera.saveClip).toHaveBeenCalledTimes(1);
  expect(camera.remoteSignal).toHaveBeenCalledTimes(1);
});

test('a phone tap outside a recording is ignored and does not use up the debounce', async () => {
  const f = fakeDeps();
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(async () => f.emit('onTrigger', { source: 'phone', at: 1 }));
  expect(f.camera.saveClip).not.toHaveBeenCalled();
  expect(f.camera.remoteSignal).not.toHaveBeenCalled();
  await act(() => view.result.current.start('quadra'));
  await act(async () => view.result.current.trigger('screen'));
  expect(f.camera.saveClip).toHaveBeenCalledTimes(1);
});

test('the remote phone gets the same state as the watch', async () => {
  const { view, camera, finishSave } = await started();
  expect(camera.remoteSync).toHaveBeenLastCalledWith({ recording: true, clipCount: 0, startedAt: 1000 });
  await act(async () => view.result.current.trigger('screen'));
  await act(async () => finishSave());
  expect(camera.remoteSync).toHaveBeenLastCalledWith({ recording: true, clipCount: 1, startedAt: 1000 });
  await act(async () => {
    await view.result.current.stop();
  });
  expect(camera.remoteSync).toHaveBeenLastCalledWith({ recording: false, clipCount: 0 });
});

test('the remote phone is told how a save ended', async () => {
  const ok = await started();
  await act(async () => ok.view.result.current.trigger('screen'));
  await act(async () => ok.finishSave());
  expect(ok.camera.remoteSignal).toHaveBeenCalledWith(true);

  const bad = await started();
  bad.camera.saveClip.mockRejectedValueOnce(new Error('x'));
  await act(async () => bad.view.result.current.trigger('screen'));
  expect(bad.camera.remoteSignal).toHaveBeenCalledWith(false);
});

test('the voice command listens in the app language', async () => {
  const f = fakeDeps();
  f.deps.locale = () => 'en';
  f.deps.repo.setPrefs({ modeSettings: { quadra: { voiceEnabled: true } } });
  const view = await renderHook(() => useReplaySession(f.deps));
  await act(() => view.result.current.start('quadra'));
  expect(f.camera.setVoiceEnabled).toHaveBeenLastCalledWith(true, 'en-US');
});

async function saveClips(f: ReturnType<typeof fakeDeps>, view: any, n: number) {
  for (let i = 0; i < n; i++) {
    f.advance(5000);
    await act(async () => view.result.current.trigger('screen'));
    await act(async () => f.finishSave());
  }
}

describe('no locked clips while recording', () => {
  test('a free session: the eleventh and twelfth clips are saved without locked', async () => {
    const f = fakeDeps();
    const view = await renderHook(() => useReplaySession(f.deps));
    await act(() => view.result.current.start('futevolei'));
    const id = view.result.current.state.sessionId!;
    await saveClips(f, view, 12);
    expect(f.deps.repo.listClips(id)).toHaveLength(12);
    expect(f.deps.repo.listClips(id).every((c) => !('locked' in c))).toBe(true);
    expect(view.result.current.state.phase).toBe('recording');
  });

  test('state.lastSaved has neither locked nor lastFree', async () => {
    const f = fakeDeps();
    const view = await renderHook(() => useReplaySession(f.deps));
    await act(() => view.result.current.start('futevolei'));
    await saveClips(f, view, 10);
    expect(view.result.current.state.lastSaved).toBeDefined();
    expect(view.result.current.state.lastSaved).not.toHaveProperty('locked');
    expect(view.result.current.state.lastSaved).not.toHaveProperty('lastFree');
  });
});

describe('start decision', () => {
  type F = ReturnType<typeof fakeDeps>;
  const setup = async () => {
    const f = fakeDeps();
    const view = await renderHook(() => useReplaySession(f.deps));
    return { ...f, view };
  };
  const startResult = async (f: { view: any }, sport: 'quadra' | 'futevolei' = 'quadra') => {
    let r: unknown;
    await act(async () => void (r = await f.view.result.current.start(sport)));
    return r;
  };
  /** Free recordings stored: there is no counter any more, a free start is just an unpaid session. */
  const freeCount = (f: F) => f.sessionIds().filter((id: string) => f.deps.repo.getSession(id)?.paid === false).length;
  const lowStorage = () => Object.assign(new Error('x'), { code: 'LOW_STORAGE' });

  test('free: the chosen quality with sound, 15 s clips, an unpaid session and one free recording counted', async () => {
    const f = await setup();
    expect(await startResult(f)).toBe('started');
    expect(f.camera.startSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxQuality: '1080p60', bufferSeconds: 15, audio: true }),
    );
    const id = f.view.result.current.state.sessionId!;
    await saveClips(f, f.view, 12);
    const clips = f.deps.repo.listClips(id);
    expect(clips).toHaveLength(12);
    expect(clips.every((c) => (c.trim ? c.trim.endMs - c.trim.startMs : c.durationMs) <= 15_000)).toBe(true);
    expect(f.deps.repo.getSession(id)).toMatchObject({ paid: false });
    expect(freeCount(f)).toBe(1);
    expect(f.view.result.current.state).toMatchObject({ paid: false, bufferSeconds: 15 });
  });

  test('Pro: Full HD with sound, a paid session, no credit and no count', async () => {
    const f = await setup();
    f.startDecision.mockResolvedValue({ kind: 'pro' });
    expect(await startResult(f)).toBe('started');
    expect(f.camera.startSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxQuality: '1080p60', bufferSeconds: 60, audio: true }),
    );
    expect(f.deps.repo.getSession(f.view.result.current.state.sessionId!)).toMatchObject({ paid: true });
    expect(f.deps.repo.spentPasses().size).toBe(0);
    expect(freeCount(f)).toBe(0);
    expect(f.view.result.current.state).toMatchObject({ paid: true, bufferSeconds: 60 });
  });

  test('a camera failure records nothing and spends nothing', async () => {
    const f = await setup();
    f.camera.startSession.mockRejectedValueOnce(lowStorage());
    expect(await startResult(f)).toBe('failed');
    expect(f.view.result.current.state).toMatchObject({ phase: 'idle', error: 'LOW_STORAGE' });
    expect(f.sessionIds()).toEqual([]);
    expect(freeCount(f)).toBe(0);
    expect(f.deps.repo.spentPasses().size).toBe(0);
  });

  test('a plan that changed since the preview reopens the camera before the session exists', async () => {
    const f = await setup();
    await act(() => f.view.result.current.prepare('quadra', 'free'));
    expect(f.camera.startSession).toHaveBeenLastCalledWith(expect.objectContaining({ maxQuality: '1080p60', audio: true }));
    f.startDecision.mockResolvedValue({ kind: 'pro' });
    const order: string[] = [];
    f.camera.stopSession.mockImplementation(async () => void order.push('stop'));
    f.camera.startSession.mockImplementation(async () => void order.push('open'));
    const write = f.deps.repo.startSession;
    f.deps.repo.startSession = (...a) => (order.push('session'), write(...a));
    expect(await startResult(f)).toBe('started');
    expect(f.camera.startSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxQuality: '1080p60', bufferSeconds: 60, audio: true }),
    );
    expect(order).toEqual(['stop', 'open', 'session']);
  });

  test('Pro lapsing between the two decisions reopens with the 15 s ceiling and counts a free recording', async () => {
    const f = await setup();
    f.startDecision.mockResolvedValueOnce({ kind: 'pro' }).mockResolvedValueOnce({ kind: 'free' });
    expect(await startResult(f)).toBe('started');
    expect(f.camera.startSession).toHaveBeenCalledTimes(2);
    expect(f.camera.startSession).toHaveBeenNthCalledWith(1, expect.objectContaining({ maxQuality: '1080p60', audio: true }));
    expect(f.camera.startSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxQuality: '1080p60', bufferSeconds: 15, audio: true }),
    );
    expect(f.deps.repo.getSession(f.view.result.current.state.sessionId!)).toMatchObject({ paid: false });
    expect(freeCount(f)).toBe(1);
  });

  test('a double tap starts one session', async () => {
    const f = await setup();
    let rs: unknown[] = [];
    await act(async () => {
      rs = await Promise.all([f.view.result.current.start('quadra'), f.view.result.current.start('quadra')]);
    });
    expect([...rs].sort()).toEqual(['busy', 'started']);
    expect(f.sessionIds()).toHaveLength(1);
    expect(freeCount(f)).toBe(1);
    expect(f.deps.repo.spentPasses().size).toBe(0);
  });

  test('prepare never touches the camera while recording, starting or stopping', async () => {
    const f = await setup();
    f.startDecision.mockResolvedValue({ kind: 'pro' });
    await startResult(f);
    f.camera.startSession.mockClear();
    let ok: unknown;
    await act(async () => void (ok = await f.view.result.current.prepare('quadra', 'free')));
    expect(ok).toBe(true);
    expect(f.camera.startSession).not.toHaveBeenCalled();
    expect(f.camera.stopSession).not.toHaveBeenCalled();
    f.camera.stopSession.mockImplementationOnce(() => new Promise<void>(() => {}));
    await act(async () => void f.view.result.current.stop());
    await act(async () => void (ok = await f.view.result.current.prepare('quadra', 'free')));
    expect(ok).toBe(true);
    expect(f.camera.startSession).not.toHaveBeenCalled();
  });

  test('prepare while start is opening the camera does not reopen it', async () => {
    const f = await setup();
    let open!: () => void;
    f.camera.startSession.mockImplementationOnce(() => new Promise<void>((r) => (open = r)));
    let pending!: Promise<unknown>;
    await act(async () => void (pending = f.view.result.current.start('quadra')));
    expect(f.view.result.current.state.phase).toBe('starting');
    let ok: unknown;
    await act(async () => void (ok = await f.view.result.current.prepare('quadra', 'paid')));
    expect(ok).toBe(true);
    await act(async () => {
      open();
      await pending;
    });
    expect(f.camera.startSession).toHaveBeenCalledTimes(1);
    expect(f.view.result.current.state.phase).toBe('recording');
  });

  test('the Bluetooth remote is free: on in a free game and in a paid one', async () => {
    const free = await setup();
    await startResult(free);
    expect(free.useRemote).toHaveBeenLastCalledWith(true, expect.any(Function));
    const paid = await setup();
    paid.startDecision.mockResolvedValue({ kind: 'pro' });
    await startResult(paid);
    expect(paid.useRemote).toHaveBeenLastCalledWith(true, expect.any(Function));
  });

  test('a paid trigger that fires in a free game still saves the play', async () => {
    const f = await setup();
    await startResult(f);
    await act(async () => f.emit('onTrigger', { source: 'watch', at: 1 }));
    await act(async () => f.finishSave());
    expect(f.deps.repo.listClips(f.view.result.current.state.sessionId!)).toHaveLength(1);
  });

  test('a first decision that cannot be read starts free', async () => {
    const f = await setup();
    f.startDecision.mockRejectedValueOnce(new Error('x'));
    expect(await startResult(f)).toBe('started');
    expect(f.deps.repo.getSession(f.view.result.current.state.sessionId!)).toMatchObject({ paid: false });
    expect(freeCount(f)).toBe(1);
  });

  test('a second decision that cannot be read starts free', async () => {
    const f = await setup();
    f.startDecision.mockResolvedValueOnce({ kind: 'pro' }).mockRejectedValueOnce(new Error('x'));
    expect(await startResult(f)).toBe('started');
    expect(f.deps.repo.getSession(f.view.result.current.state.sessionId!)).toMatchObject({ paid: false });
    expect(f.camera.startSession).toHaveBeenLastCalledWith(expect.objectContaining({ maxQuality: '1080p60', audio: true }));
  });

  test.each([
    ['setVoiceEnabled', (f: F) => f.camera.setVoiceEnabled.mockImplementationOnce(() => { throw new Error('x'); })],
    ['setGestureEnabled', (f: F) => f.camera.setGestureEnabled.mockImplementation((on: boolean) => { if (on) throw new Error('x'); })],
    ['getSpeechPermission', (f: F) => {
      f.deps.repo.setPrefs({ voiceEnabled: true });
      f.camera.getSpeechPermission.mockImplementationOnce(() => { throw new Error('x'); });
    }],
    ['repo.startSession', (f: F) => jest.spyOn(f.deps.repo, 'startSession').mockImplementationOnce(() => { throw new Error('x'); })],
  ])('a throw from %s fails the start, counts nothing, spends nothing, and a later start works', async (name, arm) => {
    {
      const f = await setup();
      arm(f);
      expect(await startResult(f)).toBe('failed');
      expect(f.view.result.current.state).toMatchObject({ phase: 'idle', error: expect.any(String) });
      expect(f.sessionIds()).toEqual([]);
      expect(freeCount(f)).toBe(0);
      expect(f.deps.repo.spentPasses().size).toBe(0);
      if (name === 'repo.startSession') {
        expect(f.camera.setGestureEnabled).toHaveBeenLastCalledWith(false);
        expect(f.camera.setVoiceEnabled).toHaveBeenLastCalledWith(false, 'pt-BR');
      }
      if (name === 'setGestureEnabled') f.camera.setGestureEnabled.mockImplementation(() => {});
      expect(await startResult(f)).toBe('started');
    }
  });

  test('a throw from reading the prefs while the camera is chosen fails the start before anything is written', async () => {
    const f = await setup();
    await act(() => f.view.result.current.prepare('quadra', 'free'));
    jest.spyOn(f.deps.repo, 'getPrefs').mockImplementationOnce(() => { throw new Error('x'); });
    expect(await startResult(f)).toBe('failed');
    expect(f.sessionIds()).toEqual([]);
    expect(freeCount(f)).toBe(0);
    expect(await startResult(f)).toBe('started');
  });

  test('prefs changed while the camera opens do not reach the game: it runs with what the camera was opened with', async () => {
    const f = await setup();
    f.startDecision.mockResolvedValueOnce({ kind: 'free' }).mockImplementationOnce(async () => {
      f.deps.repo.setPrefs({ modeSettings: { quadra: { cutSeconds: 5, gestureEnabled: false, voiceEnabled: true } } });
      return { kind: 'free' };
    });
    expect(await startResult(f)).toBe('started');
    expect(f.camera.startSession).toHaveBeenCalledTimes(1);
    expect(f.camera.startSession).toHaveBeenLastCalledWith(expect.objectContaining({ bufferSeconds: 15 }));
    expect(f.view.result.current.state.bufferSeconds).toBe(15);
    expect(f.camera.setGestureEnabled).toHaveBeenLastCalledWith(true);
    expect(f.camera.setVoiceEnabled).toHaveBeenLastCalledWith(false, 'pt-BR');
    f.advance(20_000); // a cut never reaches back before the recording started
    await saveClips(f, f.view, 1);
    const [clip] = f.deps.repo.listClips(f.view.result.current.state.sessionId!);
    expect(clip.trim).toEqual({ startMs: 45000, endMs: 60000 });
  });

  test('Pro arriving between the two decisions reopens with the paid settings and records a paid session', async () => {
    const f = await setup();
    f.startDecision.mockResolvedValueOnce({ kind: 'free' }).mockResolvedValueOnce({ kind: 'pro' });
    expect(await startResult(f)).toBe('started');
    expect(f.camera.startSession).toHaveBeenNthCalledWith(1, expect.objectContaining({ bufferSeconds: 15 }));
    expect(f.camera.startSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxQuality: '1080p60', bufferSeconds: 60, audio: true }),
    );
    expect(f.deps.repo.getSession(f.view.result.current.state.sessionId!)).toMatchObject({ paid: true });
    expect(f.deps.repo.spentPasses().size).toBe(0);
    expect(freeCount(f)).toBe(0);
  });

  test.each([
    ['gesture', 'voice'],
    ['voice', 'gesture'],
  ])('a failed start switches %s off even when switching %s off throws', async (stays, throws) => {
    const f = await setup();
    f.deps.repo.setPrefs({ voiceEnabled: true });
    jest.spyOn(f.deps.repo, 'startSession').mockImplementationOnce(() => {
      const thrower = throws === 'gesture' ? f.camera.setGestureEnabled : f.camera.setVoiceEnabled;
      thrower.mockImplementation((on: boolean) => {
        if (!on) throw new Error('y');
      });
      throw new Error('x');
    });
    expect(await startResult(f)).toBe('failed');
    if (stays === 'gesture') expect(f.camera.setGestureEnabled).toHaveBeenLastCalledWith(false);
    else expect(f.camera.setVoiceEnabled).toHaveBeenLastCalledWith(false, 'pt-BR');
  });

  test('a prepare right after the start was asked for, before React commits, does not touch the camera', async () => {
    const f = await setup();
    let open!: () => void;
    f.camera.startSession.mockImplementationOnce(() => new Promise<void>((r) => (open = r)));
    let r: unknown;
    let ok: unknown;
    await act(async () => {
      const pending = f.view.result.current.start('quadra');
      while (f.camera.startSession.mock.calls.length === 0) await Promise.resolve();
      ok = await Promise.race([f.view.result.current.prepare('quadra', 'paid'), Promise.resolve('pending')]);
      open();
      r = await pending;
    });
    expect(ok).toBe(true);
    expect(r).toBe('started');
    expect(f.camera.startSession).toHaveBeenCalledTimes(1);
  });

  test('start is busy while recording and while stopping', async () => {
    const f = await setup();
    await startResult(f);
    expect(await startResult(f)).toBe('busy');
    f.camera.stopSession.mockImplementationOnce(() => new Promise<void>(() => {}));
    await act(async () => void f.view.result.current.stop());
    expect(await startResult(f)).toBe('busy');
    expect(freeCount(f)).toBe(1);
  });

  test('Pro lapsing mid-game never interrupts it', async () => {
    const f = await setup();
    f.startDecision.mockResolvedValue({ kind: 'pro' });
    await startResult(f);
    f.startDecision.mockResolvedValue({ kind: 'free' });
    await saveClips(f, f.view, 3);
    expect(f.deps.repo.listClips(f.view.result.current.state.sessionId!)).toHaveLength(3);
    expect(f.view.result.current.state).toMatchObject({ phase: 'recording', paid: true });
    expect(f.camera.stopSession).not.toHaveBeenCalled();
  });
});

test('right after the recording starts, a gesture, voice or volume press saves nothing; a tap does', async () => {
  const { view, camera, emit, advance } = await started();
  await act(async () => emit('onTrigger', { source: 'gesture', at: 1 }));
  await act(async () => view.result.current.trigger('remote'));
  expect(camera.saveClip).not.toHaveBeenCalled();
  advance(100);
  await act(async () => view.result.current.trigger('screen'));
  expect(camera.saveClip).toHaveBeenCalledWith({ source: 'screen', at: 1100, keepMs: 5000 });
});

test('a saved clip is handed over for the Modo Foco analysis', async () => {
  const { view, deps, finishSave } = await started();
  await act(async () => view.result.current.trigger('screen'));
  await act(async () => finishSave());
  const [clip] = deps.repo.listClips(view.result.current.state.sessionId!);
  expect(deps.onClipSaved).toHaveBeenCalledWith(clip.id);
});

describe('analytics', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a saved clip reports its trigger and mode, and counts in the session summary', async () => {
    const { view, finishSave } = await started();
    await act(async () => view.result.current.trigger('watch'));
    await act(async () => finishSave());
    expect(track).toHaveBeenCalledWith('clip_saved', { trigger: 'watch', mode: 'futevolei' });
    expect(sessionSummary.note).toHaveBeenCalledWith('clip_saved', 'watch');
  });

  test('a save that fails reports trigger_failed and no clip_saved', async () => {
    const { view, camera } = await started();
    camera.saveClip.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => view.result.current.trigger('screen'));
    expect(track).toHaveBeenCalledWith('trigger_failed', { trigger: 'screen', reason: 'save_failed' });
    expect(track).not.toHaveBeenCalledWith('clip_saved', expect.anything());
    expect(sessionSummary.note).not.toHaveBeenCalled();
  });

  test('a trigger the bus drops (debounced) reports nothing', async () => {
    const { view, camera, finishSave, advance } = await started();
    await act(async () => view.result.current.trigger('screen'));
    await act(async () => finishSave());
    (track as jest.Mock).mockClear();
    advance(500); // inside the 3 s debounce
    await act(async () => view.result.current.trigger('remote'));
    expect(camera.saveClip).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });

  test('a started game reports what it records with', async () => {
    await started();
    expect(track).toHaveBeenCalledWith(
      'recording_started',
      expect.objectContaining({ mode: 'futevolei', plan: 'free', gesture: expect.any(Boolean), voice: expect.any(Boolean) }),
    );
    const [, props] = (track as jest.Mock).mock.calls.find(([name]) => name === 'recording_started');
    expect(typeof props.quality).toBe('string');
    expect(typeof props.clip_seconds).toBe('number');
  });

  test('a game the player ends reports its length and clips as ranges', async () => {
    const { view, finishSave, advance } = await started();
    await act(async () => view.result.current.trigger('screen'));
    await act(async () => finishSave());
    advance(20 * 60_000);
    await act(async () => void (await view.result.current.stop()));
    expect(track).toHaveBeenCalledWith('recording_ended', { reason: 'user', duration: '15-30m', clips: '1' });
  });

  test('a game the heat or the camera ends says so', async () => {
    const hot = await started();
    await act(async () => hot.emit('onError', { code: 'ENCODER_FAILED', message: 'thermal' }));
    expect(track).toHaveBeenCalledWith('recording_ended', { reason: 'thermal', duration: '<5m', clips: '0' });

    const broken = await started();
    await act(async () => broken.emit('onError', { code: 'ENCODER_FAILED', message: 'boom' }));
    expect(track).toHaveBeenCalledWith('recording_ended', { reason: 'error', duration: '<5m', clips: '0' });
  });

  test('the first quality drop of a recording is reported once', async () => {
    const { emit } = await started();
    await act(async () => emit('onThermalChange', { level: 'serious', degraded: true }));
    await act(async () => emit('onThermalChange', { level: 'critical', degraded: true }));
    const drops = (track as jest.Mock).mock.calls.filter(([name]) => name === 'recording_quality_lowered');
    expect(drops).toEqual([['recording_quality_lowered', { level: 'serious' }]]);
  });
});
