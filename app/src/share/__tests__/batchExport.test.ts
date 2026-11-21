import type { Clip } from '../../data/schema';
import { type BatchResult, EXPORT_CONCURRENCY, runBatch } from '../batchExport';
import { clipExportJob } from '../clipExport';
import { forgetAllExportsForTests, rememberExport } from '../exportCache';

const mockFiles = new Set<string>();
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  },
  Directory: class {
    list() {
      return [];
    }
  },
  Paths: { cache: '/cache' },
}));
jest.mock('../../../modules/replay-camera', () => ({ createThumbnail: jest.fn() }));

const vertical = { width: 1080, height: 1920 };
const clipOf = (id: string, extra: Partial<Clip> = {}): Clip => ({
  id,
  sessionId: 's1',
  createdAt: 0,
  source: 'screen',
  path: `/${id}.mp4`,
  durationMs: 30000,
  trim: { startMs: 0, endMs: 30000 },
  ...extra,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let made = 0;

function setup(delays: Record<string, number> = {}, failing: string[] = []) {
  made = 0;
  let inflight = 0;
  let most = 0;
  const calls: { clipPath: string; width: number; height: number }[] = [];
  const exportClip = jest.fn(async (o: { clipPath: string; width: number; height: number }) => {
    calls.push(o);
    inflight += 1;
    most = Math.max(most, inflight);
    await sleep(delays[o.clipPath] !== undefined ? delays[o.clipPath] : 5);
    inflight -= 1;
    if (failing.includes(o.clipPath)) throw new Error('boom');
    made += 1;
    const path = `/exports/e${made}.mp4`;
    mockFiles.add(`file://${path}`);
    return { path, durationMs: 30000 };
  });
  const capture = jest.fn(async () => '/o.png');
  const progress: [number, number][] = [];
  const base = {
    plan: 'free' as const,
    capture,
    exportClip,
    shapeOf: async () => vertical,
    fileExists: () => true,
    onProgress: (done: number, total: number) => progress.push([done, total]),
    signal: { cancelled: false },
  };
  return { base, exportClip, capture, progress, calls, most: () => most };
}

beforeEach(() => {
  forgetAllExportsForTests();
  mockFiles.clear();
});

const paths = (r: BatchResult) => r.done.map((d) => d.clip.id);

test('results keep the recording order even when a later clip finishes first', async () => {
  const t = setup({ '/a.mp4': 40, '/b.mp4': 5 });
  const r = await runBatch({ ...t.base, clips: [clipOf('a'), clipOf('b')] });
  expect(paths(r)).toEqual(['a', 'b']);
});

test('runs at most two exports at a time', async () => {
  expect(EXPORT_CONCURRENCY).toBe(2);
  const t = setup();
  await runBatch({ ...t.base, clips: ['a', 'b', 'c', 'd', 'e'].map((id) => clipOf(id)) });
  expect(t.most()).toBe(2);
});

test('progress counts finished clips', async () => {
  const t = setup();
  await runBatch({ ...t.base, clips: ['a', 'b', 'c'].map((id) => clipOf(id)) });
  expect(t.progress).toEqual([
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});

test('a look already exported is not exported again', async () => {
  const t = setup();
  const a = clipOf('a');
  rememberExport(clipExportJob(a, 'free', vertical).key, '/old.mp4');
  mockFiles.add('file:///old.mp4');
  const r = await runBatch({ ...t.base, clips: [a, clipOf('b')] });
  expect(t.exportClip).toHaveBeenCalledTimes(1);
  expect(r.done.map((d) => d.path)).toEqual(['/old.mp4', '/exports/e1.mp4']);
});

test('a failing clip is reported and the others finish', async () => {
  const t = setup({}, ['/b.mp4']);
  const r = await runBatch({ ...t.base, clips: ['a', 'b', 'c'].map((id) => clipOf(id)) });
  expect(paths(r)).toEqual(['a', 'c']);
  expect(r.failed.map((f) => [f.clip.id, f.reason])).toEqual([['b', 'export']]);
});

test('a clip whose file is gone is reported as missing and nothing is exported for it', async () => {
  const t = setup();
  const r = await runBatch({ ...t.base, fileExists: (p: string) => p !== '/b.mp4', clips: ['a', 'b', 'c'].map((id) => clipOf(id)) });
  expect(r.failed.map((f) => [f.clip.id, f.reason])).toEqual([['b', 'missing']]);
  expect(t.calls.map((c) => c.clipPath)).toEqual(['/a.mp4', '/c.mp4']);
  expect(paths(r)).toEqual(['a', 'c']);
});

test('cancel stops starting clips; one finishing after cancel is removed and not returned', async () => {
  const t = setup({ '/a.mp4': 30, '/b.mp4': 30 });
  const signal = { cancelled: false };
  const running = runBatch({ ...t.base, signal, clips: ['a', 'b', 'c', 'd'].map((id) => clipOf(id)) });
  await sleep(10);
  signal.cancelled = true;
  const r = await running;
  expect(t.exportClip).toHaveBeenCalledTimes(2);
  expect(r.done).toEqual([]);
  expect(mockFiles.size).toBe(0);
});

test('a forced orientation reaches every job', async () => {
  const t = setup();
  await runBatch({ ...t.base, orientation: 'landscape', clips: [clipOf('a'), clipOf('b')] });
  expect(t.calls.every((c) => c.width > c.height)).toBe(true);
});

test('the overlay pictures are left to their owner (they are shared between clips)', async () => {
  const t = setup();
  await runBatch({ ...t.base, clips: [clipOf('a'), clipOf('b')] });
  expect(t.capture).toHaveBeenCalledTimes(2);
});

test('timing reports the concurrency and one entry per exported clip', async () => {
  const t = setup();
  const a = clipOf('a');
  rememberExport(clipExportJob(a, 'free', vertical).key, '/old.mp4');
  mockFiles.add('file:///old.mp4');
  const r = await runBatch({ ...t.base, clips: [a, clipOf('b'), clipOf('c')] });
  expect(r.timing.concurrency).toBe(2);
  expect(r.timing.perClipMs).toHaveLength(2);
  // The fake exports wait 5 ms; Date.now() can count a millisecond less on a busy machine.
  expect(r.timing.totalMs).toBeGreaterThanOrEqual(3);
});
