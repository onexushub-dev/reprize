import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';

import { createRevenueCatClient, outcomeFor, pickApiKey } from '../revenuecatClient';
import { EMPTY_SNAPSHOT } from '../types';

const info = {
  entitlements: { active: { pro: {} } },
  nonSubscriptionTransactions: [
    { transactionIdentifier: 't1', productIdentifier: 'single_pass', purchaseDate: '1970-01-01T00:00:02.000Z' },
  ],
};

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));

function setKeys(revenueCat: unknown) {
  (Constants as unknown as { expoConfig: unknown }).expoConfig = { extra: { revenueCat } };
}

beforeEach(() => {
  jest.clearAllMocks();
  (Purchases.getCustomerInfo as jest.Mock).mockResolvedValue(info);
  (Purchases.restorePurchases as jest.Mock).mockResolvedValue(info);
});

describe('pickApiKey', () => {
  const keys = { ios: 'appl_x', android: 'goog_x', test: 'test_x' };
  it('prefers the test key in development', () => {
    expect(pickApiKey(keys, 'ios', true)).toBe('test_x');
    expect(pickApiKey({ ios: 'appl_x' }, 'ios', true)).toBe('appl_x');
  });
  it('never uses the test key in a release build', () => {
    expect(pickApiKey(keys, 'ios', false)).toBe('appl_x');
    expect(pickApiKey(keys, 'android', false)).toBe('goog_x');
    expect(pickApiKey({ test: 'test_x' }, 'ios', false)).toBeUndefined();
  });
  it('returns undefined for empty values and other platforms', () => {
    expect(pickApiKey({ ios: '' }, 'ios', false)).toBeUndefined();
    expect(pickApiKey(keys, 'web', false)).toBeUndefined();
  });
});

describe('outcomeFor', () => {
  it('maps paywall results', () => {
    const R = RevenueCatUI.PAYWALL_RESULT;
    expect(outcomeFor(R.PURCHASED)).toBe('purchased');
    expect(outcomeFor(R.RESTORED)).toBe('restored');
    expect(outcomeFor(R.CANCELLED)).toBe('cancelled');
    expect(outcomeFor(R.ERROR)).toBe('error');
    expect(outcomeFor(R.NOT_PRESENTED)).toBe('error');
  });
});

describe('createRevenueCatClient', () => {
  it('without a key does not configure and stays free', async () => {
    setKeys({});
    const c = createRevenueCatClient();
    c.configure();
    expect(Purchases.configure).not.toHaveBeenCalled();
    expect(await c.getSnapshot()).toEqual(EMPTY_SNAPSHOT);
    expect(await c.restore()).toEqual(EMPTY_SNAPSHOT);
    expect(await c.showPaywall('default')).toBe('error');
    c.onSnapshot(() => {})();
    expect(Purchases.addCustomerInfoUpdateListener).not.toHaveBeenCalled();
  });

  it('a throwing configure does not crash launch and the client stays free', async () => {
    Platform.OS = 'ios';
    setKeys({ test: 'test_x' });
    (Purchases.configure as jest.Mock).mockImplementationOnce(() => {
      throw new Error('native boom');
    });
    const c = createRevenueCatClient();
    expect(() => c.configure()).not.toThrow();
    expect(await c.getSnapshot()).toEqual(EMPTY_SNAPSHOT);
    expect(await c.showPaywall('default')).toBe('error');
    expect(Purchases.getCustomerInfo).not.toHaveBeenCalled();
  });

  it('configures once with the dev test key and converts customer info', async () => {
    Platform.OS = 'ios';
    setKeys({ ios: 'appl_x', test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    c.configure();
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.configure).toHaveBeenCalledWith({ apiKey: 'test_x' });
    expect(await c.getSnapshot()).toEqual({
      proActive: true,
      passTransactions: [{ id: 't1', productId: 'single_pass', purchasedAt: 2000 }],
    });
  });

  it('shows the paywall with a close button and maps the result', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (RevenueCatUI.presentPaywall as jest.Mock).mockResolvedValueOnce('PURCHASED');
    expect(await c.showPaywall('default')).toBe('purchased');
    expect(RevenueCatUI.presentPaywall).toHaveBeenCalledWith({ displayCloseButton: true });
    (RevenueCatUI.presentPaywall as jest.Mock).mockRejectedValueOnce(new Error('x'));
    expect(await c.showPaywall('default')).toBe('error');
  });

  it('the default offering is the current one: it never loads offerings', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (RevenueCatUI.presentPaywall as jest.Mock).mockResolvedValueOnce('CANCELLED');
    expect(await c.showPaywall('default')).toBe('cancelled');
    expect(Purchases.getOfferings).not.toHaveBeenCalled();
    expect(RevenueCatUI.presentPaywall).toHaveBeenCalledWith({ displayCloseButton: true });
  });

  it('the pass offering is looked up by its identifier and shown', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    const pass = { identifier: 'pass' };
    (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({ current: null, all: { pass } });
    (RevenueCatUI.presentPaywall as jest.Mock).mockResolvedValueOnce('PURCHASED');
    expect(await c.showPaywall('pass')).toBe('purchased');
    expect(RevenueCatUI.presentPaywall).toHaveBeenCalledWith({ displayCloseButton: true, offering: pass });
  });

  it('a missing pass offering falls back to the current one', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({ current: null, all: {} });
    (RevenueCatUI.presentPaywall as jest.Mock).mockResolvedValueOnce('CANCELLED');
    expect(await c.showPaywall('pass')).toBe('cancelled');
    expect(RevenueCatUI.presentPaywall).toHaveBeenCalledWith({ displayCloseButton: true });
  });

  it('removes the exact listener it added', () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    const fn = jest.fn();
    const off = c.onSnapshot(fn);
    const listener = (Purchases.addCustomerInfoUpdateListener as jest.Mock).mock.calls[0][0];
    listener(info);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ proActive: true }));
    off();
    expect(Purchases.removeCustomerInfoUpdateListener).toHaveBeenCalledWith(listener);
  });
});

