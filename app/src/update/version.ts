const parts = (version: string) => (/^\d+(\.\d+)*$/.test(version) ? version.split('.').map(Number) : undefined);

/** Whether `candidate` is a later dotted version than `current` (1.0.10 is later than 1.0.9). Unreadable: false. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
