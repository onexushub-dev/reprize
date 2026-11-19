import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import { useCourtesyGate } from '../useCourtesyGate';

jest.mock('../CourtesySheet', () => {
  const sheet: { last?: { visible: boolean; shareId: string | null; onChoose: (c: string) => void; onDismissed: () => void } } = {};
  return { __sheet: sheet, CourtesySheet: (p: never) => ((sheet.last = p), null) };
});
jest.mock('../../payments/feedback', () => ({ openPaywall: jest.fn(async () => 'cancelled') }));
jest.mock('../../data/mmkv', () => ({ repo: { getSession: jest.fn(), setReceivedCourtesy: jest.fn() } }));

const { __sheet: sheet } = jest.requireMock('../CourtesySheet');
const { openPaywall } = jest.requireMock('../../payments/feedback');
const { repo } = jest.requireMock('../../data/mmkv');

const received = { shareId: 'sh1', code: 'c', receivedAt: 1, expiresAt: 2, total: 3 };
let gate: ReturnType<typeof useCourtesyGate>;

function Host() {
  const g = useCourtesyGate();
  useEffect(() => {
    gate = g;
  });
  return <>{g.sheet}</>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test('a recording with a courtesy already spent, or one made here, goes on without the sheet', async () => {
  await render(<Host />);
  repo.getSession.mockReturnValueOnce({ id: 's1', received: { ...received, courtesy: true } });
  await expect(gate.ask('s1')).resolves.toBe(true);
  repo.getSession.mockReturnValueOnce({ id: 's2' });
  await expect(gate.ask('s2')).resolves.toBe(true);
  expect(sheet.last.visible).toBe(false);
});

test('a courtesy spent in the sheet is kept on the recording and the export goes on', async () => {
  await render(<Host />);
  repo.getSession.mockReturnValue({ id: 's1', received });
  let answer: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    answer = gate.ask('s1');
  });
  expect(sheet.last.visible).toBe(true);
  expect(sheet.last.shareId).toBe('sh1');
  await act(async () => sheet.last.onChoose('go'));
  await expect(answer).resolves.toBe(true);
  expect(repo.setReceivedCourtesy).toHaveBeenCalledWith('s1');
  expect(sheet.last.visible).toBe(false);
});

test('Assinar o PRO stops the export and opens the paywall once the sheet has closed', async () => {
  await render(<Host />);
  repo.getSession.mockReturnValue({ id: 's1', received });
  let answer: Promise<boolean> = Promise.resolve(true);
  await act(async () => {
    answer = gate.ask('s1');
  });
  await act(async () => sheet.last.onChoose('pro'));
  await expect(answer).resolves.toBe(false);
  expect(repo.setReceivedCourtesy).not.toHaveBeenCalled();
  await act(async () => sheet.last.onDismissed());
  expect(openPaywall).toHaveBeenCalledWith(expect.any(Function), 'received_export');
  await act(async () => sheet.last.onDismissed());
  expect(openPaywall).toHaveBeenCalledTimes(1);
});

test('Cancelar stops the export and spends nothing', async () => {
  await render(<Host />);
  repo.getSession.mockReturnValue({ id: 's1', received });
  let answer: Promise<boolean> = Promise.resolve(true);
  await act(async () => {
    answer = gate.ask('s1');
  });
  await act(async () => sheet.last.onChoose('cancel'));
  await expect(answer).resolves.toBe(false);
  expect(repo.setReceivedCourtesy).not.toHaveBeenCalled();
  expect(openPaywall).not.toHaveBeenCalled();
});
