import type { PartnerOffering } from '../payments/types';
import { normalizeCode } from './code';

/** The valid partner codes, what to call each one, and the price tier (RevenueCat offering) and discount it gives. */
export type PartnerDirectory = Record<string, { name: string; offering: PartnerOffering; discountPercent: number }>;

const TIER_ID = /^partner_[a-z0-9]+$/;

function validPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 90;
}

/**
 * The directory out of the `partner_<tier>` offerings, whose metadata is `{ discountPercent, partners: { CODE: { name } } }`.
 * An invalid tier is skipped alone. A code in two tiers belongs to the first by sorted offering id.
 */
export function parsePartnerOfferings(all: Record<string, { metadata?: unknown }>): PartnerDirectory {
  const out: PartnerDirectory = {};
  for (const id of Object.keys(all).sort()) {
    if (!TIER_ID.test(id)) continue;
    const metadata = all[id]?.metadata;
    if (typeof metadata !== 'object' || metadata === null) continue;
    const { discountPercent, partners } = metadata as { discountPercent?: unknown; partners?: unknown };
    if (!validPercent(discountPercent) || typeof partners !== 'object' || partners === null) continue;
    for (const [raw, value] of Object.entries(partners)) {
      const code = normalizeCode(raw);
      if (code === null || out[code]) continue;
      const name = typeof value === 'object' && value !== null ? (value as { name?: unknown }).name : undefined;
      out[code] = {
        name: typeof name === 'string' && name.trim() !== '' ? name.trim() : code,
        offering: id as PartnerOffering,
        discountPercent,
      };
    }
  }
  return out;
}
