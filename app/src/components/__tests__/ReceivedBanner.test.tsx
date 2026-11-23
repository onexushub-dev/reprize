import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ReceivedBanner, sizeLabel } from '../ReceivedBanner';

jest.mock('../../cloud/receive', () => ({
  useReceiveProgress: jest.fn(),
  startDownload: jest.fn(),
  receiveQueue: { setDownload: jest.fn(), cancel: jest.fn() },
}));

const { useReceiveProgress, startDownload, receiveQueue } = jest.requireMock('../../cloud/receive');

const received = { shareId: 'r1', code: 'c', from: 'Ana', receivedAt: 0, expiresAt: Date.now() + 5.5 * 3600 * 1000, total: 12, groupId: 'g1' };
const progress = (over: Record<string, unknown>) => ({
  done: 0,
  total: 12,
  downloading: false,
  paused: false,
  state: 'active',
  slots: [],
  running: [],
  download: 'on',
  bytes: 320_000_000,
  thumbs: {},
  ...over,
});

beforeEach(() => jest.clearAllMocks());

test('sizes read as people say them', () => {
  expect(sizeLabel(320_400_000, 'pt-BR')).toBe('320 MB');
  expect(sizeLabel(1_250_000_000, 'pt-BR')).toBe('1,3 GB');
  expect(sizeLabel(10, 'pt-BR')).toBe('1 MB');
});

test('not downloaded yet: its size on Baixar and how long the link lasts', async () => {
  useReceiveProgress.mockReturnValue(progress({ download: 'waiting' }));
  await render(<ReceivedBanner sessionId="s1" received={received} />);
  expect(screen.getByText('não baixada')).toBeTruthy();
  expect(screen.getByText('Baixe enquanto o link durar: vence em 5 horas.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Baixar gravação · 320 MB' }));
  expect(startDownload).toHaveBeenCalledWith('s1');
  expect(screen.queryByText('Pausar')).toBeNull();
});

test('downloading: Pausar and Cancelar; Cancelar asks before taking the clips off the phone', async () => {
  useReceiveProgress.mockReturnValue(progress({ done: 3, downloading: true }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<ReceivedBanner sessionId="s1" received={received} />);
  expect(screen.getByText('3 de 12')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Pausar' }));
  expect(receiveQueue.setDownload).toHaveBeenCalledWith('s1', 'paused');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(alert.mock.calls[0][0]).toBe('Cancelar o download?');
  expect(receiveQueue.cancel).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === 'Cancelar download')!.onPress!());
  expect(receiveQueue.cancel).toHaveBeenCalledWith('s1');
  alert.mockRestore();
});

test('paused by the person: Continuar', async () => {
  useReceiveProgress.mockReturnValue(progress({ done: 3, download: 'paused' }));
  await render(<ReceivedBanner sessionId="s1" received={received} />);
  expect(screen.getByText('3 de 12 clipes no celular · download pausado')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
  expect(startDownload).toHaveBeenCalledWith('s1');
});

test('all here: no choice left', async () => {
  useReceiveProgress.mockReturnValue(progress({ done: 12 }));
  await render(<ReceivedBanner sessionId="s1" received={received} />);
  expect(screen.getByText('no seu celular')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

test('an expired link offers no download', async () => {
  useReceiveProgress.mockReturnValue(progress({ download: 'waiting', state: 'expired' }));
  await render(<ReceivedBanner sessionId="s1" received={received} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('Este link venceu. Peça um novo a quem gravou.')).toBeTruthy();
});

test('the link over and nothing of it on the phone: the card offers to delete the empty recording (2026-11-22)', async () => {
  const onDelete = jest.fn();
  useReceiveProgress.mockReturnValue(progress({ download: 'waiting', state: 'off' }));
  await render(<ReceivedBanner sessionId="s1" received={received} onDelete={onDelete} />);
  expect(screen.getByText('Quem compartilhou desligou este link.')).toBeTruthy();
  expect(screen.getByText('Nenhum clipe desta gravação foi baixado, e sem um link novo não há mais o que baixar.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Baixar/ })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Apagar gravação' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

test('the link over with some clips here: they stay useful, no delete offered on the card', async () => {
  useReceiveProgress.mockReturnValue(progress({ done: 4, state: 'expired' }));
  await render(<ReceivedBanner sessionId="s1" received={received} onDelete={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Apagar gravação' })).toBeNull();
});
