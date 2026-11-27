import { render, screen, within } from '@testing-library/react-native';

import { SignInButtons } from '../SignInButtons';

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { WHITE: 0 },
}));
jest.mock('../account', () => ({ signInWithApple: jest.fn(), signInWithGoogle: jest.fn() }));

test('the Google button shows the Google "G" logo beside its label', async () => {
  await render(<SignInButtons />);
  const button = screen.getByRole('button', { name: 'Continuar com Google' });
  // The logo is decorative (hidden from screen readers, which read the label).
  expect(within(button).getByTestId('google-logo', { includeHiddenElements: true })).toBeTruthy();
});
