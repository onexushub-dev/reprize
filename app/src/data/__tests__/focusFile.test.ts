import { FOCUS_MARGIN_MS, focusCovers, focusPath, focusRange, parseFocusFile, readFocusFile } from '../focusFile';

const mockContents = new Map<string, string>();
jest.mock('expo-file-system', () => ({
  File: class {
    mockUri: string;
    constructor(mockPath: string) {
      this.mockUri = mockPath;
    }
    textSync() {
      const text = mockContents.get(this.mockUri);
      if (text === undefined) throw new Error('missing');
      return text;
    }
  },
}));


const valid = {
  v: 1,
  stepMs: 100,
  startMs: 2000,
  size: [1920, 1080],
  landscape: [
    [0.1, 0.2, 0.7, 0.7],
    [0.12, 0.2, 0.7, 0.7],
  ],
  portrait: [[0.3, 0, 0.3164, 1]],
};

test('the focus file sits next to the clip with a .focus.json extension', () => {
  expect(focusPath('/docs/clips/ABC.mp4')).toBe('/docs/clips/ABC.focus.json');
});

test('a valid file gives the track of the asked shape', () => {
  expect(parseFocusFile(JSON.stringify(valid), 'landscape')).toEqual({
    startMs: 2000,
    stepMs: 100,
    rects: [
      [0.1, 0.2, 0.7, 0.7],
      [0.12, 0.2, 0.7, 0.7],
    ],
  });
  expect(parseFocusFile(JSON.stringify(valid), 'portrait')!.rects).toEqual([[0.3, 0, 0.3164, 1]]);
});

test('a broken, truncated, other-version or empty file means no framing', () => {
  expect(parseFocusFile('{', 'landscape')).toBeUndefined();
  expect(parseFocusFile('null', 'landscape')).toBeUndefined();
  expect(parseFocusFile(JSON.stringify({ ...valid, v: 2 }), 'landscape')).toBeUndefined();
  expect(parseFocusFile(JSON.stringify({ ...valid, landscape: [] }), 'landscape')).toBeUndefined();
  expect(parseFocusFile(JSON.stringify({ ...valid, landscape: [[0.1, 0.2]] }), 'landscape')).toBeUndefined();
  expect(parseFocusFile(JSON.stringify({ ...valid, stepMs: 0 }), 'landscape')).toBeUndefined();
});

test('reading a file that is not there means no framing', () => {
  mockContents.set('file:///c/ok.focus.json', JSON.stringify(valid));
  expect(readFocusFile('/c/ok.focus.json', 'landscape')!.startMs).toBe(2000);
  expect(readFocusFile('/c/gone.focus.json', 'landscape')).toBeUndefined();
});

describe('lab test 56: the part Jogadores analyses', () => {
  const clip = { durationMs: 60000, bounds: { startMs: 30000, endMs: 60000 }, trim: { startMs: 40000, endMs: 50000 } };

  test('the cut ± 2 s, inside the clip\'s own part of the file', () => {
    expect(FOCUS_MARGIN_MS).toBe(2000);
    expect(focusRange(clip)).toEqual({ startMs: 38000, endMs: 52000 });
    expect(focusRange({ ...clip, trim: { startMs: 31000, endMs: 59000 } })).toEqual({ startMs: 30000, endMs: 60000 });
    // a clip saved before bounds existed: the cut ± 2 s inside the file
    expect(focusRange({ durationMs: 60000, trim: { startMs: 500, endMs: 59900 } })).toEqual({ startMs: 0, endMs: 60000 });
  });

  test('a result covers a cut inside its range; one from before ranges were kept covers any cut', () => {
    const focus = { v: 1 as const, status: 'ready' as const, file: '/c/1.focus.json', startMs: 38000, endMs: 52000 };
    expect(focusCovers(focus, { startMs: 38000, endMs: 52000 })).toBe(true);
    expect(focusCovers(focus, { startMs: 37999, endMs: 50000 })).toBe(false);
    expect(focusCovers(focus, { startMs: 40000, endMs: 52001 })).toBe(false);
    const before = { v: 1 as const, status: 'ready' as const, file: '/c/1.focus.json' };
    expect(focusCovers(before, { startMs: 0, endMs: 60000 })).toBe(true);
    expect(focusCovers(undefined, { startMs: 0, endMs: 1 })).toBe(false);
  });
});
