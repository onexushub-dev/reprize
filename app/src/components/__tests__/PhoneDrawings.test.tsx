import { act, render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';

import { PhoneSideways } from '../PhoneDrawings';

jest.mock('../useReduceMotion', () => ({ useReduceMotion: jest.fn(() => false) }));
const { useReduceMotion } = jest.requireMock('../useReduceMotion');

afterEach(() => {
  jest.restoreAllMocks();
  useReduceMotion.mockReturnValue(false);
});

const transformOf = (id: string) => StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style).transform;

test('sideways: the window and the ball glide on a loop, stopped on unmount', async () => {
  const start = jest.fn();
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: jest.fn() });
  await render(<PhoneSideways />);
  expect(loop).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(1);
  expect(transformOf('sideways-window')).toHaveLength(1);
  expect(transformOf('sideways-ball')).toHaveLength(1);
  await act(async () => screen.unmount());
  expect(stop).toHaveBeenCalledTimes(1);
});

test('sideways with reduce motion: no loop, the window and the ball rest in the middle', async () => {
  useReduceMotion.mockReturnValue(true);
  const loop = jest.spyOn(Animated, 'loop');
  await render(<PhoneSideways />);
  expect(loop).not.toHaveBeenCalled();
  expect(transformOf('sideways-window')).toBeUndefined();
  expect(transformOf('sideways-ball')).toBeUndefined();
});
