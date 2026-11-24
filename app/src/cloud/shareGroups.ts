import { kv } from '../data/mmkv';

/** One recording of a group link: its own share (uploads and progress are per recording) and its clip count. */
export type ShareGroupRecording = { sessionId: string; shareId: string; clips: number };

/**
 * A group link made on this phone (multi-recording share design §5.1): what the group sheet shows again, and which
 * shares Encerrar compartilhamento turns off together. Times in ms. `recordings` in the link's order.
 */
export type ShareGroup = {
  groupId: string;
  url: string;
  createdAt: number;
  expiresAt: number;
  recordings: ShareGroupRecording[];
  state: 'active' | 'off';
};

const KEY = 'reprize:v1:share-groups';
/** A group is kept a day past its expiry (the recordings' strips and Ajustes read it until then), then dropped. */
const KEEP_MS = 24 * 60 * 60 * 1000;

function isRecording(value: unknown): value is ShareGroupRecording {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<ShareGroupRecording>;
  return typeof r.sessionId === 'string' && typeof r.shareId === 'string' && typeof r.clips === 'number';
}

function isGroup(value: unknown): value is ShareGroup {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<ShareGroup>;
  return (
    typeof g.groupId === 'string' &&
    typeof g.url === 'string' &&
    typeof g.createdAt === 'number' &&
    typeof g.expiresAt === 'number' &&
    (g.state === 'active' || g.state === 'off') &&
    Array.isArray(g.recordings) &&
    g.recordings.every(isRecording)
  );
}

/** Every group kept on this phone, oldest first. */
export function shareGroups(): ShareGroup[] {
  const raw = kv.getString(KEY);
  if (raw === undefined) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isGroup) : [];
  } catch {
    return [];
  }
}

export function shareGroup(groupId: string): ShareGroup | undefined {
  return shareGroups().find((g) => g.groupId === groupId);
}

/** Stores the group (replacing the one with its id) and drops groups expired more than a day ago. */
export function saveShareGroup(group: ShareGroup, now: number = Date.now()): void {
  const kept = shareGroups().filter((g) => g.groupId !== group.groupId && g.expiresAt + KEEP_MS > now);
  kv.set(KEY, JSON.stringify([...kept, group]));
}

export function forgetShareGroups(): void {
  kv.delete(KEY);
}

/** Clips of every recording in the link. */
export function groupClips(group: ShareGroup): number {
  return group.recordings.reduce((total, r) => total + r.clips, 0);
}
