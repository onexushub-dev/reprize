import { DIAGNOSTICS_ENABLED } from '../diag/diagLog';

/**
 * TEMP(sharing): accounts and sharing are being built (docs/superpowers/specs/2026-11-16-recording-sharing-design.md,
 * Phase 1). Until the feature ships they exist only in diagnostics builds, so a release cut from main shows none of it.
 */
export const SHARING_ENABLED = DIAGNOSTICS_ENABLED;
