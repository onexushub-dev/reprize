import type { UploadItem } from '../../modules/replay-camera/src/ReplayCamera.types';
import { Directory, Paths } from 'expo-file-system';

import { kv } from '../data/mmkv';
import type { PrepJob } from './shareInput';

/**
 * The uploads of each share, kept on the phone until the share expires (sharing design §5.4). The queue reads them at
 * launch and whenever it starts again; the URLs stay valid until `expiresAt` (ms).
 */
export type UploadPlan = { expiresAt: number; items: UploadItem[]; group?: PlanGroup };

/**
 * A plan that belongs to a group link (multi-recording share design §5.3): `position` is the recording's place in the
 * link (1 to `count`), 0 for the group's cover. The queue orders the uploads of the whole link with it.
 */
export type PlanGroup = { id: string; position: number; count: number };

function planGroup(value: unknown): PlanGroup | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, position, count } = value as Partial<PlanGroup>;
  if (typeof id !== 'string' || typeof position !== 'number' || typeof count !== 'number') return undefined;
  return { id, position, count };
}

const INDEX = 'reprize:v1:share-uploads';
const keyOf = (shareId: string) => `reprize:v1:share-uploads:${shareId}`;
const PAUSED = 'reprize:v1:uploads-paused';
const confirmedKey = (shareId: string) => `reprize:v1:share-confirmed:${shareId}`;
const prepKey = (shareId: string) => `reprize:v1:share-prep:${shareId}`;

function readJson(key: string): unknown {
  const raw = kv.getString(key);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Every share with uploads kept on the phone. */
export function plannedShares(): string[] {
  const ids = readJson(INDEX);
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function saveUploadPlan(shareId: string, plan: UploadPlan): void {
  kv.set(keyOf(shareId), JSON.stringify(plan));
  const ids = plannedShares();
  if (!ids.includes(shareId)) kv.set(INDEX, JSON.stringify([...ids, shareId]));
}

/** The share's plan; one stored before plans had an expiry counts as expired. */
export function uploadPlan(shareId: string): UploadPlan | undefined {
  const plan = readJson(keyOf(shareId));
  if (Array.isArray(plan)) return { expiresAt: 0, items: plan as UploadItem[] };
  if (typeof plan !== 'object' || plan === null) return undefined;
  const { expiresAt, items, group } = plan as Partial<UploadPlan>;
  if (typeof expiresAt !== 'number' || !Array.isArray(items)) return undefined;
  const inGroup = planGroup(group);
  return inGroup === undefined ? { expiresAt, items } : { expiresAt, items, group: inGroup };
}

/** Files made for a share (its cover), kept until the share is forgotten. */
export function shareFilesDir(shareId: string): Directory {
  return new Directory(Paths.document, 'shares', shareId);
}

export function forgetUploadPlan(shareId: string): void {
  try {
    const dir = shareFilesDir(shareId);
    if (dir.exists) dir.delete();
  } catch {
    // nothing made for it
  }
  kv.delete(keyOf(shareId));
  kv.delete(confirmedKey(shareId));
  kv.delete(prepKey(shareId));
  kv.set(INDEX, JSON.stringify(plannedShares().filter((id) => id !== shareId)));
}

/** Clip positions the server confirmed in R2 (`confirm-upload`). */
export function confirmedPositions(shareId: string): number[] {
  const list = readJson(confirmedKey(shareId));
  return Array.isArray(list) ? list.filter((n): n is number => typeof n === 'number') : [];
}

export function setConfirmedPositions(shareId: string, positions: number[]): void {
  kv.set(confirmedKey(shareId), JSON.stringify(positions));
}

/** "Enviar pelos dados móveis" (sharing design §5.4): on by default. */
/** Uploads use mobile data whenever there is no Wi-Fi (2026-11-20: the switch that turned this off is gone). */
export function uploadOnCellular(): boolean {
  return true;
}

/** "Pausar envio": every share's uploads wait until "Continuar envio". */
export function uploadsPaused(): boolean {
  return kv.getString(PAUSED) === 'on';
}

export function setUploadsPaused(paused: boolean): void {
  kv.set(PAUSED, paused ? 'on' : 'off');
}

/** The files still to make before their uploads (`sharePrep.ts`), in order. */
export function prepJobsOf(shareId: string): PrepJob[] {
  const list = readJson(prepKey(shareId));
  return Array.isArray(list) ? (list as PrepJob[]) : [];
}

export function setPrepJobs(shareId: string, jobs: PrepJob[]): void {
  if (jobs.length === 0) kv.delete(prepKey(shareId));
  else kv.set(prepKey(shareId), JSON.stringify(jobs));
}
