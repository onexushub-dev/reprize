import { fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet, Text } from 'react-native';

import { GLASS, GlassButton } from '../GlassButton';

jest.mock('../useReduceMotion', () => ({ useReduceMotion: jest.fn(() => false) }));
const { useReduceMotion } = jest.requireMock('../useReduceMotion');

beforeEach(() => jest.clearAllMocks());

test('a button in the glass look: dark body, light rim brighter on top; its own size and an "on" colour win', async () => {
  await render(
    <GlassButton accessibilityLabel="Voltar" onPress={jest.fn()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFB000' }}>
      <Text>x</Text>
    </GlassButton>,
  );
  const style = StyleSheet.flatten(screen.getByRole('button', { name: 'Voltar' }).props.style);
  expect(style).toMatchObject({ width: 40, borderRadius: 20, borderWidth: 1, borderColor: GLASS.rim, borderTopColor: GLASS.rimTop });
  expect(style.backgroundColor).toBe('#FFB000');
});

test('over a video or the camera: the see-through body', async () => {
  await render(
    <GlassButton accessibilityLabel="Zoom" variant="overlay" onPress={jest.fn()}>
      <Text>1x</Text>
    </GlassButton>,
  );
  expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Zoom' }).props.style).backgroundColor).toBe(GLASS.overlay);
});

test('a touch grows it a little and lights it up, a release springs it back; the taps still reach the screen', async () => {
  const spring = jest.spyOn(Animated, 'spring');
  const timing = jest.spyOn(Animated, 'timing');
  const onPress = jest.fn();
  const onPressIn = jest.fn();
  await render(
    <GlassButton accessibilityLabel="Apagar" onPress={onPress} onPressIn={onPressIn}>
      <Text>x</Text>
    </GlassButton>,
  );
  const button = screen.getByRole('button', { name: 'Apagar' });
  await fireEvent(button, 'pressIn');
  expect(spring).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1.08, useNativeDriver: true }));
  expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, useNativeDriver: true }));
  expect(onPressIn).toHaveBeenCalledTimes(1);
  await fireEvent(button, 'pressOut');
  expect(spring).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, useNativeDriver: true }));
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
  spring.mockRestore();
  timing.mockRestore();
});

test('with Reduce Motion it only lights up', async () => {
  useReduceMotion.mockReturnValue(true);
  const spring = jest.spyOn(Animated, 'spring');
  await render(
    <GlassButton accessibilityLabel="Fechar" onPress={jest.fn()}>
      <Text>x</Text>
    </GlassButton>,
  );
  await fireEvent(screen.getByRole('button', { name: 'Fechar' }), 'pressIn');
  expect(spring).not.toHaveBeenCalled();
  spring.mockRestore();
});

test('bare: no body, no rim, no glow; only the grow and spring back (the icons beside Gravar)', async () => {
  useReduceMotion.mockReturnValue(false);
  const spring = jest.spyOn(Animated, 'spring');
  const timing = jest.spyOn(Animated, 'timing');
  await render(
    <GlassButton accessibilityLabel="Ajustes" variant="bare" onPress={jest.fn()} style={{ width: 56, height: 56 }}>
      <Text>x</Text>
    </GlassButton>,
  );
  const button = screen.getByRole('button', { name: 'Ajustes' });
  const style = StyleSheet.flatten(button.props.style);
  expect(style.borderWidth).toBeUndefined();
  expect(style.backgroundColor).toBeUndefined();
  await fireEvent(button, 'pressIn');
  expect(spring).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1.08 }));
  expect(timing).not.toHaveBeenCalled();
  spring.mockRestore();
  timing.mockRestore();
});
