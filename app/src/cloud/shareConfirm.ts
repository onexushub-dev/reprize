import { showDialog } from '../components/dialog';
import type { Session } from '../data/schema';
import type { TFunction } from '../i18n';
import { shareGroup } from './shareGroups';

/** A link shown again rather than made: it has at least this long left (as `liveShare` and `liveGroupFor`). */
const REUSE_MARGIN_MS = 5 * 60 * 1000;

function live(expiresAt: number, state: 'active' | 'off', now: number): boolean {
  return state === 'active' && expiresAt - now >= REUSE_MARGIN_MS;
}

/**
 * Whether these recordings already have the live link that sharing them would show (then the sheet opens straight
 * away): one recording with its own link or in a group; several, all in the same group link and nothing else in it.
 */
export function linkExists(sessions: Pick<Session, 'id' | 'shared'>[], now: number = Date.now()): boolean {
  if (sessions.length === 0) return false;
  if (sessions.length === 1) {
    const shared = sessions[0].shared;
    if (shared === undefined || !live(shared.expiresAt, shared.state, now)) return false;
    if (shared.groupId === undefined) return true;
    const group = shareGroup(shared.groupId);
    return group !== undefined && live(group.expiresAt, group.state, now);
  }
  const first = sessions[0].shared;
  const groupId = first === undefined ? undefined : first.groupId;
  if (groupId === undefined) return false;
  if (!sessions.every((s) => s.shared !== undefined && s.shared.groupId === groupId)) return false;
  const group = shareGroup(groupId);
  if (group === undefined || !live(group.expiresAt, group.state, now)) return false;
  const ids = group.recordings.map((r) => r.sessionId);
  return ids.length === sessions.length && sessions.every((s) => ids.includes(s.id));
}

/**
 * When the recording's live link ends (its own, or the group link it is in), if it has one worth showing again;
 * undefined when sharing would make a new link.
 */
export function liveLinkExpiry(session: Pick<Session, 'shared'>, now: number = Date.now()): number | undefined {
  const shared = session.shared;
  if (shared === undefined || !live(shared.expiresAt, shared.state, now)) return undefined;
  if (shared.groupId === undefined) return shared.expiresAt;
  const group = shareGroup(shared.groupId);
  return group !== undefined && live(group.expiresAt, group.state, now) ? group.expiresAt : undefined;
}

/**
 * A link with only the picked clips (2026-11-23). A recording has one live link at a time: when it already has one
 * (whole, picked clips or in a group link), nothing new is made and the dialog says so, with Ver link (`open`).
 * Otherwise it asks first and `go` makes the link.
 */
export function confirmClipsShare(
  t: TFunction,
  session: Pick<Session, 'shared'>,
  name: string,
  count: number,
  go: () => void,
  open: () => void,
  now: number = Date.now(),
): void {
  const expiresAt = liveLinkExpiry(session, now);
  if (expiresAt !== undefined) {
    showDialog({
      title: t('sharing.liveTitle'),
      body: t('sharing.liveBody', { count: Math.max(1, Math.ceil((expiresAt - now) / 3_600_000)) }),
      cancel: t('common.close'),
      confirm: t('sharing.liveOpen'),
      onConfirm: open,
    });
    return;
  }
  showDialog({
    title: t('sharing.confirmClipsTitle', { count }),
    body: t('sharing.confirmClipsBody', { count, name }),
    cancel: t('common.cancel'),
    confirm: t('sharing.confirmGo'),
    onConfirm: go,
  });
}

/**
 * Asks before a link is made (2026-11-22): what goes in it and for how long. `go` runs on Compartilhar. A link that
 * already exists opens without asking: nothing new is made.
 */
export function confirmShare(
  t: TFunction,
  sessions: Pick<Session, 'id' | 'shared'>[],
  clips: number,
  go: () => void,
): void {
  if (linkExists(sessions)) {
    go();
    return;
  }
  const several = sessions.length > 1;
  // In the app's glass dialog (2026-11-23), like every share confirmation.
  showDialog({
    title: several ? t('sharing.confirmManyTitle', { count: sessions.length }) : t('sharing.confirmOneTitle'),
    body: several
      ? t('sharing.confirmManyBody', { count: sessions.length, clips: t('sharing.clips', { count: clips }) })
      : t('sharing.confirmOneBody', { clips: t('sharing.clips', { count: clips }) }),
    cancel: t('common.cancel'),
    confirm: t('sharing.confirmGo'),
    onConfirm: go,
  });
}