describe('partners', () => {
  it('reads the directory from the price tier offerings', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({
      current: null,
      all: {
        default: { metadata: {} },
        partner_p20: { metadata: { discountPercent: 20, partners: { PROFJOAO: { name: 'Prof. João' } } } },
      },
    });
    expect(await c.partners()).toEqual({ PROFJOAO: { name: 'Prof. João', offering: 'partner_p20', discountPercent: 20 } });
  });

  it('is null when the offerings fail or the SDK is not configured', async () => {
    setKeys({});
    const off = createRevenueCatClient();
    off.configure();
    expect(await off.partners()).toBeNull();

    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (Purchases.getOfferings as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    expect(await c.partners()).toBeNull();
  });
});

describe('partner attribution and offer codes', () => {
  const REDEEM = 'https://apps.apple.com/redeem?ctx=offercodes&id=6833159162&code=PROFJOAO';

  it('writes the partner attributes', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    await c.setPartner('PROFJOAO', 'link', 'partner_p20');
    expect(Purchases.setAttributes).toHaveBeenCalledWith({ partner_code: 'PROFJOAO', partner_source: 'link', partner_offering: 'partner_p20' });
    expect(Purchases.setMediaSource).toHaveBeenCalledWith('partner');
    expect(Purchases.setCampaign).toHaveBeenCalledWith('PROFJOAO');
  });

  it('setPartner never throws: SDK failure or no key', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (Purchases.setAttributes as jest.Mock).mockRejectedValueOnce(new Error('sdk'));
    await expect(c.setPartner('PROFJOAO', 'link', 'partner_p20')).resolves.toBeUndefined();

    jest.clearAllMocks();
    setKeys({});
    const off = createRevenueCatClient();
    off.configure();
    await expect(off.setPartner('PROFJOAO', 'link', 'partner_p20')).resolves.toBeUndefined();
    expect(Purchases.setAttributes).not.toHaveBeenCalled();
  });

  it('two quick partner writes never interleave: the last code wins in every attribute', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (Purchases.setAttributes as jest.Mock).mockImplementationOnce(() => new Promise((r) => setTimeout(r, 20)));
    await Promise.all([c.setPartner('AAA', 'link', 'partner_p10'), c.setPartner('BBB', 'typed', 'partner_p20')]);
    expect((Purchases.setAttributes as jest.Mock).mock.calls.map((a) => a[0].partner_code)).toEqual(['AAA', 'BBB']);
    expect((Purchases.setCampaign as jest.Mock).mock.calls.map((a) => a[0])).toEqual(['AAA', 'BBB']);
    expect((Purchases.setMediaSource as jest.Mock).mock.calls).toHaveLength(2);
    // and the order inside: AAA's three writes all precede BBB's first
    const order = [
      ...(Purchases.setAttributes as jest.Mock).mock.invocationCallOrder,
      ...(Purchases.setCampaign as jest.Mock).mock.invocationCallOrder,
    ];
    expect(Math.max(...order.slice(0, 1), ...order.slice(2, 3))).toBeLessThan(Math.min(order[1], order[3]));
  });

  it('opens the redemption URL with the code on iOS', async () => {
    Platform.OS = 'ios';
    setKeys({ test: 'test_x' });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const c = createRevenueCatClient();
    c.configure();
    expect(await c.redeemOfferCode('PROFJOAO')).toBe(true);
    expect(open).toHaveBeenCalledWith(REDEEM);
    expect(Purchases.presentCodeRedemptionSheet).not.toHaveBeenCalled();
  });

  it('falls back to the StoreKit sheet when the URL cannot be opened', async () => {
    Platform.OS = 'ios';
    setKeys({ test: 'test_x' });
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('cannot open'));
    const c = createRevenueCatClient();
    c.configure();
    expect(await c.redeemOfferCode('PROFJOAO')).toBe(true);
    expect(Purchases.presentCodeRedemptionSheet).toHaveBeenCalledTimes(1);
  });

  it('is false when neither way works', async () => {
    Platform.OS = 'ios';
    setKeys({ test: 'test_x' });
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('cannot open'));
    (Purchases.presentCodeRedemptionSheet as jest.Mock).mockRejectedValueOnce(new Error('no sheet'));
    const c = createRevenueCatClient();
    c.configure();
    expect(await c.redeemOfferCode('PROFJOAO')).toBe(false);
  });

  it('does not redeem on Android', async () => {
    Platform.OS = 'android';
    setKeys({ test: 'test_x' });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const c = createRevenueCatClient();
    c.configure();
    expect(await c.redeemOfferCode('PROFJOAO')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    Platform.OS = 'ios';
  });

  it('shows the partner offering by its identifier, falling back to the current one', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    const partner = { identifier: 'partner' };
    (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({ current: null, all: { partner } });
    (RevenueCatUI.presentPaywall as jest.Mock).mockResolvedValueOnce('PURCHASED');
    expect(await c.showPaywall('partner')).toBe('purchased');
    expect(RevenueCatUI.presentPaywall).toHaveBeenCalledWith({ displayCloseButton: true, offering: partner });

    (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({ current: null, all: {} });
    (RevenueCatUI.presentPaywall as jest.Mock).mockResolvedValueOnce('CANCELLED');
    expect(await c.showPaywall('partner')).toBe('cancelled');
    expect(RevenueCatUI.presentPaywall).toHaveBeenLastCalledWith({ displayCloseButton: true });
  });
});

