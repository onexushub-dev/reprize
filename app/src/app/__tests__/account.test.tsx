import { fireEvent, render, screen } from '@testing-library/react-native';

import SettingsScreen from '../account';

// Ajustes: the referral code entry lives in the plan section, for customers without PRO (partner codes, 2026-11-24).
jest.mock('../../account/flags', () => ({ SHARING_ENABLED: false }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('../../account/account', () => ({
  useAccount: () => ({ ready: true, account: null }),
  signOut: jest.fn(),
  deleteAccount: jest.fn(),
}));
jest.mock('../../account/SignInButtons', () => ({ SignInButtons: () => null }));
jest.mock('../../cloud/shareStatus', () => ({ useShareStatus: () => ({}) }));
jest.mock('../../payments/feedback', () => ({ openPaywall: jest.fn() }));
jest.mock('../../share/entitlement', () => ({ useProActive: jest.fn(() => false) }));

const { router } = jest.requireMock('expo-router');
const { useProActive } = jest.requireMock('../../share/entitlement');

beforeEach(() => jest.clearAllMocks());

it('without PRO, the plan section opens the referral code screen', async () => {
  await render(<SettingsScreen />);
  await fireEvent.press(screen.getByText('Tenho um código de indicação'));
  expect(router.push).toHaveBeenCalledWith('/partner');
});

it('with PRO, there is no referral code entry', async () => {
  useProActive.mockReturnValue(true);
  await render(<SettingsScreen />);
  expect(screen.queryByText('Tenho um código de indicação')).toBeNull();
});
