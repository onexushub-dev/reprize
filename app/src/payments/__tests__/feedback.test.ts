import { Alert, Platform } from 'react-native';

import { track } from '../../analytics';
import { translate } from '../../i18n';
import { partner, redeemPartnerOffer } from '../../partner';
import { openPaywall, restorePurchases } from '../feedback';
import { payments } from '..';

jest.mock('../../analytics', () => ({ track: jest.fn() }));
jest.mock('..', () => ({ payments: { showPaywall: jest.fn(), restore: jest.fn() } }));
jest.mock('../../partner', () => ({
  partner: { active: jest.fn(() => null), lock: jest.fn() },
  redeemPartnerOffer: jest.fn(async () => {}),
}));

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params);
const showPaywall = payments.showPaywall as jest.Mock;
const restore = payments.restore as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('openPaywall', () => {
  it('opens the one paywall and tells the user when it fails', async () => {
    showPaywall.mockResolvedValue('error');
    await expect(openPaywall(t, 'upgrade_card')).resolves.toBe('error');
    expect(showPaywall).toHaveBeenCalledWith('default');
    expect(Alert.alert).toHaveBeenCalledWith(t('payments.paywallError'));
  });
  it.each(['cancelled', 'purchased', 'restored'])('stays silent on %s and returns it', async (outcome) => {
    showPaywall.mockResolvedValue(outcome);
    await expect(openPaywall(t, 'upgrade_card')).resolves.toBe(outcome);
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('openPaywall analytics', () => {
  const sent = () => (track as jest.Mock).mock.calls;

  it('reports the paywall as viewed with its source before it opens', async () => {
    const order: string[] = [];
    (track as jest.Mock).mockImplementation((name: string) => void order.push(name));
    showPaywall.mockImplementation(async () => {
      order.push('showPaywall');
      return 'cancelled';
    });
    await openPaywall(t, 'locked_feature');
    expect(order).toEqual(['paywall_viewed', 'showPaywall']);
    expect(sent()[0]).toEqual(['paywall_viewed', { source: 'locked_feature', offering: 'default' }]);
  });

  it('reports a purchase, and only a purchase, as purchase_completed', async () => {
    showPaywall.mockResolvedValue('purchased');
    await openPaywall(t, 'upgrade_card');
    expect(sent().map(([name]) => name)).toEqual(['paywall_viewed', 'purchase_completed']);
  });

  it('says which paywall was shown and bought: PRO or the Single Pass', async () => {
    showPaywall.mockResolvedValue('purchased');
    await openPaywall(t, 'export_limit', 'pass');
    expect(showPaywall).toHaveBeenCalledWith('pass');
    expect(sent()).toEqual([
      ['paywall_viewed', { source: 'export_limit', offering: 'pass' }],
      ['purchase_completed', { offering: 'pass' }],
    ]);
  });

  it('reports a failure as purchase_failed', async () => {
    showPaywall.mockResolvedValue('error');
    await openPaywall(t, 'upgrade_card');
    expect(sent().map(([name, props]) => [name, props])).toEqual([
      ['paywall_viewed', { source: 'upgrade_card', offering: 'default' }],
      ['purchase_failed', { reason: 'error' }],
    ]);
  });

  it('reports nothing beyond the view on cancelled', async () => {
    showPaywall.mockResolvedValue('cancelled');
    await openPaywall(t, 'upgrade_card');
    expect(sent().map(([name]) => name)).toEqual(['paywall_viewed']);
  });

  it('reports a restore as purchase_restored, with the paywall it came from', async () => {
    showPaywall.mockResolvedValue('restored');
    await openPaywall(t, 'locked_feature', 'pass');
    expect(sent()).toEqual([
      ['paywall_viewed', { source: 'locked_feature', offering: 'pass' }],
      ['purchase_restored', { offering: 'pass' }],
    ]);
  });
});

describe('restorePurchases', () => {
  it('confirms a restore', async () => {
    restore.mockResolvedValue(true);
    await restorePurchases(t);
    expect(Alert.alert).toHaveBeenCalledWith(t('payments.restored'));
  });
  it('says when there was nothing to restore', async () => {
    restore.mockResolvedValue(false);
    await restorePurchases(t);
    expect(Alert.alert).toHaveBeenCalledWith(t('payments.nothingToRestore'));
  });
});

describe('openPaywall with a partner attribution', () => {
  const sent = () => (track as jest.Mock).mock.calls;
  const active = partner.active as jest.Mock;
  const lock = partner.lock as jest.Mock;
  const redeem = redeemPartnerOffer as jest.Mock;
  const attribution = { code: 'PROFJOAO', name: 'Prof. João', source: 'link', appliedAt: 1, status: 'valid' };

  beforeEach(() => {
    active.mockReturnValue(attribution);
    (track as jest.Mock).mockReset();
  });
  afterEach(() => {
    active.mockReturnValue(null);
    Platform.OS = 'ios';
  });

  it('Android: routes the default paywall to the partner offering and tags the events', async () => {
    Platform.OS = 'android';
    showPaywall.mockResolvedValue('cancelled');
    await openPaywall(t, 'upgrade_card');
    expect(showPaywall).toHaveBeenCalledWith('partner');
    expect(sent()).toEqual([
      ['partner_offer_opened', { code: 'PROFJOAO', via: 'paywall' }],
      ['paywall_viewed', { source: 'upgrade_card', offering: 'partner', partner: 'PROFJOAO' }],
    ]);
    expect(lock).not.toHaveBeenCalled();
  });

  it('Android: locks the attribution on a purchase, not on a restore', async () => {
    Platform.OS = 'android';
    showPaywall.mockResolvedValue('purchased');
    await openPaywall(t, 'upgrade_card');
    expect(sent().at(-1)).toEqual(['purchase_completed', { offering: 'partner', partner: 'PROFJOAO' }]);
    expect(lock).toHaveBeenCalledTimes(1);
    lock.mockClear();
    showPaywall.mockResolvedValue('restored');
    await openPaywall(t, 'upgrade_card');
    expect(lock).not.toHaveBeenCalled();
  });

  it('never reroutes the pass paywall and tags nothing', async () => {
    Platform.OS = 'android';
    showPaywall.mockResolvedValue('cancelled');
    await openPaywall(t, 'export_limit', 'pass');
    expect(showPaywall).toHaveBeenCalledWith('pass');
    expect(sent()).toEqual([['paywall_viewed', { source: 'export_limit', offering: 'pass' }]]);
  });

  it('without an active attribution the default paywall is untouched', async () => {
    active.mockReturnValue(null);
    Platform.OS = 'android';
    showPaywall.mockResolvedValue('cancelled');
    await openPaywall(t, 'upgrade_card');
    expect(showPaywall).toHaveBeenCalledWith('default');
  });

  it('iOS: "Get the discount" opens the redemption and reports cancelled, with no paywall', async () => {
    Platform.OS = 'ios';
    jest.spyOn(Alert, 'alert').mockImplementation(((_title: string, _msg: unknown, buttons: { text: string; onPress?: () => void }[]) => {
      buttons.find((b) => b.text === t('partner.activate'))?.onPress?.();
    }) as never);
    await expect(openPaywall(t, 'upgrade_card')).resolves.toBe('cancelled');
    expect(Alert.alert).toHaveBeenCalledWith(t('partner.offerTitle', { name: 'Prof. João' }), undefined, expect.any(Array));
    expect(redeem).toHaveBeenCalledWith(t);
    expect(showPaywall).not.toHaveBeenCalled();
  });

  it('iOS: "See all plans" opens the normal paywall tagged with the partner and locks on a purchase', async () => {
    Platform.OS = 'ios';
    jest.spyOn(Alert, 'alert').mockImplementation(((_title: string, _msg: unknown, buttons: { text: string; onPress?: () => void }[]) => {
      buttons.find((b) => b.text === t('partner.offerAll'))?.onPress?.();
    }) as never);
    showPaywall.mockResolvedValue('purchased');
    await expect(openPaywall(t, 'upgrade_card')).resolves.toBe('purchased');
    expect(showPaywall).toHaveBeenCalledWith('default');
    expect(sent()).toEqual([
      ['paywall_viewed', { source: 'upgrade_card', offering: 'default', partner: 'PROFJOAO' }],
      ['purchase_completed', { offering: 'default', partner: 'PROFJOAO' }],
    ]);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('iOS: dismissing the choice opens nothing', async () => {
    Platform.OS = 'ios';
    jest.spyOn(Alert, 'alert').mockImplementation(((_title: string, _msg: unknown, buttons: { text: string; onPress?: () => void }[]) => {
      buttons.find((b) => b.text === t('partner.later'))?.onPress?.();
    }) as never);
    await expect(openPaywall(t, 'upgrade_card')).resolves.toBe('cancelled');
    expect(showPaywall).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
  });
});

