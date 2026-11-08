import { initialState, reducer, type SessionState } from '../reducer';

const recording = (over: Partial<SessionState> = {}): SessionState => ({
  ...reducer(reducer(initialState, { type: 'startRequested' }), { type: 'started', sessionId: 's1', startedAt: 100, paid: false, bufferSeconds: 15 }),
  ...over,
});

test('start happy path: idle → starting → recording', () => {
  const starting = reducer(initialState, { type: 'startRequested' });
  expect(starting.phase).toBe('starting');
  const rec = reducer(starting, { type: 'started', sessionId: 's1', startedAt: 100, paid: false, bufferSeconds: 15 });
  expect(rec).toMatchObject({ phase: 'recording', sessionId: 's1', startedAt: 100, clipCount: 0 });
});

test('started keeps the plan and the buffer the game runs with; stop and reset clear them', () => {
  const rec = reducer(reducer(initialState, { type: 'startRequested' }), {
    type: 'started',
    sessionId: 's1',
    startedAt: 100,
    paid: true,
    bufferSeconds: 60,
  });
  expect(rec).toMatchObject({ paid: true, bufferSeconds: 60 });
  const ended = reducer(reducer(rec, { type: 'stopRequested' }), { type: 'stopped' });
  expect(ended.paid).toBeUndefined();
  expect(ended.bufferSeconds).toBeUndefined();
  expect(reducer(rec, { type: 'reset' }).paid).toBeUndefined();
});

test('start failure returns to idle with the error code', () => {
  const s = reducer(reducer(initialState, { type: 'startRequested' }), { type: 'startFailed', code: 'LOW_STORAGE' });
  expect(s).toMatchObject({ phase: 'idle', error: 'LOW_STORAGE' });
});

test('saved increments the count and sets lastSaved', () => {
  const s = reducer(reducer(recording(), { type: 'saveStarted', source: 'screen', at: 1, cutMs: 3000 }), {
    type: 'saved',
    sessionId: 's1',
    clipId: 'c1',
    source: 'gesture',
    at: 5,
    cutMs: 7000,
  });
  expect(s).toMatchObject({ saving: false, clipCount: 1, lastSaved: { clipId: 'c1', number: 1, source: 'gesture', at: 5, cutMs: 7000 } });
});

test('a save under way shows at once as the next clip, and leaves when it ends either way', () => {
  const started = reducer(recording({ clipCount: 2 }), { type: 'saveStarted', source: 'remote', at: 9, cutMs: 15000 });
  expect(started.pendingSave).toEqual({ number: 3, source: 'remote', at: 9, cutMs: 15000 });
  const saved = reducer(started, { type: 'saved', sessionId: 's1', clipId: 'c3', source: 'remote', at: 9, cutMs: 15000 });
  expect(saved.pendingSave).toBeUndefined();
  const failed = reducer(started, { type: 'saveFailed', sessionId: 's1' });
  expect(failed.pendingSave).toBeUndefined();
  expect(failed.clipCount).toBe(2);
});

test('undone decrements the count and clears lastSaved', () => {
  const saved = reducer(recording({ clipCount: 2 }), { type: 'saved', sessionId: 's1', clipId: 'c3', source: 'screen', at: 1, cutMs: 30000 });
  const s = reducer(saved, { type: 'undone', clipId: 'c3' });
  expect(s.clipCount).toBe(2);
  expect(s.lastSaved).toBeUndefined();
});

test('interruption sets and clears paused', () => {
  const paused = reducer(recording(), { type: 'interrupted' });
  expect(paused.paused).toBe(true);
  expect(reducer(paused, { type: 'resumed' }).paused).toBe(false);
});

test('native error ends the session keeping clips', () => {
  const s = reducer(recording({ clipCount: 4 }), { type: 'nativeError', code: 'ENCODER_FAILED', thermal: true });
  expect(s).toMatchObject({ phase: 'ended', error: 'ENCODER_FAILED', thermalStop: true, clipCount: 4, sessionId: 's1' });
});

test('thermal stores the quality in use when the native side sends it', () => {
  const s = reducer(recording(), { type: 'thermal', level: 'serious', degraded: true, quality: '1080p30' });
  expect(s.thermal).toEqual({ level: 'serious', degraded: true, quality: '1080p30' });
});

test('thermal stores level and degraded', () => {
  const s = reducer(recording(), { type: 'thermal', level: 'serious', degraded: true });
  expect(s.thermal).toEqual({ level: 'serious', degraded: true });
});

test('stop: recording → stopping → ended', () => {
  const stopping = reducer(recording(), { type: 'stopRequested' });
  expect(stopping.phase).toBe('stopping');
  expect(reducer(stopping, { type: 'stopped' }).phase).toBe('ended');
});

test('reset goes back to idle', () => {
  expect(reducer(recording({ clipCount: 3 }), { type: 'reset' })).toEqual(initialState);
});

test('a save that finishes after the game changed is ignored', () => {
  const next = { ...recording(), sessionId: 's2', clipCount: 0 };
  const s = reducer(next, { type: 'saved', sessionId: 's1', clipId: 'old', source: 'screen', at: 1, cutMs: 30000 });
  expect(s.clipCount).toBe(0);
  expect(s.lastSaved).toBeUndefined();
});

test('camera lifecycle: off → starting → on, and failures keep the code', () => {
  const starting = reducer(initialState, { type: 'cameraStarting' });
  expect(starting.camera).toBe('starting');
  expect(reducer(starting, { type: 'cameraOn' }).camera).toBe('on');
  const failed = reducer(starting, { type: 'cameraFailed', code: 'LOW_STORAGE' });
  expect(failed).toMatchObject({ camera: 'off', error: 'LOW_STORAGE' });
});

test('starting a game keeps the camera that is already on', () => {
  const on = reducer(initialState, { type: 'cameraOn' });
  expect(reducer(on, { type: 'startRequested' }).camera).toBe('on');
});

test('starting a game keeps the heat an open camera reported, and forgets it with the camera off', () => {
  const warm = reducer(reducer(initialState, { type: 'cameraOn' }), { type: 'thermal', level: 'serious', degraded: false });
  expect(reducer(warm, { type: 'startRequested' }).thermal).toEqual({ level: 'serious', degraded: false });
  const off = reducer(warm, { type: 'cameraOff' });
  expect(reducer(off, { type: 'startRequested' }).thermal).toEqual({ level: 'nominal', degraded: false });
});

test('saved keeps neither locked nor lastFree in lastSaved', () => {
  const s = reducer(recording(), { type: 'saved', sessionId: 's1', clipId: 'c1', source: 'screen', at: 1, cutMs: 30_000 });
  expect(s.lastSaved).toEqual({ clipId: 'c1', number: 1, source: 'screen', at: 1, cutMs: 30_000 });
});
