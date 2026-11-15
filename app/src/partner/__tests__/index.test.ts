import { Alert, AppState, Platform } from 'react-native';

import { translate } from '../../i18n';

const mockData = new Map<string, string>();
const mockTrack = jest.fn();
const mockPayments = { getSnapshot: jest.fn(), refresh: jest.fn() };
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
const DIR = { PROFJOAO: { name: 'Prof. João' }, MARIA10: { name: 'Maria' } };

function load(): typeof import('../index') {
  let mod!: typeof import('../index');
  jest.isolateModules(() => {
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
    expect(mockClient.setPartner).toHaveBeenCalledWith('PROFJOAO', 'typed');
    expect(sent()).toEqual([['partner_code_applied', { code: 'PROFJOAO', source: 'typed' }]]);
  });

  it('reports a rejection without what was typed', async () => {
    const { applyPartnerCode } = load();
    expect(await applyPartnerCode('NOPE123', 'typed')).toBe('invalid');
    expect(sent()).toEqual([['partner_code_rejected', { source: 'typed', reason: 'invalid' }]]);
  });

  it('does not apply a code for a customer who already has PRO', async () => {
    mockPayments.getSnapshot.mockReturnValue({ proActive: true, passTransactions: [] });
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

describe('redeemPartnerOffer (iPhone)', () => {
  it('opens the redemption for the active code and reports it', async () => {
    const { applyPartnerCode, redeemPartnerOffer } = load();
    await applyPartnerCode('PROFJOAO', 'link');
    mockTrack.mockClear();
    await redeemPartnerOffer(t);
    expect(mockClient.redeemOfferCode).toHaveBeenCalledWith('PROFJOAO');
    expect(sent()).toEqual([['partner_offer_opened', { code: 'PROFJOAO', via: 'offer_code' }]]);
  });

  it('tells the player when the redemption cannot be opened', async () => {
    mockClient.redeemOfferCode.mockResolvedValue(false);
    const { applyPartnerCode, redeemPartnerOffer } = load();
    await applyPartnerCode('PROFJOAO', 'link');
    await redeemPartnerOffer(t);
    expect(Alert.alert).toHaveBeenCalledWith(t('partner.redeemError'));
    expect(appStateHandler).toBeUndefined();
  });

  it('coming back without PRO records no purchase and leaves the attribution open', async () => {
    const { applyPartnerCode, redeemPartnerOffer, partner } = load();
    await applyPartnerCode('PROFJOAO', 'link');
    mockTrack.mockClear();
    await redeemPartnerOffer(t);
    mockTrack.mockClear();
    appStateHandler?.('active');
    await new Promise((r) => setImmediate(r));
    expect(sent()).toEqual([]);
    expect(partner.active()?.code).toBe('PROFJOAO');
  });

  it('coming back with PRO records purchase_completed once and locks the attribution', async () => {
    const { applyPartnerCode, redeemPartnerOffer, partner } = load();
    await applyPartnerCode('PROFJOAO', 'link');
    await redeemPartnerOffer(t);
    mockTrack.mockClear();
    mockPayments.refresh.mockResolvedValue({ proActive: true, passTransactions: [] });
    appStateHandler?.('active');
    await new Promise((r) => setImmediate(r));
    expect(sent()).toEqual([['purchase_completed', { offering: 'default', partner: 'PROFJOAO' }]]);
    expect(partner.active()).toBeNull();
    expect(partner.current()?.lockedAt).toBeDefined();
    expect(removeSub).toHaveBeenCalled();
  });

  it('ignores a background change', async () => {
    const { applyPartnerCode, redeemPartnerOffer } = load();
    await applyPartnerCode('PROFJOAO', 'link');
    await redeemPartnerOffer(t);
    appStateHandler?.('background');
    expect(mockPayments.refresh).not.toHaveBeenCalled();
  });
});
