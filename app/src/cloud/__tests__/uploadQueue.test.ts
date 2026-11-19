import type { UploadEntry, UploadItem } from '../../../modules/replay-camera/src/ReplayCamera.types';
import type { ConfirmResult } from '../shares';
import type { UploadPlan } from '../uploadPlan';
import { createUploadQueue, videoOf } from '../uploadQueue';

const item = (key: string): UploadItem => ({ id: `shares/sh/${key}`, path: `/local/${key}`, url: `u/${key}`, contentType: 'x' });
const PLAN: UploadPlan = {
  expiresAt: 10_000,
  items: [item('clips/1/thumb.jpg'), item('clips/1/video.mp4'), item('clips/2/video.mp4'), item('clips/2/focus.json')],
};

function setup(
  options: { plan?: UploadPlan; now?: number; confirm?: ConfirmResult | null; cellular?: boolean; paused?: boolean } = {},
) {
  const entries = new Map<string, UploadEntry>();
  const native = {
    start: jest.fn((items: UploadItem[]) => {
      for (const i of items) entries.set(i.id, { id: i.id, path: i.path, status: 'running', bytes: 100, sent: 0, attempts: 1, queuedAt: 0 });
    }),
    pause: jest.fn(),
    resume: jest.fn(),
    remove: jest.fn(),
    restore: jest.fn(),
    state: () => [...entries.values()],
  };
  let paused = options.paused === true;
  let plans: Record<string, UploadPlan> = { sh: options.plan || PLAN };
  let confirmed: number[] = [];
  const confirm = jest.fn(async (): Promise<ConfirmResult | null> =>
    options.confirm === undefined ? { done: [1], missing: [], failed: [] } : options.confirm,
  );
  const queue = createUploadQueue({
    native,
    plans: {
      shareIds: () => Object.keys(plans),
      get: (id) => plans[id],
      forget: (id) => {
        const { [id]: _gone, ...rest } = plans;
        plans = rest;
      },
      confirmed: () => confirmed,
      setConfirmed: (_id, positions) => {
        confirmed = positions;
      },
    },
    confirm,
    cellular: () => (options.cellular === undefined ? true : options.cellular),
    manualPause: {
      get: () => paused,
      set: (value) => {
        paused = value;
      },
    },
    now: () => (options.now === undefined ? 1000 : options.now),
    log: () => {},
  });
  const finish = (key: string, status: UploadEntry['status']) => {
    const id = `shares/sh/${key}`;
    entries.set(id, { ...entries.get(id)!, status, sent: 100 });
  };
  return { queue, native, confirm, finish, plans: () => plans, confirmed: () => confirmed, paused: () => paused };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('the video key of a clip is recognised, other files are not', () => {
  expect(videoOf('shares/abc/clips/12/video.mp4')).toEqual({ shareId: 'abc', position: 12 });
  expect(videoOf('shares/abc/clips/12/thumb.jpg')).toBeUndefined();
});

test('sync starts the whole plan in order with the mobile data choice, and only once', () => {
  const { queue, native } = setup({ cellular: false });
  queue.sync();
  expect(native.start).toHaveBeenCalledTimes(1);
  expect(native.start.mock.calls[0][0].map((i: UploadItem) => [i.id.replace('shares/sh/', ''), i.cellular])).toEqual([
    ['clips/1/thumb.jpg', false],
    ['clips/1/video.mp4', false],
    ['clips/2/video.mp4', false],
    ['clips/2/focus.json', false],
  ]);
  queue.sync();
  expect(native.start).toHaveBeenCalledTimes(1);
});

test('nothing starts while held; the hold pauses and its end resumes and starts what waited', () => {
  const { queue, native } = setup();
  queue.setHold(true);
  expect(native.pause).toHaveBeenCalledTimes(1);
  queue.sync();
  expect(native.start).not.toHaveBeenCalled();
  expect(queue.progress('sh').state).toBe('paused');
  queue.setHold(false);
  expect(native.resume).toHaveBeenCalledWith(true);
  expect(native.start).toHaveBeenCalledTimes(1);
});

test('an expired share is cancelled and forgotten', () => {
  const { queue, native, plans } = setup({ now: 20_000 });
  queue.sync();
  expect(native.remove).toHaveBeenCalledWith(PLAN.items.map((i) => i.id));
  expect(plans()).toEqual({});
  expect(native.start).not.toHaveBeenCalled();
});

test('a finished clip is confirmed with the server and counted', async () => {
  const { queue, confirm, finish, confirmed } = setup();
  queue.sync();
  finish('clips/1/video.mp4', 'done');
  queue.handleDone({ id: 'shares/sh/clips/1/video.mp4', ok: true });
  await flush();
  expect(confirm).toHaveBeenCalledWith('sh', [1]);
  expect(confirmed()).toEqual([1]);
  expect(queue.progress('sh')).toMatchObject({ state: 'uploading', done: 1, total: 2 });
});

test('a clip the server found with another size is sent again', async () => {
  const { queue, native, finish } = setup({ confirm: { done: [], missing: [], failed: [1] } });
  queue.sync();
  finish('clips/1/video.mp4', 'done');
  queue.handleDone({ id: 'shares/sh/clips/1/video.mp4', ok: true });
  await flush();
  expect(native.start).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'shares/sh/clips/1/video.mp4' })]);
});

