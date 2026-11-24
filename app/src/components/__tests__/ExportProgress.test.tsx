import { fireEvent, render, screen } from '@testing-library/react-native';

import { ExportProgress, exportTitle } from '../ExportProgress';

test('a single clip keeps its titles', () => {
  expect(exportTitle({ kind: 'save', stage: 'preparing' }, 'pt-BR')).toBe('Preparando o vídeo…');
  expect(exportTitle({ kind: 'save', stage: 'delivering' }, 'pt-BR')).toBe('Salvando na galeria…');
  expect(exportTitle({ kind: 'share', stage: 'delivering' }, 'pt-BR')).toBe('Abrindo o compartilhamento…');
});

test('a batch says which clip it is on', () => {
  const job = { kind: 'save', stage: 'preparing', step: { done: 1, total: 5 } } as const;
  expect(exportTitle(job, 'pt-BR')).toBe('Preparando 2 de 5…');
  expect(exportTitle(job, 'en')).toBe('Preparing 2 of 5…');
});

test('the last clip never reads past the total', () => {
  expect(exportTitle({ kind: 'share', stage: 'preparing', step: { done: 5, total: 5 } }, 'pt-BR')).toBe('Preparando 5 de 5…');
});

test('joining the clips has its own title', () => {
  expect(exportTitle({ kind: 'compile', stage: 'joining' }, 'pt-BR')).toBe('Juntando os clipes…');
});

test('with onCancel there is a Cancelar button that calls it; without, the card lets touches through', async () => {
  const onCancel = jest.fn();
  const view = await render(<ExportProgress job={{ kind: 'save', stage: 'preparing', step: { done: 0, total: 3 } }} onCancel={onCancel} />);
  await fireEvent.press(screen.getByRole('button', { name: /Cancel/ }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  await view.unmount();
  await render(<ExportProgress job={{ kind: 'save', stage: 'preparing' }} />);
  expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
});

test('the ring shows how far the video is, in percent (2026-11-23)', async () => {
  await render(<ExportProgress job={{ kind: 'save', stage: 'preparing', progress: 0.42 }} onCancel={jest.fn()} />);
  expect(screen.getByText('42%')).toBeTruthy();
  expect(screen.getByTestId('export-ring')).toBeTruthy();
  expect(screen.getByLabelText('Preparando o vídeo…').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
});

test('with no progress yet the ring spins and no percent is shown', async () => {
  await render(<ExportProgress job={{ kind: 'save', stage: 'preparing' }} onCancel={jest.fn()} />);
  expect(screen.queryByText(/%$/)).toBeNull();
  expect(screen.getByTestId('export-spinner')).toBeTruthy();
});

test('handing over (gallery, share sheet): only the title is left, with no ring, percent or Cancelar (2026-11-23)', async () => {
  await render(<ExportProgress job={{ kind: 'save', stage: 'delivering', progress: 0.42 }} onCancel={jest.fn()} />);
  expect(screen.getByText('Salvando na galeria…')).toBeTruthy();
  expect(screen.queryByTestId('export-ring')).toBeNull();
  expect(screen.queryByTestId('export-spinner')).toBeNull();
  expect(screen.queryByText('42%')).toBeNull();
  expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
  expect(screen.getByLabelText('Salvando na galeria…').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
});

test('after Cancelar the button reads "Cancelando…" and waits, until the video stops (2026-11-23)', async () => {
  const onCancel = jest.fn();
  await render(<ExportProgress job={{ kind: 'save', stage: 'preparing', progress: 0.4, cancelling: true }} onCancel={onCancel} />);
  const button = screen.getByRole('button', { name: 'Cancelando…' });
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
});
