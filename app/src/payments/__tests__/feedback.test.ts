import { Alert } from 'react-native';

import { track } from '../../analytics';
import { translate } from '../../i18n';
import { openPaywall, restorePurchases } from '../feedback';
import { payments } from '..';

jest.mock('../../analytics', () => ({ track: jest.fn() }));
jest.mock('..', () => ({ payments: { showPaywall: jest.fn(), restore: jest.fn() } }));

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
      ['purchase_completed', { offering: 'pass', source: expect.any(String) }],
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
