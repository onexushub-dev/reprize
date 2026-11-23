import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';

import { type PartnerDirectory, parsePartnerOfferings } from '../partner/directory';
import type { PaymentsClient, PaywallOutcome } from './client';
import { toSnapshot } from './snapshot';
import { EMPTY_SNAPSHOT } from './types';

/** The Reprize app in App Store Connect: the offer code redemption page is per app. */
const APP_STORE_ID = '6833159162';

export type RevenueCatKeys = { ios?: string; android?: string; test?: string };

/** Public SDK key for this build: the test_ key wins in development, otherwise the platform's own key. */
export function pickApiKey(keys: RevenueCatKeys, os: string, dev: boolean): string | undefined {
  if (dev && keys.test) return keys.test;
  const key = os === 'ios' ? keys.ios : os === 'android' ? keys.android : undefined;
  return key || undefined;
}

export function outcomeFor(result: string): PaywallOutcome {
  const R = RevenueCatUI.PAYWALL_RESULT;
  if (result === R.PURCHASED) return 'purchased';
  if (result === R.RESTORED) return 'restored';
  if (result === R.CANCELLED) return 'cancelled';
  return 'error';
}

export function createRevenueCatClient(): PaymentsClient {
  let configured = false;
  let attempted = false;
  // The partner writes go one after the other: two quick ones must not leave attributes from different codes.
  let partnerWrites: Promise<void> = Promise.resolve();

  return {
    configure(): void {
      if (attempted) return; // once per app launch
      attempted = true;
      const keys = (Constants.expoConfig?.extra?.revenueCat ?? {}) as RevenueCatKeys;
      const apiKey = pickApiKey(keys, Platform.OS, __DEV__);
      if (!apiKey) {
        // In a development build, say why the paywall will fail.
        if (__DEV__) console.warn(`[payments] no RevenueCat key in this build (keys set: ${Object.keys(keys).filter((k) => keys[k as keyof RevenueCatKeys]).join(', ') || 'none'})`);
        return; // no key: the app runs as free
      }
      try {
        Purchases.configure({ apiKey });
        configured = true;
      } catch (e) {
        if (__DEV__) console.warn('[payments] RevenueCat configure failed', e);
        // a failing SDK must not crash launch: stay unconfigured, the app runs as free
      }
    },

    async getSnapshot() {
      if (!configured) return EMPTY_SNAPSHOT;
      return toSnapshot(await Purchases.getCustomerInfo());
    },

    onSnapshot(fn) {
      if (!configured) return () => {};
      const listener = (info: CustomerInfo) => fn(toSnapshot(info));
      Purchases.addCustomerInfoUpdateListener(listener);
      return () => void Purchases.removeCustomerInfoUpdateListener(listener);
    },

    async showPaywall(offering) {
      if (!configured) {
        if (__DEV__) console.warn('[payments] paywall: RevenueCat is not configured in this build');
        return 'error';
      }
      try {
        // The current offering is Pro (`default`); any other is looked up by its identifier. A missing one falls back
        // to the current offering, so the player can still buy Pro.
        let chosen: PurchasesOffering | undefined;
        if (offering !== 'default') {
          const all = await Purchases.getOfferings();
          chosen = all.all[offering];
          if (__DEV__ && chosen === undefined) console.warn(`[payments] offering "${offering}" not found: showing the current one`);
        }
        const result = await RevenueCatUI.presentPaywall(chosen ? { displayCloseButton: true, offering: chosen } : { displayCloseButton: true });
        if (__DEV__ && result === RevenueCatUI.PAYWALL_RESULT.ERROR) console.warn('[payments] paywall returned ERROR (see the [RevenueCat] logs)');
        return outcomeFor(result);
      } catch (e) {
        if (__DEV__) console.warn('[payments] paywall failed', e);
        return 'error';
      }
    },

    async restore() {
      if (!configured) return EMPTY_SNAPSHOT;
      return toSnapshot(await Purchases.restorePurchases());
    },

    setPartner(code, source, offering) {
      if (!configured) return Promise.resolve();
      partnerWrites = partnerWrites.then(async () => {
        try {
          await Purchases.setAttributes({ partner_code: code, partner_source: source, partner_offering: offering });
          await Purchases.setMediaSource('partner');
          await Purchases.setCampaign(code);
        } catch (e) {
          if (__DEV__) console.warn('[payments] setPartner failed', e);
          // retried at the next start while the attribution exists
        }
      });
      return partnerWrites;
    },

    async redeemOfferCode(code) {
      if (Platform.OS !== 'ios') return false;
      try {
        await Linking.openURL(`https://apps.apple.com/redeem?ctx=offercodes&id=${APP_STORE_ID}&code=${encodeURIComponent(code)}`);
        return true;
      } catch {
        // the page could not be opened: try StoreKit's own sheet, where the player types the code
      }
      try {
        if (!configured) return false;
        await Purchases.presentCodeRedemptionSheet();
        return true;
      } catch {
        return false;
      }
    },

    async partners(): Promise<PartnerDirectory | null> {
      if (!configured) return null;
      try {
        const offerings = await Purchases.getOfferings();
        return parsePartnerOfferings(offerings.all);
      } catch {
        return null;
      }
    },

    async identify(appUserId) {
      if (!configured) return;
      try {
        // logIn moves this install's anonymous purchases to the account (RevenueCat's default), so PRO bought before
        // signing in is kept. logOut fails on an anonymous user, hence the check.
        if (appUserId !== null) await Purchases.logIn(appUserId);
        else if (!(await Purchases.isAnonymous())) await Purchases.logOut();
      } catch (e) {
        if (__DEV__) console.warn('[payments] identify failed', e);
      }
    },
  };
}
