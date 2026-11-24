import { kv } from '../data/mmkv';

/**
 * Someone who came to the app through a shared link (sharing design §9): the first link opened on a phone with no
 * recording of its own marks it, and that person's first own recording is counted once (`received_user_first_recording`).
 * Every read is guarded: analytics must never break a recording.
 */
const KEY = 'reprize:v1:came-by-share';

export function markCameByShare(): void {
  try {
    kv.set(KEY, '1');
  } catch {
    // only a metric
  }
}

/** True once: the first own recording of someone who came by a link. */
export function takeFirstRecordingAfterShare(): boolean {
  try {
    if (kv.getString(KEY) !== '1') return false;
    kv.set(KEY, 'done');
    return true;
  } catch {
    return false;
  }
}
