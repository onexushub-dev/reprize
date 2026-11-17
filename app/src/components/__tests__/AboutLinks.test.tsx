import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { setLocale } from '../../i18n';
import { AboutLinks } from '../AboutLinks';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

test('links the legal pages of the current language', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  setLocale('pt-BR');
  await render(<AboutLinks />);
  await fireEvent.press(screen.getByText('Termos de Uso'));
  await fireEvent.press(screen.getByText('Privacidade'));
  expect(open).toHaveBeenCalledWith('https://www.reprizeapp.com/terms');
  expect(open).toHaveBeenCalledWith('https://www.reprizeapp.com/privacy');

  setLocale('en');
  await render(<AboutLinks />);
  await fireEvent.press(screen.getByText('Privacy'));
  expect(open).toHaveBeenCalledWith('https://www.reprizeapp.com/en/privacy');
  open.mockRestore();
});

test('offers the referral code entry above the legal links', async () => {
  setLocale('pt-BR');
  await render(<AboutLinks />);
  await fireEvent.press(screen.getByText('Tenho um código de indicação'));
  expect(mockPush).toHaveBeenCalledWith('/partner');
});

