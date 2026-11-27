import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { colors } from '../../theme/tokens';
import { CameraTour, dimWithHole, type TourStep } from '../CameraTour';

const at = (x: number) => ({ x, y: 630, width: 80, height: 44 });
const steps: TourStep[] = [
  { key: 'clip', target: at(20), title: 'Primeira', body: 'Guarda os últimos **15 segundos**.' },
  { key: 'record', target: { x: 158, y: 714, width: 74, height: 74 }, round: true, title: 'Última', body: 'Toque em Gravar.' },
];

test('one tip at a time: Próximo, then Entendi on the last one ends it', async () => {
  const onDone = jest.fn();
  await render(<CameraTour steps={steps} onDone={onDone} />);
  expect(screen.getByText('1 de 2')).toBeTruthy();
  expect(screen.getByText('Primeira')).toBeTruthy();
  // The starred part is bold, inside the same sentence.
  expect(screen.getByText('15 segundos')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Próximo' }));
  expect(screen.getByText('2 de 2')).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Entendi' }));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('Pular ends it from any tip', async () => {
  const onDone = jest.fn();
  await render(<CameraTour steps={steps} onDone={onDone} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Pular' }));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('the dim covers the screen with a rounded hole on the control', () => {
  const d = dimWithHole(390, 844, { x: 14, y: 624, width: 92, height: 56 }, 28);
  expect(d.startsWith('M0 0H390V844H0Z M42 624')).toBe(true);
  expect(d).toContain('A28 28 0 0 1 106 652');
});

test('a tip without a target dims the whole screen: no hole, no ring, no caret; its label goes before the count', async () => {
  const onDone = jest.fn();
  const tips: TourStep[] = [
    steps[0],
    { key: 'sideways', label: 'Dica extra', title: 'Deitado', body: 'Vire o **celular**.', art: <Text>desenho</Text> },
  ];
  await render(<CameraTour steps={tips} onDone={onDone} />);
  expect(screen.getByTestId('camera-tour-ring')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Próximo' }));
  expect(screen.getByText('Dica extra · 2 de 2')).toBeTruthy();
  expect(screen.getByText('desenho')).toBeTruthy();
  expect(screen.queryByTestId('camera-tour-ring')).toBeNull();
  expect(screen.queryByTestId('camera-tour-caret')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Entendi' }));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('a tip without a target sits centred: equal 16pt margins, no left/right offset carried over from the anchored tips', async () => {
  const tips: TourStep[] = [steps[0], { key: 'sideways', title: 'Deitado', body: 'Vire.', art: <Text>desenho</Text> }];
  await render(<CameraTour steps={tips} onDone={jest.fn()} />);
  const anchored = StyleSheet.flatten(screen.getByTestId('camera-tour-card').props.style);
  expect(anchored).toMatchObject({ position: 'absolute', left: 16, right: 16 });
  await fireEvent.press(screen.getByRole('button', { name: 'Próximo' }));
  const card = StyleSheet.flatten(screen.getByTestId('camera-tour-card').props.style);
  expect(card.marginHorizontal).toBe(16);
  expect(card.position).toBeUndefined();
  expect(card.left).toBeUndefined();
  expect(card.right).toBeUndefined();
  expect('left' in card || 'right' in card || 'transform' in card).toBe(false);
});

test('a highlighted chip is amber with dark text; the others stay as they were', async () => {
  const tips: TourStep[] = [
    {
      key: 'triggers',
      target: at(20),
      title: 'Gatilhos',
      body: 'Escolha um.',
      chips: [
        { label: 'Apple Watch', icon: null, highlight: true },
        { label: 'Controle', icon: null },
      ],
    },
  ];
  await render(<CameraTour steps={tips} onDone={jest.fn()} />);
  const chip = screen.getByTestId('camera-tour-chip-highlight');
  expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ backgroundColor: colors.accent });
  expect(StyleSheet.flatten(screen.getByText('Apple Watch').props.style)).toMatchObject({ color: colors.onAccent });
  expect(StyleSheet.flatten(screen.getByText('Controle').props.style)).toMatchObject({ color: colors.text });
  expect(StyleSheet.flatten(screen.getByText('Controle').parent?.parent?.props.style).backgroundColor).not.toBe(colors.accent);
});

describe('the triggers chips (2026-11-27: "Voz" fell alone on a second line)', () => {
  const chip = (label: string, highlight = false) => ({ label, icon: null, highlight });
  const tip = (chips: TourStep['chips']): TourStep[] => [{ key: 'triggers', target: at(20), title: 'Gatilhos', body: 'Um.', chips }];
  const rows = () => screen.getAllByTestId('camera-tour-chip-row');
  const labels = (row: ReturnType<typeof rows>[number]) =>
    within(row)
      .getAllByText(/./)
      .map((t) => t.props.children);

  test('four chips: two by two, equal, the Apple Watch first in amber', async () => {
    await render(
      <CameraTour steps={tip([chip('Apple Watch', true), chip('Controle'), chip('Aceno'), chip('Voz')])} onDone={jest.fn()} />,
    );
    expect(rows()).toHaveLength(2);
    expect(labels(rows()[0])).toEqual(['Apple Watch', 'Controle']);
    expect(labels(rows()[1])).toEqual(['Aceno', 'Voz']);
    expect(within(rows()[0]).getByTestId('camera-tour-chip-highlight')).toBeTruthy();
    for (const c of [screen.getByTestId('camera-tour-chip-highlight'), ...screen.getAllByTestId('camera-tour-chip')]) {
      expect(StyleSheet.flatten(c.props.style)).toMatchObject({ flex: 1, height: 34, justifyContent: 'center', alignItems: 'center' });
    }
  });

  test('three chips (no Apple Watch): one row of three equal chips', async () => {
    await render(<CameraTour steps={tip([chip('Controle'), chip('Aceno'), chip('Voz')])} onDone={jest.fn()} />);
    expect(rows()).toHaveLength(1);
    expect(labels(rows()[0])).toEqual(['Controle', 'Aceno', 'Voz']);
    for (const c of screen.getAllByTestId('camera-tour-chip')) expect(StyleSheet.flatten(c.props.style).flex).toBe(1);
  });

  test('a label never wraps or gets cut: one line, shrinking a little at worst', async () => {
    await render(<CameraTour steps={tip([chip('Controle'), chip('Aceno'), chip('Voz')])} onDone={jest.fn()} />);
    const label = screen.getByText('Controle');
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.ellipsizeMode).toBeUndefined();
  });
});

test('the caller keeps the tip shown: drawn again, it comes back on the same one', async () => {
  const onIndex = jest.fn();
  const view = await render(<CameraTour steps={steps} index={1} onIndex={onIndex} onDone={jest.fn()} />);
  expect(screen.getByText('2 de 2')).toBeTruthy();
  await view.rerender(<CameraTour steps={steps} index={0} onIndex={onIndex} onDone={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Próximo' }));
  expect(onIndex).toHaveBeenCalledWith(1);
});

test('on its side the card stands upright in a turned frame beside the bar; the ring stays on the control, round-ended', async () => {
  const tall = { x: 38, y: 612, width: 44, height: 80 };
  const tips: TourStep[] = [
    { key: 'clip', target: tall, title: 'Primeira', body: 'Um.' },
    { key: 'sideways', title: 'Deitado', body: 'Vire.', art: <Text>desenho</Text> },
  ];
  await render(<CameraTour steps={tips} turned={{ turn: 90, inset: 200 }} onDone={jest.fn()} />);
  const frame = screen.getByTestId('camera-tour-frame');
  expect(StyleSheet.flatten(frame.props.style).transform).toEqual([{ rotate: '90deg' }]);
  expect(within(frame).getByTestId('camera-tour-card')).toBeTruthy();
  // Beside the bar, on the phone's bottom edge (the turned frame's right when turned clockwise).
  expect(StyleSheet.flatten(screen.getByTestId('camera-tour-card').parent?.props.style)).toMatchObject({ right: 200 });
  expect(screen.queryByTestId('camera-tour-caret')).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId('camera-tour-ring').props.style)).toMatchObject({
    left: 32,
    top: 606,
    width: 56,
    height: 92,
    borderRadius: 28,
  });
  // Already on its side: the drawing of a phone turning is left out (the frame is only the phone's width tall).
  await fireEvent.press(screen.getByRole('button', { name: 'Próximo' }));
  expect(screen.queryByText('desenho')).toBeNull();
  expect(within(frame).getByText('Deitado')).toBeTruthy();
});
