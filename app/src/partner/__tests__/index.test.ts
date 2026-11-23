import { Alert, AppState, Platform } from 'react-native';

import { translate } from '../../i18n';

const mockData = new Map<string, string>();
const mockTrack = jest.fn();
let mockSubscriber: (() => void) | undefined;
const mockPayments = {
  getSnapshot: jest.fn(),
  refresh: jest.fn(),
  subscribe: jest.fn((fn: () => void) => {
    mockSubscriber = fn;
    return () => {};
  }),
};
const mockClient = { partners: jest.fn(), setPartner: jest.fn(), redeemOfferCode: jest.fn() };
const mockReferrer = jest.fn();

jest.mock('../../data/mmkv', () => ({
  kv: {
    getString: (k: string) => mockData.get(k),
    set: (k: string, v: string) => void mockData.set(k, v),
    delete: (k: string) => void mockData.delete(k),
  },
}));
jest.mock('../../analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));
jest.mock('../../payments', () => ({ payments: mockPayments, paymentsClient: mockClient }));
jest.mock('expo-application', () => ({ getInstallReferrerAsync: () => mockReferrer() }));

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params);
const DIR = { PROFJOAO: { name: 'Prof. João', offering: 'partner_p20' as const, discountPercent: 20 }, MARIA10: { name: 'Maria' } };

function load(): typeof import('../index') {
  let mod!: typeof import('../index');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../index');
  });
  return mod;
}

let appStateHandler: ((s: string) => void) | undefined;
const removeSub = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockData.clear();
  Platform.OS = 'ios';
  mockPayments.getSnapshot.mockReturnValue({ proActive: false, passTransactions: [] });
  mockPayments.refresh.mockResolvedValue({ proActive: false, passTransactions: [] });
  mockClient.partners.mockResolvedValue(DIR);
  mockClient.setPartner.mockResolvedValue(undefined);
  mockClient.redeemOfferCode.mockResolvedValue(true);
  mockReferrer.mockResolvedValue('utm_source=google-play&utm_medium=organic');
  appStateHandler = undefined;
  mockSubscriber = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
    appStateHandler = fn;
    return { remove: removeSub };
  }) as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

const sent = () => mockTrack.mock.calls;

describe('applyPartnerCode', () => {
  it('applies a valid code, writes the attributes and reports it', async () => {
    const { applyPartnerCode, partner } = load();
    expect(await applyPartnerCode('profjoao', 'typed')).toBe('applied');
    expect(partner.active()?.code).toBe('PROFJOAO');
    expect(mockClient.setPartner).toHaveBeenCalledWith('PROFJOAO', 'typed', 'partner_p20');
    expect(sent()).toEqual([['partner_code_applied', { code: 'PROFJOAO', source: 'typed' }]]);
  });

  it('reports a rejection without what was typed', async () => {
    const { applyPartnerCode } = load();
    expect(await applyPartnerCode('NOPE123', 'typed')).toBe('invalid');
    expect(sent()).toEqual([['partner_code_rejected', { source: 'typed', reason: 'invalid' }]]);
  });

  it('does not apply a code for a customer who already has PRO, even before the first snapshot has loaded', async () => {
    // cold start: the store still answers with the empty snapshot, a fresh read says PRO
    mockPayments.refresh.mockResolvedValue({ proActive: true, passTransactions: [] });
    const { applyPartnerCode, partner } = load();
    expect(await applyPartnerCode('PROFJOAO', 'typed')).toBe('locked');
    expect(partner.current()).toBeNull();
    expect(sent()).toEqual([['partner_code_rejected', { source: 'typed', reason: 'locked' }]]);
  });

  it('reports nothing for a code that is only pending (offline)', async () => {
    mockClient.partners.mockResolvedValue(null);
    const { applyPartnerCode } = load();
    expect(await applyPartnerCode('PROFJOAO', 'typed')).toBe('pending');
    expect(sent()).toEqual([]);
  });
});

describe('partner_code_applied is sent once per code', () => {
  it('a pending code confirmed by the start and by the link at the same time is one event', async () => {
    mockClient.partners.mockResolvedValue(null);
    await load().applyPartnerCode('PROFJOAO', 'link'); // an earlier launch, offline
    mockClient.partners.mockResolvedValue(DIR);
    mockTrack.mockClear();
    const again = load();
    await Promise.all([again.startPartner(), again.applyPartnerCode('PROFJOAO', 'link')]);
    expect(sent().filter(([name]) => name === 'partner_code_applied')).toHaveLength(1);
  });
});

describe('startPartner', () => {
  it('confirms a pending code once the directory loads and reports it then', async () => {
    mockClient.partners.mockResolvedValue(null);
    await load().applyPartnerCode('PROFJOAO', 'link');
    mockClient.partners.mockResolvedValue(DIR);
    const again = load();
    await again.startPartner();
    expect(again.partner.active()?.name).toBe('Prof. João');
    expect(sent()).toEqual([['partner_code_applied', { code: 'PROFJOAO', source: 'link' }]]);
  });

  it('reads the install referrer once on Android and applies the code', async () => {
    Platform.OS = 'android';
    mockReferrer.mockResolvedValue('partner=PROFJOAO&utm_source=wa');
    const first = load();
    await first.startPartner();
    expect(first.partner.active()).toMatchObject({ code: 'PROFJOAO', source: 'install_referrer' });
    await load().startPartner();
    expect(mockReferrer).toHaveBeenCalledTimes(1);
  });

  it('never reads the install referrer on iOS', async () => {
    await load().startPartner();
    expect(mockReferrer).not.toHaveBeenCalled();
  });

  it('swallows an install referrer failure and still marks it as read', async () => {
    Platform.OS = 'android';
    mockReferrer.mockRejectedValue(new Error('ERR_APPLICATION_INSTALL_REFERRER_UNAVAILABLE'));
    await expect(load().startPartner()).resolves.toBeUndefined();
    await load().startPartner();
    expect(mockReferrer).toHaveBeenCalledTimes(1);
  });
});

