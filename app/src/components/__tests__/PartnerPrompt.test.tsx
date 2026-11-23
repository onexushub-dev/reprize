import { fireEvent, render, screen } from '@testing-library/react-native';

import { kv } from '../../data/mmkv';
import { setLocale } from '../../i18n';
import { partner } from '../../partner';
import { payments } from '../../payments';
import { PartnerPrompt } from '../PartnerPrompt';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('../../data/mmkv', () => ({ kv: { getString: jest.fn(), set: jest.fn(), delete: jest.fn() } }));
jest.mock('../../partner', () => ({ partner: { current: jest.fn(() => null), subscribe: jest.fn(() => () => {}) } }));
jest.mock('../../payments', () => ({
  payments: { getSnapshot: jest.fn(() => ({ proActive: false, passTransactions: [] })), subscribe: jest.fn(() => () => {}) },
}));

const TEXT = 'Received a referral code?';

beforeEach(() => {
  jest.clearAllMocks();
  setLocale('en');
  (kv.getString as jest.Mock).mockReturnValue(undefined);
  (partner.current as jest.Mock).mockReturnValue(null);
  (payments.getSnapshot as jest.Mock).mockReturnValue({ proActive: false, passTransactions: [] });
});

test('shows with no attribution, no PRO and not dismissed', async () => {
  await render(<PartnerPrompt />);
  expect(screen.getByText(TEXT)).toBeTruthy();
});

test('hidden with an attribution', async () => {
  (partner.current as jest.Mock).mockReturnValue({ code: 'PROFJOAO' });
  await render(<PartnerPrompt />);
  expect(screen.queryByText(TEXT)).toBeNull();
});

test('hidden with PRO', async () => {
  (payments.getSnapshot as jest.Mock).mockReturnValue({ proActive: true, passTransactions: [] });
  await render(<PartnerPrompt />);
  expect(screen.queryByText(TEXT)).toBeNull();
});

test('hidden once dismissed in an earlier session', async () => {
  (kv.getString as jest.Mock).mockReturnValue('true');
  await render(<PartnerPrompt />);
  expect(kv.getString).toHaveBeenCalledWith('partner.promptDismissed');
  expect(screen.queryByText(TEXT)).toBeNull();
});

test('dismiss stores partner.promptDismissed and hides it', async () => {
  await render(<PartnerPrompt />);
  await fireEvent.press(screen.getByLabelText('Dismiss'));
  expect(kv.set).toHaveBeenCalledWith('partner.promptDismissed', 'true');
  expect(screen.queryByText(TEXT)).toBeNull();
});

test('a storage failure never throws: it shows, and dismiss still hides it for this run', async () => {
  (kv.getString as jest.Mock).mockImplementation(() => {
    throw new Error('storage');
  });
  (kv.set as jest.Mock).mockImplementationOnce(() => {
    throw new Error('storage');
  });
  await render(<PartnerPrompt />);
  await fireEvent.press(screen.getByLabelText('Dismiss'));
  expect(screen.queryByText(TEXT)).toBeNull();
  (kv.getString as jest.Mock).mockReturnValue(undefined);
});

test('tap opens /partner', async () => {
  await render(<PartnerPrompt />);
  await fireEvent.press(screen.getByText(TEXT));
  expect(mockPush).toHaveBeenCalledWith('/partner');
});
