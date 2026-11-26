import type { MessageKey } from '../i18n';
import type { Edit } from '../share/editing';

/** What the sender fixed on a received clip: the sound of a clip sent without it (2026-11-22). */
type Locks = { sound?: true };

/** Why the clip cannot have sound, or undefined when the switch is free. */
function lockOf(edit: Edit, locks: Locks): MessageKey | undefined {
  if (locks.sound === true) return 'clip.soundSentOff';
  if (edit.speed !== 1) return 'clip.soundLocked';
  return undefined;
}

/** Whether the clip has sound now (the Sound tab's icon). */
export function soundOf(edit: Edit, locks: Locks): boolean {
  return lockOf(edit, locks) === undefined && !edit.muted;
}

/**
 * A tap on the Sound tab (2026-11-26: a switch on the edit bar, no panel): the new `muted` and the notice saying what
 * happened, since the icon has no words; or only the notice, when the clip cannot have sound.
 */
export function soundTap(edit: Edit, locks: Locks): { muted?: boolean; notice: MessageKey } {
  const lock = lockOf(edit, locks);
  if (lock !== undefined) return { notice: lock };
  return edit.muted ? { muted: false, notice: 'clip.soundOnNotice' } : { muted: true, notice: 'clip.soundOffNotice' };
}