const PRO = { proActive: true, passTransactions: [] };
const FREE = { proActive: false, passTransactions: [] };
const settle = () => new Promise((r) => setImmediate(r));

describe('redeemPartnerOffer (iPhone)', () => {
  async function redeemed() {
    const mod = load();
    await mod.startPartner(); // registers the listeners
    await mod.applyPartnerCode('PROFJOAO', 'link');
    mockTrack.mockClear();
    await mod.redeemPartnerOffer(t);
    mockTrack.mockClear();
    return mod;
  }

  it('opens the redemption for the active code and reports it', async () => {
    const { applyPartnerCode, redeemPartnerOffer } = load();
    await applyPartnerCode('PROFJOAO', 'link');
    mockTrack.mockClear();
    await redeemPartnerOffer(t);
    expect(mockClient.redeemOfferCode).toHaveBeenCalledWith('PROFJOAO');
    expect(sent()).toEqual([['partner_offer_opened', { code: 'PROFJOAO', via: 'offer_code' }]]);
  });

  it('tells the player when the redemption cannot be opened, and arms nothing', async () => {
    mockClient.redeemOfferCode.mockResolvedValue(false);
    const mod = load();
    await mod.applyPartnerCode('PROFJOAO', 'link');
    await mod.redeemPartnerOffer(t);
    expect(Alert.alert).toHaveBeenCalledWith(t('partner.redeemError'));
    mockPayments.getSnapshot.mockReturnValue(PRO);
    mockTrack.mockClear();
    mockSubscriber?.();
    await settle();
    expect(sent()).toEqual([]);
  });

  it('does nothing for a customer who already has PRO', async () => {
    const mod = load();
    await mod.applyPartnerCode('PROFJOAO', 'link');
    mockPayments.getSnapshot.mockReturnValue(PRO);
    await mod.redeemPartnerOffer(t);
    expect(mockClient.redeemOfferCode).not.toHaveBeenCalled();
  });

  it('coming back without PRO records no purchase and leaves the attribution open', async () => {
    const mod = await redeemed();
    appStateHandler?.('active');
    await settle();
    expect(sent()).toEqual([]);
    expect(mod.partner.active()?.code).toBe('PROFJOAO');
  });

  it('PRO delivered by the SDK listener before the app is back is still the purchase: recorded once, attribution locked', async () => {
    const mod = await redeemed();
    mockPayments.getSnapshot.mockReturnValue(PRO); // the listener got there first
    mockSubscriber?.();
    appStateHandler?.('active'); // and the foreground return finds nothing left to record
    mockPayments.refresh.mockResolvedValue(PRO);
    await settle();
    expect(sent()).toEqual([['purchase_completed', { offering: 'default', partner: 'PROFJOAO' }]]);
    expect(mod.partner.active()).toBeNull();
    expect(mod.partner.current()?.lockedAt).toBeDefined();
  });

  it('survives the app being killed while the App Store is in front', async () => {
    await redeemed();
    mockPayments.refresh.mockResolvedValue(PRO);
    mockPayments.getSnapshot.mockReturnValue(PRO);
    const next = load(); // a new launch, same storage
    await next.startPartner();
    expect(sent()).toEqual([['purchase_completed', { offering: 'default', partner: 'PROFJOAO' }]]);
    expect(next.partner.current()?.lockedAt).toBeDefined();
  });

  it('a purchase made through a paywall instead disarms the redemption: no second record', async () => {
    const mod = await redeemed();
    mod.disarmRedemption(); // openPaywall calls this when any paywall opens
    mockPayments.getSnapshot.mockReturnValue(PRO);
    mockSubscriber?.();
    await settle();
    expect(sent()).toEqual([]);
  });

  it('a redemption left unfinished for two days no longer counts (a later restore is not a partner purchase)', async () => {
    const realNow = Date.now;
    const mod = await redeemed();
    Date.now = () => realNow() + 49 * 3600 * 1000;
    try {
      mockPayments.getSnapshot.mockReturnValue(PRO);
      mockSubscriber?.();
      await settle();
      expect(sent()).toEqual([]);
    } finally {
      Date.now = realNow;
    }
    expect(mod.partner.current()?.lockedAt).toBeUndefined();
  });
});

describe('refreshPartner', () => {
  it('confirms a code applied offline as soon as the app is used again, without a restart', async () => {
    mockClient.partners.mockResolvedValue(null);
    const mod = load();
    expect(await mod.applyPartnerCode('PROFJOAO', 'typed')).toBe('pending');
    expect(mod.partner.active()).toBeNull();
    mockClient.partners.mockResolvedValue(DIR);
    await mod.refreshPartner();
    expect(mod.partner.active()?.name).toBe('Prof. João');
    expect(sent()).toEqual([['partner_code_applied', { code: 'PROFJOAO', source: 'typed' }]]);
  });

  it('is a no-op when nothing is waiting', async () => {
    const mod = load();
    await mod.refreshPartner();
    expect(mockClient.partners).not.toHaveBeenCalled();
  });
});
