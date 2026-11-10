import type { AnalyzeBallOptions, BallAnalysis } from '../../../modules/replay-camera/src/ReplayCamera.types';
import { readyBallFile } from '../../data/ballFile';
import { createRepo, type KV } from '../../data/repo';
import { ballEstimate, createBallQueue } from '../ballQueue';

function setup() {
  const map = new Map<string, string>();
  const kv: KV = { getString: (k) => map.get(k), set: (k, v) => void map.set(k, v), delete: (k) => void map.delete(k) };
  let n = 0;
  const repo = createRepo(kv, { exists: () => true, sizeBytes: () => 1 }, () => `id-${++n}`);
  const runs: { opts: AnalyzeBallOptions; resolve: (a: BallAnalysis) => void; reject: (e: unknown) => void }[] = [];
  let clock = 0;
  const sport: { id: 'basquete' | 'beachTennis' | undefined } = { id: 'basquete' };
  const deps = {
    analyze: jest.fn((o: AnalyzeBallOptions) => new Promise<BallAnalysis>((resolve, reject) => void runs.push({ opts: o, resolve, reject }))),
    cancel: jest.fn(),
    supported: () => true,
    repo,
    now: () => clock,
    sportOf: () => sport.id,
  };
  const queue = createBallQueue(deps);
  const addClip = (path: string) => repo.addClip({ sessionId: 's', createdAt: 1, source: 'screen', path, durationMs: 60000 }, 10000);
  const done = (share = 0.8): BallAnalysis => ({
    status: 'ready',
    analysed: 50,
    reused: 0,
    ballFrames: 80,
    trustedFrames: 70,
    ballShare: share,
    zoom: 1.2,
    elapsedMs: 4000,
  });
  const flush = () => new Promise<void>((r) => setImmediate(() => r()));
  const cancelled = () => Object.assign(new Error('x'), { code: 'CANCELLED' });
  const tick = (ms: number) => {
    clock += ms;
  };
  return { repo, deps, queue, runs, addClip, done, flush, cancelled, tick, sport };
}

test('the switch asks for the current cut; the analysis gets the cut, the cache, the output and Modo Foco file', () => {
  const { repo, queue, runs, addClip } = setup();
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  expect(repo.getClip(clip.id)!.ball).toEqual({ v: 1, status: 'pending', startMs: 50000, endMs: 60000, sport: 'basquete' });
  expect(runs[0].opts).toEqual({
    clipPath: '/c/1.mp4',
    startMs: 50000,
    endMs: 60000,
    detPath: '/c/1.balldet.json',
    outPath: '/c/1.ball.json',
    focusPath: '/c/1.focus.json',
    sport: 'basquete',
  });
});

test('ready for that cut; asking again for the same cut does nothing', async () => {
  const { repo, queue, runs, addClip, done, flush } = setup();
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  runs[0].resolve(done(0.3));
  await flush();
  const stored = repo.getClip(clip.id)!;
  expect(stored.ball).toEqual({
    v: 1,
    status: 'ready',
    startMs: 50000,
    endMs: 60000,
    sport: 'basquete',
    file: '/c/1.ball.json',
    share: 0.3,
  });
  expect(readyBallFile(stored)).toBe('/c/1.ball.json');
  expect(queue.progress(clip.id)).toBeUndefined();
  queue.request(clip.id);
  expect(runs).toHaveLength(1);
});

test('a new cut while it runs: the run stops, the new cut is analysed next and the old result is not kept', async () => {
  const { repo, deps, queue, runs, addClip, done, flush, cancelled } = setup();
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  repo.updateClip(clip.id, { trim: { startMs: 52000, endMs: 58000 } });
  queue.request(clip.id);
  expect(deps.cancel).toHaveBeenCalledWith('/c/1.mp4');
  expect(queue.progress(clip.id)).toMatchObject({ state: 'waiting' });
  runs[0].reject(cancelled());
  await flush();
  expect(runs).toHaveLength(2);
  expect(runs[1].opts).toMatchObject({ startMs: 52000, endMs: 58000 });
  // the first run finishing anyway would not overwrite the request for the new cut
  runs[1].resolve(done());
  await flush();
  expect(repo.getClip(clip.id)!.ball).toMatchObject({ status: 'ready', startMs: 52000, endMs: 58000 });
});

test('a result for a cut no longer wanted is dropped', async () => {
  const { repo, queue, runs, addClip, done, flush } = setup();
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  repo.updateClip(clip.id, { trim: { startMs: 52000, endMs: 58000 } });
  queue.request(clip.id); // asks to stop the run, which finishes before it hears
  runs[0].resolve(done());
  await flush();
  expect(repo.getClip(clip.id)!.ball).toMatchObject({ status: 'pending', startMs: 52000 });
  expect(runs).toHaveLength(2);
});

test('✕ (or Modo Foco on) stops it and forgets the request; a ready analysis stays', async () => {
  const { repo, deps, queue, runs, addClip, flush, cancelled, done } = setup();
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  queue.cancel(clip.id);
  expect(deps.cancel).toHaveBeenCalledWith('/c/1.mp4');
  expect(repo.getClip(clip.id)!.ball).toBeUndefined();
  expect(queue.progress(clip.id)).toBeUndefined();
  runs[0].reject(cancelled());
  await flush();
  expect(runs).toHaveLength(1);
  queue.request(clip.id);
  runs[1].resolve(done());
  await flush();
  queue.cancel(clip.id);
  expect(repo.getClip(clip.id)!.ball).toMatchObject({ status: 'ready' });
});

