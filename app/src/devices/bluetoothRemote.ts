import { useEffect, useSyncExternalStore } from 'react';

import { bluetoothConnected } from '../../modules/replay-camera';
import type { BluetoothConnected } from '../../modules/replay-camera/src/ReplayCamera.types';
import { repo } from '../data/mmkv';
import type { KnownRemote, Prefs } from '../data/schema';

/**
 * The Bluetooth selfie remote's link as iOS shows it (2026-11-01 field test: the AB Shutter3 is BLE and iOS returns it
 * while it is connected, under the Battery and Device Information services). The app learns which device is a remote
 * at a press, then follows it without one:
 * - `connected`: iOS holds one of the known remotes connected now;
 * - `missing`: none is connected (switched off, out of range, asleep, or unpaired in Ajustes);
 * - `bluetoothOff`: the iPhone's Bluetooth is off;
 * - undefined: unknown (no remote learnt, a classic-Bluetooth remote, no permission, Android): only presses tell.
 */
export type RemoteLink = 'connected' | 'missing' | 'bluetoothOff' | undefined;

/** How often the screens that show the remote look again. One cheap system call. */
export const POLL_MS = 2500;

type Device = BluetoothConnected['devices'][number];

/** The connected devices that could be a selfie remote: they offer Battery or HID (AirPods only show Device Information). */
export function remoteCandidates(devices: Device[]): Device[] {
  return devices.filter((d) => d.services.includes('battery') || d.services.includes('hid'));
}

/**
 * The remotes this phone has learnt, in the order they were learnt (2026-11-22: a list, so a second remote no longer
 * replaces the first; before, the app kept one as `remoteBleId`).
 */
export function knownRemotes(prefs: Prefs = repo.getPrefs()): KnownRemote[] {
  if (prefs.remotes !== undefined) return prefs.remotes;
  if (prefs.remoteBleId !== undefined) return [{ id: prefs.remoteBleId, name: prefs.remoteBleName }];
  // A remote used here before the list, that iOS never showed: its row, so the sheet shows the list, not the first time.
  if (prefs.remoteTestedAt !== undefined) return [{ id: HIDDEN_REMOTE }];
  return [];
}

/**
 * A remote heard only by its presses (2026-11-22 field test, the Selfie Remote): iOS does not show it to apps, so it has
 * no id to follow. It still gets its row in the list ("Controle"), connected while its press counts.
 */
export const HIDDEN_REMOTE = 'press-only';

/** The ids iOS can be asked about (not the remote heard only by its presses). */
export function followedIds(remotes: KnownRemote[]): string[] {
  return remotes.filter((r) => r.id !== HIDDEN_REMOTE).map((r) => r.id);
}

function saveRemotes(remotes: KnownRemote[]): void {
  repo.setPrefs({ remotes, remoteBleId: undefined, remoteBleName: undefined });
}

/** The link of the known remotes (`known`: their ids, or one id) from one look at the connected devices. */
export function linkOf(result: BluetoothConnected | undefined, known: string | string[] | undefined): RemoteLink {
  const ids = known === undefined ? [] : typeof known === 'string' ? [known] : known;
  if (result === undefined || ids.length === 0) return undefined;
  if (result.state === 'off') return 'bluetoothOff';
  if (result.state !== 'on') return undefined;
  return result.devices.some((d) => ids.includes(d.id)) ? 'connected' : 'missing';
}

/** Which of the known remotes iOS holds connected in one look. */
export function connectedOf(result: BluetoothConnected | undefined, ids: string[]): string[] {
  if (result === undefined || result.state !== 'on') return [];
  return ids.filter((id) => result.devices.some((d) => d.id === id));
}

/** What the screens that show the remote read: the link, which known remotes are connected, and the list itself. */
export type RemoteLinks = {
  link: RemoteLink;
  /** The ids of the known remotes iOS holds connected. */
  connected: string[];
  remotes: KnownRemote[];
  /** iOS was asked at least once (before that, the statuses are not known yet: nothing is shown rather than a guess). */
  looked: boolean;
  /** A press is being matched to a device right now (the sheet waits for it rather than flash its first-time proof). */
  learning: boolean;
  /**
   * What the last press did to the list: `added` (the one new remote joined it), `replaced` (several new remotes were on
   * and a press does not say which: the list became the remotes on now), `none` (no new remote iOS shows: a known one
   * was pressed, or one iOS hides from apps). Undefined: no press since `clearLastLearn`.
   */
  lastLearn: 'added' | 'replaced' | 'none' | undefined;
};

const EMPTY: RemoteLinks = {
  link: undefined,
  connected: [],
  remotes: [],
  looked: false,
  learning: false,
  lastLearn: undefined,
};
let state: RemoteLinks = EMPTY;
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
const sameRemotes = (a: KnownRemote[], b: KnownRemote[]) =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id && r.name === b[i].name);

function update(next: Partial<RemoteLinks>): void {
  const merged = { ...state, ...next };
  if (
    merged.link === state.link &&
    merged.looked === state.looked &&
    merged.learning === state.learning &&
    merged.lastLearn === state.lastLearn &&
    sameIds(merged.connected, state.connected) &&
    sameRemotes(merged.remotes, state.remotes)
  )
    return;
  state = merged;
  listeners.forEach((fn) => fn());
}

