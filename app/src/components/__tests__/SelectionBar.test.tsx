import { fireEvent, render, screen } from '@testing-library/react-native';

import { SelectionBar } from '../SelectionBar';

const props = (over: object = {}) => ({
  count: 3,
  paid: true,
  busy: false,
  onShare: jest.fn(),
  onSave: jest.fn(),
  onCompile: jest.fn(),
  onLabel: jest.fn(),
  onDelete: jest.fn(),
  ...over,
});

test('with onLink, the link button comes first, before Enviar, and opens the link (2026-11-23)', async () => {
  const onLink = jest.fn();
  await render(<SelectionBar {...props({ onLink })} />);
  const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);
  expect(labels.slice(0, 2)).toEqual(['Compartilhar 3 clipes por link', 'Enviar (3)']);
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar 3 clipes por link' }));
  expect(onLink).toHaveBeenCalledTimes(1);
});

test('without onLink there is no link button', async () => {
  await render(<SelectionBar {...props()} />);
  expect(screen.queryByRole('button', { name: /por link/ })).toBeNull();
});

test('the buttons are icons only: the only text on the bar is how many are picked', async () => {
  await render(<SelectionBar {...props({ onLink: jest.fn() })} />);
  expect(screen.getByText('3 clipes selecionados')).toBeTruthy();
  expect(screen.queryByText(/Compartilhar|Enviar|Apagar/)).toBeNull();
});

test('nothing picked: the link button waits like the others', async () => {
  await render(<SelectionBar {...props({ count: 0, onLink: jest.fn() })} />);
  expect(screen.getByRole('button', { name: 'Compartilhar 0 clipes por link' })).toBeDisabled();
});
