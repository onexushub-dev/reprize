import type { ExportClipOptions, ExportedClip } from '../../../modules/replay-camera';
import { createExportTracker, isCancelled } from '../exportTracker';

jest.mock('../../../modules/replay-camera', () => ({
  exportClip: jest.fn(),
  cancelExport: jest.fn(),
  addReplayListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const options = { clipPath: '/a.mp4', startMs: 0, endMs: 1000, speed: 1, muted: false, width: 1080, height: 1920, background: '#0A0A0A' };

function setup() {
  let emit: (e: { exportId: string; progress: number }) => void = () => {};
  const remove = jest.fn();
  const pending: { id: string; resolve: (c: ExportedClip) => void; reject: (e: unknown) => void }[] = [];
  const exportClip = jest.fn(
    (o: ExportClipOptions) =>
      new Promise<ExportedClip>((resolve, reject) => {
        pending.push({ id: o.exportId as string, resolve, reject });
      }),
  );
  const cancel = jest.fn();
  let n = 0;
  const tracker = createExportTracker({
    exportClip,
    cancel,
    newId: () => `e${++n}`,
    listen: (cb) => {
      emit = cb;
      return { remove };
    },
  });
  return { tracker, exportClip, cancel, pending, remove, emit: (id: string, progress: number) => emit({ exportId: id, progress }) };
}

test('each export gets its own id, passed to the native export', () => {
  const { tracker, exportClip } = setup();
  void tracker.exportClip(options);
  void tracker.exportClip(options);
  expect(exportClip.mock.calls.map((c) => c[0].exportId)).toEqual(['e1', 'e2']);
  expect(tracker.running()).toBe(2);
});

test('the running exports add up their progress; nothing is known before the first event', () => {
  const { tracker, emit } = setup();
  void tracker.exportClip(options);
  void tracker.exportClip(options);
  expect(tracker.known()).toBe(false);
  expect(tracker.runningProgress()).toBe(0);
  emit('e1', 0.5);
  emit('e2', 0.25);
  expect(tracker.known()).toBe(true);
  expect(tracker.runningProgress()).toBe(0.75);
});

test('a finished export leaves the running ones, and its listeners hear about it', async () => {
  const { tracker, pending, emit } = setup();
  const listener = jest.fn();
  tracker.subscribe(listener);
  const made = tracker.exportClip(options);
  emit('e1', 0.9);
  expect(listener).toHaveBeenCalledTimes(1);
  pending[0].resolve({ path: '/out.mp4', durationMs: 1000 });
  await expect(made).resolves.toEqual({ path: '/out.mp4', durationMs: 1000 });
  expect(tracker.running()).toBe(0);
  expect(tracker.runningProgress()).toBe(0);
  expect(listener).toHaveBeenCalledTimes(2);
});

test('a failed export leaves the running ones and its error goes on', async () => {
  const { tracker, pending } = setup();
  const made = tracker.exportClip(options);
  pending[0].reject(Object.assign(new Error('x'), { code: 'ENCODER_FAILED' }));
  await expect(made).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
  expect(tracker.running()).toBe(0);
});

test('cancelAll stops every running export at once, even one with no progress yet', () => {
  const { tracker, cancel, emit } = setup();
  void tracker.exportClip(options);
  void tracker.exportClip(options);
  emit('e1', 0.3);
  tracker.cancelAll();
  expect(cancel.mock.calls.map((c) => c[0])).toEqual(['e1', 'e2']);
});

test('progress for an export it does not run is ignored', () => {
  const { tracker, emit } = setup();
  void tracker.exportClip(options);
  emit('other', 0.8);
  expect(tracker.known()).toBe(false);
  expect(tracker.runningProgress()).toBe(0);
});

test('dispose stops listening', () => {
  const { tracker, remove } = setup();
  tracker.dispose();
  expect(remove).toHaveBeenCalled();
});

test('isCancelled tells a cancelled export from a failed one', () => {
  expect(isCancelled({ code: 'CANCELLED' })).toBe(true);
  expect(isCancelled(Object.assign(new Error('x'), { code: 'ENCODER_FAILED' }))).toBe(false);
  expect(isCancelled(new Error('x'))).toBe(false);
  expect(isCancelled(undefined)).toBe(false);
});

test('after cancelAll, an export about to start stops before reaching the phone, until reset (review 2026-11-23)', async () => {
  const { tracker, exportClip } = setup();
  tracker.cancelAll();
  await expect(tracker.exportClip(options)).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(exportClip).not.toHaveBeenCalled();
  tracker.reset();
  void tracker.exportClip(options);
  expect(exportClip).toHaveBeenCalledTimes(1);
});
