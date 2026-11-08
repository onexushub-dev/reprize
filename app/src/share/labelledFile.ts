import { Directory, File, Paths } from 'expo-file-system';

/**
 * A clip's label as a file name: "toco do marcão" → "toco do marcao" (accents off, only letters, digits, spaces, "-"
 * and "_"). Undefined when nothing usable is left.
 */
export function fileStem(label: string): string | undefined {
  const plain = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 0 ? plain : undefined;
}

/** One stem per item (undefined where there is none); a repeated stem gets " 2", " 3"… so no file replaces another. */
export function uniqueStems(stems: (string | undefined)[]): (string | undefined)[] {
  const seen = new Map<string, number>();
  return stems.map((stem) => {
    if (stem === undefined) return undefined;
    const key = stem.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? stem : `${stem} ${count}`;
  });
}

/**
 * The exports to hand to the share sheet, each named after its clip's label (the share sheet and the apps it sends to
 * show the file name: "toco do marcao.mp4", 2026-11-07 spec §6). An export without a label, or a copy that fails,
 * keeps its own path. Paths are plain, without `file://`.
 */
export async function labelledPaths(items: { path: string; label?: string }[]): Promise<string[]> {
  const stems = uniqueStems(items.map((item) => (item.label === undefined ? undefined : fileStem(item.label))));
  if (stems.every((stem) => stem === undefined)) return items.map((item) => item.path);
  let dir: Directory;
  try {
    dir = new Directory(Paths.cache, 'labelled', String(Date.now()));
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    return items.map((item) => item.path);
  }
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const stem = stems[i];
    const item = items[i];
    if (stem === undefined) {
      out.push(item.path);
      continue;
    }
    try {
      const dest = new File(dir, `${stem}.mp4`);
      await new File(`file://${item.path}`).copy(dest);
      out.push(decodeURIComponent(dest.uri.replace(/^file:\/\//, '')));
    } catch {
      out.push(item.path);
    }
  }
  return out;
}
