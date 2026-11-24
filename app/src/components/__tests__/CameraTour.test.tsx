import { fireEvent, render, screen } from '@testing-library/react-native';

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
