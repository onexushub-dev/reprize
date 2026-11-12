import type { Clip } from '../../data/schema';
import { exportOptions, freeLosses, WATERMARK_ON_EVERY_PLAN } from '../exportOptions';

const trim = { startMs: 30000, endMs: 60000 };

test('pro exports 1080x1920', () => {
  expect(exportOptions('pro', undefined, trim)).toMatchObject({
    width: 1080,
    height: 1920,
    startMs: 30000,
    endMs: 60000,
    speed: 1,
    muted: false,
  });
});

test('the app mark goes on free exports only, never on Pro or a Pass', () => {
  expect(WATERMARK_ON_EVERY_PLAN).toBe(false);
  expect(exportOptions('free', undefined, trim).watermark).toBe(true);
  expect(exportOptions('pass', undefined, trim).watermark).toBe(false);
  expect(exportOptions('pro', undefined, trim).watermark).toBe(false);
});

test('the chosen speed goes into a free export too', () => {
  expect(exportOptions('free', { speed: 2, muted: false }, trim).speed).toBe(2);
  expect(exportOptions('pro', { speed: 2, muted: false }, trim).speed).toBe(2);
});

test('pass exports 1080x1920', () => {
  expect(exportOptions('pass', undefined, trim)).toMatchObject({ width: 1080, height: 1920 });
});

test('slow motion halves the speed and drops the sound', () => {
  expect(exportOptions('pro', { slowmo: true, muted: false }, trim)).toMatchObject({ speed: 0.5, muted: true });
});

test.each([1.5, 2])('%sx keeps the chosen speed and drops the sound', (speed) => {
  expect(exportOptions('pro', { speed: speed as 1.5 | 2, muted: false }, trim)).toMatchObject({ speed, muted: true });
});

test('no zoom means no crop', () => {
  expect(exportOptions('pro', undefined, trim).crop).toBeUndefined();
  expect(exportOptions('pro', { speed: 1, muted: false, zoom: { scale: 1, cx: 0.5, cy: 0.5 } }, trim).crop).toBeUndefined();
});

test('a zoom exports the visible part of the video', () => {
  const edit = { speed: 1 as const, muted: false, zoom: { scale: 2, cx: 0.25, cy: 0.75 } };
  expect(exportOptions('pro', edit, trim).crop).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
});

test('muted keeps normal speed', () => {
  expect(exportOptions('pro', { slowmo: false, muted: true }, trim)).toMatchObject({ speed: 1, muted: true });
});

test('free exports carry no sound, whatever the clip has', () => {
  expect(exportOptions('free', { speed: 1, muted: false }, trim).muted).toBe(true);
  expect(exportOptions('pro', { speed: 1, muted: false }, trim).muted).toBe(false);
});

test('free exports HD (720x1280), whatever size is asked for', () => {
  expect(exportOptions('free', undefined, trim)).toMatchObject({ width: 720, height: 1280 });
  expect(exportOptions('free', undefined, trim, false, undefined, 2160)).toMatchObject({ width: 720, height: 1280 });
});

test('a turned clip exports with its rotation, and none by default', () => {
  expect(exportOptions('pro', undefined, trim).rotation).toBe(0);
  expect(exportOptions('pro', { speed: 1, muted: false, rotation: 90 }, trim).rotation).toBe(90);
});

test('a landscape clip gets the frame turned on its side, in both tiers', () => {
  expect(exportOptions('pro', undefined, trim, true)).toMatchObject({ width: 1920, height: 1080 });
  expect(exportOptions('free', undefined, trim, true)).toMatchObject({ width: 1280, height: 720 });
  expect(exportOptions('free', undefined, trim)).toMatchObject({ width: 720, height: 1280 });
});

describe('Modo Foco', () => {
  const ready = { path: '/c/1.focus.json', ready: true };

  test('a ready framing follows the clip shape when Modo Foco is on (picked, or an older edit without framing)', () => {
    expect(exportOptions('pro', { muted: false, framing: 'focus' }, trim, true, ready).focus).toEqual({ path: '/c/1.focus.json', aspect: 'landscape' });
    expect(exportOptions('pro', { muted: false }, trim, false, ready).focus).toEqual({ path: '/c/1.focus.json', aspect: 'portrait' });
  });

  test('no framing when off, not ready, turned or zoomed by hand', () => {
    expect(exportOptions('pro', { muted: false, focus: false }, trim, true, ready).focus).toBeUndefined();
    expect(exportOptions('pro', undefined, trim, true, { path: '/c/1.focus.json', ready: false }).focus).toBeUndefined();
    expect(exportOptions('pro', undefined, trim, true).focus).toBeUndefined();
    expect(exportOptions('pro', { muted: false, rotation: 90 }, trim, true, ready).focus).toBeUndefined();
    expect(exportOptions('pro', { muted: false, zoom: { scale: 2, cx: 0.5, cy: 0.5 } }, trim, true, ready).focus).toBeUndefined();
  });
});