/** The snapshot, with the list as stored now (it changes at a press, a forget, or on another screen). */
function snapshot(): RemoteLinks {
  const remotes = knownRemotes();
  if (!sameRemotes(remotes, state.remotes)) state = { ...state, remotes };
  return state;
}

/** One look, never asking for Bluetooth (it was granted when a remote was learnt). */
async function look(): Promise<void> {
  const ids = followedIds(knownRemotes());
  if (ids.length === 0) return update({ link: undefined, connected: [], looked: true });
  try {
    const result = await bluetoothConnected(false);
    update({ link: linkOf(result, ids), connected: connectedOf(result, ids), looked: true });
  } catch {
    update({ link: undefined, connected: [], looked: true });
  }
}

const asKnown = (d: Device): KnownRemote => ({ id: d.id, name: d.name === '' ? undefined : d.name });

/** The list empty at a press no device explains: the remote heard only by its presses gets the row. */
function hiddenIfNone(): void {
  if (knownRemotes().length > 0) return;
  const remotes = [{ id: HIDDEN_REMOTE }];
  saveRemotes(remotes);
  update({ remotes, link: undefined, connected: [], looked: true, lastLearn: 'added' });
}

/**
 * A press was heard. iOS gives the names of the BLE remotes it holds connected, never which one was pressed. So:
 * - exactly one connected remote is new (not in the list): it joins the list, the others stay;
 * - several new ones (2026-11-22, the Shutter and the Selfie Remote on together): not knowing which, the list becomes
 *   the remotes on now, all shown connected (the player's choice after the field test: no question to answer);
 * - none new: nothing changes (a known remote, or one iOS hides from apps; the press alone shows it working), but an
 *   empty list gets the remote heard only by its presses, so the sheet always shows the list after a press.
 * Asks for Bluetooth the first time (the player is using the remote right now).
 */
export async function learnRemoteAtPress(): Promise<void> {
  update({ learning: true });
  try {
    const result = await bluetoothConnected(true);
    if (result === undefined || result.state !== 'on') return hiddenIfNone();
    let remotes = knownRemotes();
    // A remote forgotten while still on is learnt back at the next press too (2026-11-22: holding it back left the sheet
    // on its first-time proof after "Esquecer"; the rows carry no names, so there is nothing to mistake).
    const on = remoteCandidates(result.devices);
    const fresh = on.filter((d) => !remotes.some((r) => r.id === d.id));
    // A remote iOS shows replaces the one heard only by its presses (the rows look the same).
    if (fresh.length === 1) remotes = [...remotes.filter((r) => r.id !== HIDDEN_REMOTE), asKnown(fresh[0])];
    else if (fresh.length > 1) remotes = on.map(asKnown);
    else if (remotes.length === 0) remotes = [{ id: HIDDEN_REMOTE }];
    if (fresh.length > 0 || remotes.length !== knownRemotes().length) saveRemotes(remotes);
    const ids = followedIds(remotes);
    update({
      remotes,
      link: linkOf(result, ids),
      connected: connectedOf(result, ids),
      looked: true,
      lastLearn: fresh.length === 1 ? 'added' : fresh.length > 1 ? 'replaced' : 'none',
    });
  } catch {
    // the press still counts: only the link stays unknown
    hiddenIfNone();
  } finally {
    update({ learning: false });
  }
}

/** Starting over (the sheet's "Adicionar outro controle"): the next press is the one that counts. */
export function clearLastLearn(): void {
  update({ lastLearn: undefined });
}

/** "Esquecer": the app no longer knows that remote (all of them without an id). The iOS pairing stays, in Ajustes. */
export function forgetRemote(id?: string): void {
  const remotes = id === undefined ? [] : knownRemotes().filter((r) => r.id !== id);
  saveRemotes(remotes);
  update({ lastLearn: undefined });
  if (remotes.length === 0) {
    update({ remotes, link: undefined, connected: [] });
    return;
  }
  update({ remotes, connected: state.connected.filter((c) => c !== id) });
  void look();
}

/** Every remote forgotten (the sheet's "Esquecer" before 2026-11-22). */
export function forgetRemoteLink(): void {
  forgetRemote();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The known remotes and their links, looked at every `POLL_MS` while `active` (any screen showing them; shared looks). */
export function useRemoteLinks(active: boolean): RemoteLinks {
  useEffect(() => {
    if (!active) return;
    users += 1;
    if (users === 1) {
      void look();
      timer = setInterval(() => void look(), POLL_MS);
    }
    return () => {
      users -= 1;
      if (users === 0 && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
  }, [active]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** The remotes' link alone (connected when any known remote is). */
export function useRemoteLink(active: boolean): RemoteLink {
  return useRemoteLinks(active).link;
}

/** Tests only. */
export function resetRemoteLinkForTests(): void {
  state = EMPTY;
  users = 0;
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  listeners.clear();
}
