import { normalizeCode } from './code';

/** The valid partner codes and what to call each one, kept in the metadata of the RevenueCat `default` offering. */
export type PartnerDirectory = Record<string, { name: string }>;

/** `{ partners: { CODE: { name } } }` out of the offering metadata. Invalid codes are dropped; a missing name is the code. */
export function parsePartners(metadata: unknown): PartnerDirectory {
  const out: PartnerDirectory = {};
  if (typeof metadata !== 'object' || metadata === null) return out;
  const partners = (metadata as { partners?: unknown }).partners;
  if (typeof partners !== 'object' || partners === null) return out;
  for (const [raw, value] of Object.entries(partners)) {
    const code = normalizeCode(raw);
    if (code === null) continue;
    const name = typeof value === 'object' && value !== null ? (value as { name?: unknown }).name : undefined;
    out[code] = { name: typeof name === 'string' && name.trim() !== '' ? name.trim() : code };
  }
  return out;
}
