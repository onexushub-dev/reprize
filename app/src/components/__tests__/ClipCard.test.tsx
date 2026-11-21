import { render, screen } from '@testing-library/react-native';

import type { Clip } from '../../data/schema';
import { ClipCard, PendingClipTile } from '../ClipCard';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../useClipThumbnail', () => ({ useClipThumbnail: () => undefined }));

const clip: Clip = {
  id: 'c1', sessionId: 's1', createdAt: 0, source: 'gesture', path: '/c1.mp4', durationMs: 30000,
  trim: { startMs: 0, endMs: 30000 },
};

const card = (c: Clip) => <ClipCard clip={c} number={1} width={120} onPress={() => {}} />;

test('a tile shows its number and length, and its label when it has one', async () => {
  const { rerender } = await render(card(clip));
  expect(screen.getByText('1')).toBeTruthy();
  expect(screen.getByText('0:30')).toBeTruthy();
  await rerender(card({ ...clip, name: 'Ataque' }));
  expect(screen.getByText('Ataque')).toBeTruthy();
});

test('a clip that was not sent anywhere says nothing about it', async () => {
  await render(card(clip));
  expect(screen.getByRole('button').props.accessibilityLabel).not.toMatch(/galeria|compartilhado/);
});

test('a saved clip says it is in the gallery, and saving wins when it was also shared', async () => {
  const { rerender } = await render(card({ ...clip, sharedAt: 1 }));
  expect(screen.getByRole('button').props.accessibilityLabel).toMatch(/, compartilhado$/);
  await rerender(card({ ...clip, sharedAt: 1, savedAt: 2 }));
  expect(screen.getByRole('button').props.accessibilityLabel).toMatch(/, salvo na galeria$/);
});

test('the card is never labeled or tagged as blocked', async () => {
  await render(card(clip));
  expect(screen.getByRole('button', { name: /^Clipe 1/ }).props.accessibilityLabel).not.toMatch(/, bloqueado$/);
  expect(screen.queryByText('BLOQUEADO')).toBeNull();
});

test('a clip still arriving says where it is', async () => {
  const { rerender } = await render(<PendingClipTile number={4} width={120} downloading />);
  expect(screen.getByText('Baixando')).toBeTruthy();
  await rerender(<PendingClipTile number={5} width={120} downloading={false} />);
  expect(screen.getByText('Na fila')).toBeTruthy();
  expect(screen.getByLabelText('Clipe 5, ainda chegando')).toBeTruthy();
});