test('one at a time, the latest asked first', async () => {
  const { queue, runs, addClip, done, flush } = setup();
  const a = addClip('/c/1.mp4');
  const b = addClip('/c/2.mp4');
  const c = addClip('/c/3.mp4');
  queue.request(a.id);
  queue.request(b.id);
  queue.request(c.id);
  expect(runs).toHaveLength(1);
  runs[0].resolve(done());
  await flush();
  expect(runs[1].opts.clipPath).toBe('/c/3.mp4');
});

test('nothing runs while the camera is on: a running one stops and starts again afterwards', async () => {
  const { deps, queue, runs, addClip, flush, cancelled } = setup();
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  queue.setHold('all');
  expect(deps.cancel).toHaveBeenCalledWith('/c/1.mp4');
  runs[0].reject(cancelled());
  await flush();
  expect(runs).toHaveLength(1);
  queue.setHold('none');
  expect(runs).toHaveLength(2);
});

test('the app went to the background: first in line when it is back', async () => {
  const { repo, queue, runs, addClip, flush } = setup();
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  runs[0].reject(Object.assign(new Error('bg'), { code: 'BALL_INTERRUPTED' }));
  await flush();
  expect(repo.getClip(clip.id)!.ball).toMatchObject({ status: 'pending' });
  expect(runs).toHaveLength(1);
  queue.setForeground(true);
  expect(runs).toHaveLength(2);
});

test('failed, and failed for heat, are kept for the chip; asking again retries', async () => {
  const { repo, queue, runs, addClip, flush } = setup();
  const clip = addClip('/c/1.mp4');
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  queue.request(clip.id);
  runs[0].reject(Object.assign(new Error('hot'), { code: 'BALL_HOT' }));
  await flush();
  expect(repo.getClip(clip.id)!.ball).toEqual({
    v: 1,
    status: 'failed',
    startMs: 50000,
    endMs: 60000,
    sport: 'basquete',
    hot: true,
  });
  queue.request(clip.id);
  expect(runs).toHaveLength(2);
  warn.mockRestore();
});

test('progress for the chip: from the native events, with the speed measured from the first analysed frame', () => {
  const { queue, addClip, tick } = setup();
  const clip = addClip('/c/1.mp4');
  const heard = jest.fn();
  const stop = queue.subscribe(heard);
  queue.request(clip.id);
  queue.onNativeProgress({ clipPath: '/c/1.mp4', done: 10, total: 50, state: 'running' });
  tick(2000);
  queue.onNativeProgress({ clipPath: '/c/1.mp4', done: 20, total: 50, state: 'running' });
  const p = queue.progress(clip.id)!;
  expect(p).toMatchObject({ state: 'running', done: 20, total: 50, runningSince: 0, doneAtStart: 10, cutMs: 10000 });
  // 10 frames in 2 s: 30 left take 6 s
  expect(ballEstimate(p, 2000)).toEqual({ percent: 40, secondsLeft: 6 });
  queue.onNativeProgress({ clipPath: '/other.mp4', done: 1, total: 2, state: 'running' });
  expect(queue.progress(clip.id)!.done).toBe(20);
  expect(heard).toHaveBeenCalled();
  stop();
});

test('before the speed is known: about 0.4 s per second of cut', () => {
  expect(ballEstimate({ state: 'running', done: 0, total: 50, cutMs: 10000 }, 0)).toEqual({ percent: 0, secondsLeft: 4 });
  expect(ballEstimate({ state: 'cooling', done: 25, total: 50, cutMs: 10000 }, 0)).toEqual({ percent: 50, secondsLeft: 2 });
});

test('a deleted clip file is dropped from the queue and its run stopped', () => {
  const { deps, queue, addClip } = setup();
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  queue.forget('/c/1.mp4');
  expect(deps.cancel).toHaveBeenCalledWith('/c/1.mp4');
});

test('test 48: the sport picks the analysis; another sport analyses the cut again, none known runs nothing', async () => {
  const { repo, queue, runs, addClip, done, flush, sport } = setup();
  const clip = addClip('/c/1.mp4');
  sport.id = undefined;
  queue.request(clip.id);
  expect(runs).toHaveLength(0);
  expect(repo.getClip(clip.id)!.ball).toBeUndefined();
  sport.id = 'beachTennis';
  queue.request(clip.id);
  expect(runs[0].opts.sport).toBe('beachTennis');
  runs[0].resolve(done());
  await flush();
  expect(repo.getClip(clip.id)!.ball).toMatchObject({ status: 'ready', sport: 'beachTennis' });
  queue.request(clip.id);
  expect(runs).toHaveLength(1);
  // the player says basketball after all: analysed again with basketball's model
  sport.id = 'basquete';
  queue.request(clip.id);
  expect(runs).toHaveLength(2);
  expect(runs[1].opts.sport).toBe('basquete');
});

test('test 47a: not worth it on this video: kept as unsuitable with the reason, not asked again for the cut', async () => {
  const { repo, queue, runs, addClip, done, flush, sport } = setup();
  sport.id = 'beachTennis';
  const clip = addClip('/c/1.mp4');
  queue.request(clip.id);
  runs[0].resolve({ ...done(0.6), status: 'unsuitable', reason: 'tooSmall' });
  await flush();
  expect(repo.getClip(clip.id)!.ball).toEqual({
    v: 1,
    status: 'unsuitable',
    startMs: 50000,
    endMs: 60000,
    sport: 'beachTennis',
    share: 0.6,
    reason: 'tooSmall',
  });
  expect(readyBallFile(repo.getClip(clip.id)!)).toBeUndefined();
  queue.request(clip.id);
  expect(runs).toHaveLength(1);
});
