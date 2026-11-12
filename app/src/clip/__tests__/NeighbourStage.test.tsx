import { act, render, screen } from '@testing-library/react-native';
import { Image } from 'react-native';

import { forgetShapes, rememberShape } from '../../components/clipShape';
import { NeighbourStage } from '../NeighbourStage';

jest.mock('../../components/useClipThumbnail', () => ({ useClipThumbnail: () => 'file:///n.jpg' }));
jest.mock('../../data/focusFile', () => ({
  ...jest.requireActual('../../data/focusFile'),
  readFocusFile: jest.fn(() => ({ startMs: 0, stepMs: 100, rects: [[0.25, 0.25, 0.5, 0.5]] })),
}));
jest.mock('../../share/ShareOverlay', () => ({ ShareOverlay: () => null }));

const area = { width: 400, height: 800 };
const clip = {
  path: '/n.mp4',
  trim: { startMs: 0, endMs: 9000 },
  focus: { v: 1 as const, status: 'ready' as const, file: '/n.focus.json' },
  // Jogadores picked on it (since 2026-11-11 a clip starts on the Original)
  edit: { muted: false, framing: 'focus' as const },
};
const transformOf = () => {
  const style = [screen.getByTestId('neighbour-picture').props.style].flat(Infinity).filter(Boolean);
  return style.map((s: any) => s.transform).find(Boolean);
};

beforeEach(() => {
  forgetShapes();
  (jest.spyOn(Image, 'getSize') as jest.Mock).mockResolvedValue({ width: 1080, height: 1920 });
});

test('a neighbour with Modo Foco ready slides in already framed, as it will open', async () => {
  rememberShape('/n.mp4', { width: 1080, height: 1920 });
  await render(<NeighbourStage clip={clip} tier="free" area={area} />);
  expect(transformOf()).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 2 }]);
});

test('a neighbour zoomed by hand slides in with that zoom', async () => {
  rememberShape('/n.mp4', { width: 1080, height: 1920 });
  const zoom = { scale: 3, cx: 0.5, cy: 0.5 };
  await render(<NeighbourStage clip={{ ...clip, edit: { muted: false, zoom } }} tier="free" area={area} />);
  expect(transformOf()).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 3 }]);
});

test('a neighbour with Modo Foco still being prepared slides in whole, as it will open', async () => {
  rememberShape('/n.mp4', { width: 1080, height: 1920 });
  await render(<NeighbourStage clip={{ ...clip, focus: { v: 1, status: 'pending' } as any }} tier="free" area={area} />);
  expect(transformOf()).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
});

test('its shape is measured once, then it is laid out in its own frame', async () => {
  jest.useFakeTimers();
  await render(<NeighbourStage clip={clip} tier="free" area={area} />);
  expect(screen.queryByTestId('neighbour-picture')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  jest.useRealTimers();
  await act(async () => {});
  expect(screen.getByTestId('neighbour-picture')).toBeTruthy();
});