test('all clips sent is done; clips that gave up show as failed and Tentar de novo sends them again', () => {
  const { queue, native, finish } = setup({ confirm: null });
  queue.sync();
  finish('clips/1/video.mp4', 'done');
  finish('clips/2/video.mp4', 'failed');
  expect(queue.progress('sh')).toMatchObject({ state: 'failed', done: 1, failed: 1, total: 2 });
  queue.retry('sh');
  expect(native.start).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'shares/sh/clips/2/video.mp4' })]);
  finish('clips/2/video.mp4', 'done');
  expect(queue.progress('sh')).toMatchObject({ state: 'done', done: 2 });
});

test('a share with no plan has no progress', () => {
  const { queue } = setup();
  expect(queue.progress('other').state).toBe('none');
});

test('sync first starts again what a swiped-away app left running', () => {
  const { queue, native } = setup();
  queue.sync();
  expect(native.restore).toHaveBeenCalled();
});

test('Pausar envio holds the uploads across launches until Continuar envio; a recording does not undo it', () => {
  const { queue, native, paused } = setup();
  queue.sync();
  queue.setManualPause(true);
  expect(native.pause).toHaveBeenCalledTimes(1);
  expect(paused()).toBe(true);
  expect(queue.progress('sh')).toMatchObject({ state: 'paused', pausedBy: 'you' });
  queue.setHold(true);
  queue.setHold(false);
  expect(native.resume).not.toHaveBeenCalled();
  queue.setManualPause(false);
  expect(native.resume).toHaveBeenCalledTimes(1);
});

test('a pause kept from the last launch starts nothing', () => {
  const { queue, native } = setup({ paused: true });
  queue.sync();
  expect(native.start).not.toHaveBeenCalled();
  expect(native.restore).not.toHaveBeenCalled();
  expect(queue.progress('sh').pausedBy).toBe('you');
});

test('a recording pause says so', () => {
  const { queue } = setup();
  queue.setHold(true);
  expect(queue.progress('sh')).toMatchObject({ state: 'paused', pausedBy: 'recording' });
});

test('a turned-off link cancels and forgets its uploads', () => {
  const { queue, native, plans } = setup();
  queue.forget('sh');
  expect(native.remove).toHaveBeenCalledWith(PLAN.items.map((i) => i.id));
  expect(plans()).toEqual({});
});

test('a clip that finishes while another is being confirmed is confirmed right after', async () => {
  const { queue, confirm, finish } = setup({ confirm: { done: [1], missing: [], failed: [] } });
  queue.sync();
  finish('clips/1/video.mp4', 'done');
  queue.handleDone({ id: 'shares/sh/clips/1/video.mp4', ok: true });
  finish('clips/2/video.mp4', 'done');
  queue.handleDone({ id: 'shares/sh/clips/2/video.mp4', ok: true });
  await flush();
  await flush();
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(confirm).toHaveBeenLastCalledWith('sh', [2]);
});

test('a file not made yet (the cover while it exports) waits, and starts once its path is set', () => {
  const plan: UploadPlan = { expiresAt: 10_000, items: [{ id: 'shares/sh/cover.mp4', path: '', url: 'u', contentType: 'video/mp4' }] };
  const { queue, native } = setup({ plan });
  queue.sync();
  expect(native.start).not.toHaveBeenCalled();
  plan.items[0] = { ...plan.items[0], path: '/doc/cover.mp4' };
  queue.sync();
  expect(native.start).toHaveBeenCalledWith([expect.objectContaining({ id: 'shares/sh/cover.mp4', path: '/doc/cover.mp4' })]);
});
