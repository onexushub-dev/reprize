import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { closeDialog, currentDialog, showDialog } from '../dialog';
import { GlassDialogHost } from '../GlassDialog';

afterEach(() => closeDialog());

const spec = (onConfirm = jest.fn()) => ({ title: 'Compartilhar esta gravação?', body: 'Por 24 horas.', cancel: 'Cancelar', confirm: 'Compartilhar', onConfirm });

test('nothing shows until a dialog is asked for (2026-11-23)', async () => {
  await render(<GlassDialogHost />);
  expect(screen.queryByText('Compartilhar esta gravação?')).toBeNull();
});

test('a dialog shows its title, body and both buttons; confirming runs it once and closes', async () => {
  const onConfirm = jest.fn();
  await render(<GlassDialogHost />);
  await act(async () => showDialog(spec(onConfirm)));
  expect(screen.getByText('Compartilhar esta gravação?')).toBeTruthy();
  expect(screen.getByText('Por 24 horas.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(currentDialog()).toBeUndefined();
  expect(screen.queryByText('Compartilhar esta gravação?')).toBeNull();
});

test('cancelling closes it without running anything', async () => {
  const onConfirm = jest.fn();
  await render(<GlassDialogHost />);
  await act(async () => showDialog(spec(onConfirm)));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(currentDialog()).toBeUndefined();
});

test('drawn in the app itself, not a native modal: the screen it opens next is not blocked by one closing (review 2026-11-23)', async () => {
  const view = await render(<GlassDialogHost />);
  await act(async () => showDialog(spec()));
  expect(JSON.stringify(view.toJSON())).not.toMatch(/RCTModalHostView|"type":"Modal"/);
  expect(screen.getByTestId('glass-dialog')).toBeTruthy();
});
