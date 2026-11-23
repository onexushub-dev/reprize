import type { PrepJob } from '../shareInput';
import { createSharePrep, CUTS_AT_ONCE } from '../sharePrep';
import type { UploadPlan } from '../uploadPlan';

const item = (id: string, path = '') => ({ id, path, url: `u/${id}`, contentType: 'x' });

function setup(options: { jobs?: Record<string, PrepJob[]>; plans?: Record<string, UploadPlan>; files?: Record<string, string>; cut?: 'ok' | 'fail' | 'none' } = {}) {
  let jobs: Record<string, PrepJob[]> = options.jobs || {};
  const plans: Record<string, UploadPlan> = options.plans || {};
  const files: Record<string, string> = options.files || {};
  const written: Record<string, string> = {};
  const order: string[] = [];
  const cut = jest.fn((_source: string, out: string, _startMs: number, _endMs: number, _muted: boolean) => {
    order.push(out);
    if (options.cut === 'none') return undefined;
    return options.cut === 'fail' ? Promise.reject(new Error('interrupted')) : Promise.resolve({ path: out });
  });
  const sync = jest.fn();
  const log = jest.fn();
  const prep = createSharePrep({
    shares: () => Object.keys(plans),
    jobs: {
      get: (id) => jobs[id] || [],
      set: (id, list) => {
        jobs = { ...jobs, [id]: list };
      },
    },
    plan: {
      get: (id) => plans[id],
      save: (id, plan) => {
        plans[id] = plan;
      },
    },
    cut,
    exists: (path) => path in files,
    readText: (path) => files[path],
    writeText: (path, text) => {
      written[path] = text;
    },
    outPath: (shareId, job) => `/made/${shareId}/${job.id.split('/').slice(-2).join('-')}`,
    sync,
    log,
  });
  return { prep, plans, jobs: () => jobs, cut, sync, written, order };
}

const video = (share: string, n: number): PrepJob => ({
  id: `shares/${share}/clips/${n}/video.mp4`,
  kind: 'cut',
  source: `/clips/${n}.mp4`,
  startMs: 10_000,
  endMs: 25_000,
  muted: n === 2,
});

