import { repo } from '../data/mmkv';
import { createPaymentsStore } from './store';
import { createRevenueCatClient } from './revenuecatClient';

const client = createRevenueCatClient();
client.configure(); // idempotent; the store never configures the SDK itself

/** The RevenueCat client itself, for what is not about the player's plan (the partner directory and attributes). */
export const paymentsClient = client;

/** App-wide payments store; `payments.start()` runs once from the root layout. */
export const payments = createPaymentsStore(client, repo);

/** RevenueCat follows the signed-in account (same id as Supabase); null when signing out. */
export function identifyPurchaser(appUserId: string | null): Promise<void> {
  return client.identify(appUserId);
}
