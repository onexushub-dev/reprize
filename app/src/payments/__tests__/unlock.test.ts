import { Alert } from 'react-native';

import { track } from '../../analytics';
import { translate } from '../../i18n';
import { unlockRecording } from '../unlock';
import { repo } from '../../data/mmkv';
import { payments } from '..';

jest.mock('../../analytics', () => ({ track: jest.fn() }));
const mockFocus = jest.fn(() => true);
jest.mock('../../../modules/replay-camera', () => ({ isFocusSupported: () => mockFocus() }));
jest.mock('..', () => ({ payments: { showPaywall: jest.fn(), unlockOption: jest.fn() } }));
jest.mock('../../data/mmkv', () => ({ repo: { upgradeSession: jest.fn(() => ({ id: 's1', paid: true })) } }));

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('pt-BR', key, params);
const showPaywall = payments.showPaywall as jest.Mock;
const unlockOption = payments.unlockOption as jest.Mock;
const upgradeSession = repo.upgradeSession as jest.Mock;
const alert = jest.spyOn(Alert, 'alert');

/** Presses the named button of the question the app just asked. */
function answer(label: string) {
  const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === label)!.onPress!();
}

beforeEach(() => {
  jest.clearAllMocks();
  alert.mockImplementation(() => {});
});

test('Pro unlocks the recording at once, spending nothing and asking nothing', async () => {
  unlockOption.mockReturnValue({ kind: 'pro' });
  await expect(unlockRecording('s1', t)).resolves.toBe(true);
  expect(upgradeSession).toHaveBeenCalledWith('s1', {});
  expect(showPaywall).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

test('a waiting Pass is spent on this recording only after the player agrees', async () => {
  unlockOption.mockReturnValue({ kind: 'credit', passTransactionId: 'tx-1' });
  const done = unlockRecording('s1', t);
  expect(upgradeSession).not.toHaveBeenCalled();
  answer(t('unlock.use'));
  await expect(done).resolves.toBe(true);
  expect(upgradeSession).toHaveBeenCalledWith('s1', { passTransactionId: 'tx-1' });
  expect(track).toHaveBeenCalledWith('pass_used');
});

test('the question names Modo Foco only where the phone has it', () => {
  unlockOption.mockReturnValue({ kind: 'credit', passTransactionId: 'tx-1' });
  void unlockRecording('s1', t);
  expect(alert.mock.calls[0][1]).toContain('Modo Foco');
  mockFocus.mockReturnValueOnce(false);
  void unlockRecording('s1', t);
  expect(alert.mock.calls[1][1]).toBe(t('unlock.messageNoFocus'));
  expect(alert.mock.calls[1][1]).not.toContain('Foco');
});

test('"Agora não" leaves the Pass and the recording as they were', async () => {
  unlockOption.mockReturnValue({ kind: 'credit', passTransactionId: 'tx-1' });
  const done = unlockRecording('s1', t);
  answer(t('unlock.keep'));
  await expect(done).resolves.toBe(false);
  expect(upgradeSession).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalledWith('pass_used');
});

test('with nothing to spend the Single Pass paywall opens, and a cancel changes nothing', async () => {
  unlockOption.mockReturnValue({ kind: 'none' });
  showPaywall.mockResolvedValue('cancelled');
  await expect(unlockRecording('s1', t)).resolves.toBe(false);
  expect(showPaywall).toHaveBeenCalledTimes(1);
  expect(showPaywall).toHaveBeenCalledWith('pass');
  expect(upgradeSession).not.toHaveBeenCalled();
});

test('a Pass bought in the paywall goes to this recording without asking again', async () => {
  unlockOption.mockReturnValueOnce({ kind: 'none' }).mockReturnValue({ kind: 'credit', passTransactionId: 'tx-2' });
  showPaywall.mockResolvedValue('purchased');
  await expect(unlockRecording('s1', t)).resolves.toBe(true);
  expect(upgradeSession).toHaveBeenCalledWith('s1', { passTransactionId: 'tx-2' });
  expect(alert).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalledWith('pass_used'); // bought here: that is purchase_completed
});

test('a restore in the paywall never spends a Pass it did not buy: an old one still asks first', async () => {
  unlockOption.mockReturnValueOnce({ kind: 'none' }).mockReturnValue({ kind: 'credit', passTransactionId: 'tx-3' });
  showPaywall.mockResolvedValue('restored');
  const done = unlockRecording('s1', t);
  await new Promise((r) => setTimeout(r, 0));
  answer(t('unlock.keep'));
  await expect(done).resolves.toBe(false);
  expect(upgradeSession).not.toHaveBeenCalled();
});

test('a subscription bought in the paywall unlocks the recording without asking', async () => {
  unlockOption.mockReturnValueOnce({ kind: 'none' }).mockReturnValue({ kind: 'pro' });
  showPaywall.mockResolvedValue('purchased');
  await expect(unlockRecording('s1', t)).resolves.toBe(true);
  expect(upgradeSession).toHaveBeenCalledWith('s1', {});
  expect(alert).not.toHaveBeenCalled();
});
