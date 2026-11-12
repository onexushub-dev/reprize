import { ballContent, clipStage, openingZoom, pictureTransform, previewBox } from '../stage';

const track = { startMs: 0, stepMs: 100, rects: [[0.25, 0.25, 0.5, 0.5], [0, 0, 0.5, 0.5]] as [number, number, number, number][] };

describe('openingZoom: what the picture shows when the clip starts playing', () => {
  test('Modo Foco on and ready: the framing at the start of the cut', () => {
    const on = { muted: false, framing: 'focus' as const };
    expect(openingZoom(on, track, 0)).toEqual({ scale: 2, cx: 0.5, cy: 0.5 });
    expect(openingZoom(on, track, 100)).toEqual({ scale: 2, cx: 0.25, cy: 0.25 });
  });

  test('Modo Foco not ready yet: the whole video', () => {
    expect(openingZoom(undefined, undefined, 0)).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });
  });

  test('Modo Foco turned off: the whole video', () => {
    expect(openingZoom({ muted: false, focus: false }, track, 0)).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });
  });

  test('a zoom by hand wins over Modo Foco', () => {
    const zoom = { scale: 3, cx: 0.2, cy: 0.7 };
    expect(openingZoom({ muted: false, zoom }, track, 0)).toEqual(zoom);
  });

  test('a turned clip has no Modo Foco, but keeps its hand zoom', () => {
    expect(openingZoom({ muted: false, rotation: 90 }, track, 0)).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });
    const zoom = { scale: 2, cx: 0.4, cy: 0.4 };
    expect(openingZoom({ muted: false, rotation: 90, zoom }, track, 0)).toEqual(zoom);
  });
});

test('clipStage: a vertical clip gets a vertical frame filled by the video; a landscape one a landscape frame', () => {
  const vertical = clipStage('paid', undefined, { startMs: 0, endMs: 1000 }, { width: 1080, height: 1920 }, false);
  expect(vertical.landscape).toBe(false);
  expect(vertical.frame).toEqual({ width: 1080, height: 1920 });
  expect(vertical.layout.video).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  const turned = clipStage('paid', { muted: false, rotation: 90 }, { startMs: 0, endMs: 1000 }, { width: 1080, height: 1920 }, false);
  expect(turned.landscape).toBe(true);
  expect(turned.frame).toEqual({ width: 1920, height: 1080 });
});

test('previewBox: the frame as large as the area allows, the video box scaled with it', () => {
  const { frame, layout } = clipStage('free', undefined, { startMs: 0, endMs: 1000 }, { width: 1920, height: 1080 }, false);
  const box = previewBox(frame, layout, { width: 400, height: 800 });
  expect(box.width).toBe(400);
  expect(box.height).toBeCloseTo(225);
  expect(box.video.width).toBeCloseTo(400);
  expect(box.video.height).toBeCloseTo(225);
});

test('pictureTransform: moves the zoomed point to the middle of the box', () => {
  expect(pictureTransform({ scale: 2, cx: 0.25, cy: 0.75 }, { width: 100, height: 200 })).toEqual([
    { translateX: 50 },
    { translateY: -100 },
    { scale: 2 },
  ]);
});

describe('Seguir a Bola', () => {
  const cut = { startMs: 0, endMs: 1000 };
  const on = { muted: false, framing: 'ball' as const };
  const landscape = { width: 1920, height: 1080 };

  test('paid: a landscape clip previews and exports in a 9:16 frame filled by the moving crop', () => {
    const s = clipStage('paid', on, cut, landscape, false, undefined, 1080, '/c/1.ball.json');
    expect(s.ball).toBe(true);
    expect(s.frame).toEqual({ width: 1080, height: 1920 });
    expect(s.layout.video).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(s.preview.frame).toEqual(s.frame);
  });

  test('free: the app still shows it in 9:16; the export keeps the clip frame without it', () => {
    const s = clipStage('free', on, cut, landscape, false, undefined, 1080, '/c/1.ball.json');
    expect(s.ball).toBe(true);
    expect(s.frame).toEqual({ width: 1280, height: 720 });
    expect(s.options.focus).toBeUndefined();
    expect(s.preview.frame).toEqual({ width: 720, height: 1280 });
    expect(s.preview.layout.video).toEqual({ x: 0, y: 0, width: 720, height: 1280 });
  });

  test('not ready, or a compilation forced landscape: the clip frame as before', () => {
    expect(clipStage('paid', on, cut, landscape, false).frame).toEqual({ width: 1920, height: 1080 });
    const forced = clipStage('paid', on, cut, landscape, false, true, 1080, '/c/1.ball.json');
    expect(forced.ball).toBe(false);
    expect(forced.frame).toEqual({ width: 1920, height: 1080 });
  });

  test('the picture in the 9:16 box: the video at its own shape, as tall as the box', () => {
    expect(ballContent(landscape, { width: 90, height: 160 })).toEqual({ width: (160 * 1920) / 1080, height: 160 });
  });

  test('openingZoom: the ball framing at the start of the cut, scaled by its height', () => {
    const ballTrack = { startMs: 0, stepMs: 100, rects: [[0.3, 0, 0.3164, 1]] as [number, number, number, number][] };
    const z = openingZoom(on, track, 0, ballTrack);
    expect(z.scale).toBe(1);
    expect(z.cx).toBeCloseTo(0.4582);
    expect(openingZoom({ muted: false }, track, 0, ballTrack)).toEqual({ scale: 2, cx: 0.5, cy: 0.5 });
  });
});
