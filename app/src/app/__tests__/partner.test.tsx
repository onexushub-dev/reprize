import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { setLocale } from '../../i18n';
import { applyPartnerCode, partner, redeemPartnerOffer } from '../../partner';
import { openPaywall } from '../../payments/feedback';
import PartnerCode from '../p/[code]';
import PartnerTyped from '../partner';

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { code?: string } = {};

jest.mock('expo-router', () => ({
  router: {
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    push: (...a: unknown[]) => mockRouter.push(...a),
    back: (...a: unknown[]) => mockRouter.back(...a),
    canGoBack: () => mockRouter.canGoBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('../../partner', () => ({
  applyPartnerCode: jest.fn(),
  redeemPartnerOffer: jest.fn(async () => {}),
  partner: { current: jest.fn(() => ({ code: 'PROFJOAO', name: 'Prof. João' })) },
}));
jest.mock('../../payments/feedback', () => ({ openPaywall: jest.fn(async () => 'cancelled') }));

const apply = applyPartnerCode as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  setLocale('en');
  Platform.OS = 'ios';
  mockParams = {};
  (partner.current as jest.Mock).mockReturnValue({ code: 'PROFJOAO', name: 'Prof. João' });
});

describe('/p/[code]', () => {
  it('applies the code from the link with source "link" and shows the applied state', async () => {
    mockParams = { code: 'profjoao' };
    apply.mockResolvedValue('applied');
    await render(<PartnerCode />);
    expect(apply).toHaveBeenCalledWith('profjoao', 'link');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('You have a discount on annual PRO, referred by Prof. João.')).toBeTruthy();
  });

  it('"Get the discount" opens Apple\'s redemption on iOS', async () => {
    mockParams = { code: 'PROFJOAO' };
    apply.mockResolvedValue('applied');
    await render(<PartnerCode />);
    await fireEvent.press(await screen.findByText('Get the discount'));
    expect(redeemPartnerOffer).toHaveBeenCalledTimes(1);
    expect(openPaywall).not.toHaveBeenCalled();
  });

  it('"Get the discount" opens the partner paywall on Android', async () => {
    Platform.OS = 'android';
    mockParams = { code: 'PROFJOAO' };
    apply.mockResolvedValue('applied');
    await render(<PartnerCode />);
    await fireEvent.press(await screen.findByText('Get the discount'));
    expect(openPaywall).toHaveBeenCalledWith(expect.any(Function), 'partner');
    expect(redeemPartnerOffer).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 'Code not found. Check it with the person who referred you.'],
    ['pending', "No connection right now. We'll confirm the code as soon as you're back online."],
    ['locked', 'This code is not valid for people who already have PRO or already used another code.'],
  ])('says so when the result is %s, with no discount button', async (result, text) => {
    mockParams = { code: 'PROFJOAO' };
    apply.mockResolvedValue(result);
    await render(<PartnerCode />);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText('Get the discount')).toBeNull();
  });

  it('applies again when the link changes while the screen stays mounted', async () => {
    mockParams = { code: 'AAA111' };
    apply.mockResolvedValue('applied');
    const view = await render(<PartnerCode />);
    mockParams = { code: 'BBB222' };
    await view.rerender(<PartnerCode />);
    expect(apply).toHaveBeenCalledWith('AAA111', 'link');
    expect(apply).toHaveBeenCalledWith('BBB222', 'link');
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('can be closed while the code is still being checked', async () => {
    mockParams = { code: 'PROFJOAO' };
    apply.mockReturnValue(new Promise(() => {}));
    await render(<PartnerCode />);
    await fireEvent.press(screen.getByText('Close'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('a code waiting for a connection is not shown as an error', async () => {
    mockParams = { code: 'PROFJOAO' };
    apply.mockResolvedValue('pending');
    await render(<PartnerCode />);
    await screen.findByText("No connection right now. We'll confirm the code as soon as you're back online.");
    expect(screen.queryByTestId('partner-badge')).toBeNull();
  });

  it('a code that is not found keeps the error badge', async () => {
    mockParams = { code: 'NOPE' };
    apply.mockResolvedValue('invalid');
    await render(<PartnerCode />);
    await screen.findByText('Code not found. Check it with the person who referred you.');
    expect(screen.getByTestId('partner-badge')).toBeTruthy();
  });

  it('closing goes to the start with replace, never back into the link', async () => {
    mockParams = { code: 'PROFJOAO' };
    apply.mockResolvedValue('applied');
    await render(<PartnerCode />);
    await fireEvent.press(await screen.findByText('Not now'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('/partner', () => {
  it('applies the typed code with source "typed"', async () => {
    apply.mockResolvedValue('applied');
    await render(<PartnerTyped />);
    await fireEvent.changeText(screen.getByPlaceholderText('Enter the code'), 'profjoao');
    await fireEvent.press(screen.getByText('Apply code'));
    expect(apply).toHaveBeenCalledWith('profjoao', 'typed');
    expect(await screen.findByText('Code applied')).toBeTruthy();
  });

  it('does not apply an empty field', async () => {
    await render(<PartnerTyped />);
    await fireEvent.press(screen.getByText('Apply code'));
    expect(apply).not.toHaveBeenCalled();
  });

  it('keeps the field and says so when the code is not found', async () => {
    apply.mockResolvedValue('invalid');
    await render(<PartnerTyped />);
    await fireEvent.changeText(screen.getByPlaceholderText('Enter the code'), 'nope');
    await fireEvent.press(screen.getByText('Apply code'));
    expect(await screen.findByText('Code not found. Check it with the person who referred you.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter the code')).toBeTruthy();
  });

  it('closing goes back, or to the start when there is nothing behind', async () => {
    await render(<PartnerTyped />);
    await fireEvent.press(screen.getByText('Close'));
    expect(mockRouter.back).toHaveBeenCalled();
    mockRouter.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByText('Close'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });
});