test('Modo Foco is a paid edit: a free export never follows, a paid one does', () => {
  const ready = { path: '/c/1.focus.json', ready: true };
  expect(exportOptions('free', { muted: false }, trim, false, ready).focus).toBeUndefined();
  expect(exportOptions('pro', { muted: false }, trim, false, ready).focus).toEqual({ path: '/c/1.focus.json', aspect: 'portrait' });
});

test('freeLosses: what a free export drops, only if the clip had it', () => {
  const ready = { v: 1, status: 'ready', file: '/c.focus.json' } as Clip['focus'];
  const losses = (edit: Clip['edit'], focus: Clip['focus'] = ready) => freeLosses({ edit, focus });
  expect(losses({ muted: false })).toEqual({ focus: true, sound: true });
  expect(losses({ muted: true })).toEqual({ focus: true, sound: false });
  // Away from 1x the video is silent anyway: there is no sound to lose (and the speed is kept).
  expect(losses({ muted: false, speed: 2 })).toEqual({ focus: true, sound: false });
  expect(losses({ muted: false, focus: false }).focus).toBe(false);
  expect(losses({ muted: false, rotation: 90 }).focus).toBe(false);
  expect(losses({ muted: false, zoom: { scale: 2, cx: 0.5, cy: 0.5 } }).focus).toBe(false);
  expect(losses({ muted: false }, { v: 1, status: 'pending' } as Clip['focus']).focus).toBe(false);
  expect(freeLosses({ edit: { muted: false }, focus: undefined }).focus).toBe(false);
});

test('the export size: Full HD by default, 4K or 2K when picked, in the frame orientation', () => {
  expect(exportOptions('pro', undefined, trim, true)).toMatchObject({ width: 1920, height: 1080 });
  expect(exportOptions('pro', undefined, trim, true, undefined, 2160)).toMatchObject({ width: 3840, height: 2160 });
  expect(exportOptions('pro', undefined, trim, false, undefined, 1440)).toMatchObject({ width: 1440, height: 2560 });
});

describe('Seguir a Bola', () => {
  const ball = { path: '/c/1.ball.json', ready: true };
  const on: Clip['edit'] = { muted: false, framing: 'ball' };

  test('a ready framing makes a vertical 9:16 video of any clip, its crop filling the frame', () => {
    const o = exportOptions('pro', on, trim, true, undefined, 1080, ball);
    expect(o).toMatchObject({ width: 1080, height: 1920 });
    expect(o.focus).toEqual({ path: '/c/1.ball.json', aspect: 'portrait', fill: true });
    expect(o.crop).toBeUndefined();
  });

  test('not when off, not ready, turned, or on a free export (as Modo Foco)', () => {
    expect(exportOptions('pro', { muted: false }, trim, true, undefined, 1080, ball).focus).toBeUndefined();
    expect(exportOptions('pro', on, trim, true, undefined, 1080, { ...ball, ready: false })).toMatchObject({ width: 1920, height: 1080 });
    expect(exportOptions('pro', { ...on, rotation: 90 }, trim, true, undefined, 1080, ball).focus).toBeUndefined();
    const free = exportOptions('free', on, trim, true, undefined, 1080, ball);
    expect(free.focus).toBeUndefined();
    expect(free).toMatchObject({ width: 1280, height: 720 });
  });

  test('Modo Foco and Seguir a Bola never both: the ball framing wins only when it is the one chosen', () => {
    const focusReady = { path: '/c/1.focus.json', ready: true };
    expect(exportOptions('pro', on, trim, true, focusReady, 1080, ball).focus).toEqual({ path: '/c/1.ball.json', aspect: 'portrait', fill: true });
    expect(exportOptions('pro', { muted: false }, trim, true, focusReady, 1080, ball).focus).toEqual({ path: '/c/1.focus.json', aspect: 'landscape' });
  });

  test('freeLosses counts it as the framing a free export drops', () => {
    const ready = { v: 1, status: 'ready', startMs: 30000, endMs: 60000, file: '/c/1.ball.json' } as Clip['ball'];
    expect(freeLosses({ edit: on, focus: undefined, ball: ready, trim }).focus).toBe(true);
    // ready for another cut: nothing to lose yet
    expect(freeLosses({ edit: on, focus: undefined, ball: ready, trim: { startMs: 0, endMs: 1000 } }).focus).toBe(false);
  });
});