test('each cut is made in the plan\'s order and its upload starts as soon as it is ready', async () => {
  const { prep, plans, cut, sync, jobs } = setup({
    plans: {
      r1: { expiresAt: 1, items: [item('shares/r1/clips/1/video.mp4'), item('shares/r1/clips/2/video.mp4')] },
      r2: { expiresAt: 1, items: [item('shares/r2/clips/1/video.mp4')] },
    },
    jobs: { r1: [video('r1', 1), video('r1', 2)], r2: [video('r2', 1)] },
    files: { '/clips/1.mp4': '', '/clips/2.mp4': '' },
  });
  await prep.run();
  expect(cut.mock.calls.map((c) => [c[1], c[2], c[3], c[4]])).toEqual([
    ['/made/r1/1-video.mp4', 10_000, 25_000, false],
    ['/made/r1/2-video.mp4', 10_000, 25_000, true],
    ['/made/r2/1-video.mp4', 10_000, 25_000, false],
  ]);
  expect(plans.r1.items.map((i) => i.path)).toEqual(['/made/r1/1-video.mp4', '/made/r1/2-video.mp4']);
  expect(plans.r2.items[0].path).toBe('/made/r2/1-video.mp4');
  expect(sync.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(jobs()).toEqual({ r1: [], r2: [] });
});

test('a framing file is put on the cut\'s time, as text, with no picture analysed', async () => {
  const framing: PrepJob = { id: 'shares/r1/clips/1/focus.json', kind: 'framing', source: '/clips/1.focus.json', startMs: 1_000, endMs: 2_000 };
  const text = JSON.stringify({ v: 1, startMs: 0, stepMs: 500, portrait: [[0, 0, 1, 1], [0.1, 0, 1, 1], [0.2, 0, 1, 1], [0.3, 0, 1, 1], [0.4, 0, 1, 1]] });
  const { prep, plans, written, cut } = setup({
    plans: { r1: { expiresAt: 1, items: [item('shares/r1/clips/1/focus.json')] } },
    jobs: { r1: [framing] },
    files: { '/clips/1.focus.json': text },
  });
  await prep.run();
  expect(cut).not.toHaveBeenCalled();
  expect(JSON.parse(written['/made/r1/1-focus.json'])).toMatchObject({ startMs: 0, portrait: [[0.2, 0, 1, 1], [0.3, 0, 1, 1], [0.4, 0, 1, 1]] });
  expect(plans.r1.items[0].path).toBe('/made/r1/1-focus.json');
});

test('a cut iOS stopped (the app left the front) stays to be made on the next run; nothing after it runs', async () => {
  const { prep, plans, jobs } = setup({
    plans: { r1: { expiresAt: 1, items: [item('shares/r1/clips/1/video.mp4'), item('shares/r1/clips/2/video.mp4')] } },
    jobs: { r1: [video('r1', 1), video('r1', 2)] },
    files: { '/clips/1.mp4': '', '/clips/2.mp4': '' },
    cut: 'fail',
  });
  await prep.run();
  expect(plans.r1.items.map((i) => i.path)).toEqual(['', '']);
  expect(jobs().r1).toHaveLength(2);
});

test('a clip whose file is gone is not sent: its upload leaves the plan', async () => {
  const { prep, plans } = setup({
    plans: { r1: { expiresAt: 1, items: [item('shares/r1/clips/1/video.mp4'), item('shares/r1/clips/1/thumb.jpg', '/t.jpg')] } },
    jobs: { r1: [video('r1', 1)] },
  });
  await prep.run();
  expect(plans.r1.items.map((i) => i.id)).toEqual(['shares/r1/clips/1/thumb.jpg']);
});

test('where the phone cannot cut, nothing uncut is ever sent in its place', async () => {
  const { prep, plans } = setup({
    plans: { r1: { expiresAt: 1, items: [item('shares/r1/clips/1/video.mp4')] } },
    jobs: { r1: [video('r1', 1)] },
    files: { '/clips/1.mp4': '' },
    cut: 'none',
  });
  await prep.run();
  expect(plans.r1.items[0].path).toBe('');
});

test('a few cuts at a time, in the plan\'s order, all of it inside the extra time iOS gives', async () => {
  const pending: (() => void)[] = [];
  let atOnce = 0;
  let most = 0;
  const plans: Record<string, UploadPlan> = { r1: { expiresAt: 1, items: [] } };
  let jobs: PrepJob[] = [];
  for (let n = 1; n <= 7; n += 1) {
    plans.r1.items.push(item(`shares/r1/clips/${n}/video.mp4`));
    jobs.push(video('r1', n));
  }
  const started: string[] = [];
  const background = jest.fn(async (work: () => Promise<void>) => work());
  const prep = createSharePrep({
    shares: () => ['r1'],
    jobs: { get: () => jobs, set: (_id, list) => (jobs = list) },
    plan: { get: (id) => plans[id], save: (id, plan) => (plans[id] = plan) },
    cut: (_source, out) => {
      started.push(out);
      atOnce += 1;
      most = Math.max(most, atOnce);
      return new Promise((resolve) =>
        pending.push(() => {
          atOnce -= 1;
          resolve({ path: out });
        }),
      );
    },
    exists: () => true,
    readText: () => undefined,
    writeText: () => {},
    outPath: (_shareId, job) => `/made/${job.id.split('/')[3]}`,
    sync: jest.fn(),
    log: jest.fn(),
    background,
  });
  const running = prep.run();
  while (started.length < 7 || pending.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const next = pending.shift();
    if (next !== undefined) next();
  }
  await running;
  expect(most).toBe(CUTS_AT_ONCE);
  expect(started).toEqual(['/made/1', '/made/2', '/made/3', '/made/4', '/made/5', '/made/6', '/made/7']);
  expect(plans.r1.items.every((i) => i.path !== '')).toBe(true);
  expect(background).toHaveBeenCalledTimes(1);
});
