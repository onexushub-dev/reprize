import Constants from 'expo-constants';
import { Platform } from 'react-native';
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
  it('reads the directory from the default offering metadata', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({
      current: null,
      all: { default: { metadata: { partners: { PROFJOAO: { name: 'Prof. João' } } } } },
    });
    expect(await c.partners()).toEqual({ PROFJOAO: { name: 'Prof. João' } });
  });

  it('reads the current offering when there is no "default" identifier', async () => {
    setKeys({ test: 'test_x' });
    const c = createRevenueCatClient();
    c.configure();
    (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({
      current: { metadata: { partners: { ABC: { name: 'Abc' } } } },
      all: {},
    });
    expect(await c.partners()).toEqual({ ABC: { name: 'Abc' } });
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

