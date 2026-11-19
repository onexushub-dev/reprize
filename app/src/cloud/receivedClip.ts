import type { TriggerSource } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { BallSportId, Clip } from '../data/schema';

/** One clip of a share as `open-share` gives it: the sender's edit data and, once uploaded, its download URLs. */
export type OpenedClip = {
  position: number;
  bytes: number;
  durationMs: number;
  edit: Record<string, unknown>;
  ready: boolean;
  video?: string;
  focus?: string;
  ball?: string;
};

const SOURCES: TriggerSource[] = ['screen', 'gesture', 'remote', 'watch', 'voice', 'phone'];

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const range = (v: unknown): { startMs: number; endMs: number } | undefined => {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  const startMs = num(r.startMs);
  const endMs = num(r.endMs);
  return startMs !== undefined && endMs !== undefined && endMs > startMs ? { startMs, endMs } : undefined;
};

/**
 * The received clip as the sender left it (sharing design decision 7: the sender's cut, speed, zoom, rotation and
 * framing), from the share's edit data and the files downloaded to this phone. Anything missing or malformed falls
 * back to the clip's whole file.
 */
export function receivedClip(
  sessionId: string,
  opened: OpenedClip,
  files: { video: string; focus?: string; ball?: string },
  now: number,
): Omit<Clip, 'id'> {
  const meta = opened.edit;
  const whole = { startMs: 0, endMs: opened.durationMs };
  const trim = range(meta.trim) || whole;
  const bounds = range(meta.bounds);
  const source = SOURCES.find((s) => s === meta.source) || 'screen';
  const name = typeof meta.name === 'string' && meta.name.trim() !== '' ? meta.name.trim() : undefined;
  const edit = typeof meta.edit === 'object' && meta.edit !== null ? (meta.edit as Clip['edit']) : undefined;
  const focusRange = range(meta.focus);
  const ballMeta = typeof meta.ball === 'object' && meta.ball !== null ? (meta.ball as Record<string, unknown>) : undefined;
  const ballRange = range(ballMeta);
  const clip: Omit<Clip, 'id'> = {
    sessionId,
    createdAt: num(meta.createdAt) || now,
    source,
    path: files.video,
    durationMs: opened.durationMs,
    trim,
    sharePosition: opened.position,
    number: num(meta.number) || opened.position,
  };
  if (bounds) clip.bounds = bounds;
  const contentStartMs = num(meta.contentStartMs);
  if (contentStartMs !== undefined) clip.contentStartMs = contentStartMs;
  const shortSide = num(meta.shortSide);
  if (shortSide !== undefined) clip.shortSide = shortSide;
  if (name) clip.name = name;
  if (edit) clip.edit = edit;
  if (files.focus) clip.focus = { v: 1, status: 'ready', file: files.focus, ...(focusRange || {}) };
  if (files.ball && ballMeta && ballRange) {
    const sport = typeof ballMeta.sport === 'string' ? (ballMeta.sport as BallSportId) : undefined;
    const rules = typeof ballMeta.rules === 'string' ? ballMeta.rules : undefined;
    clip.ball = { v: 1, status: 'ready', ...ballRange, file: files.ball, ...(sport ? { sport } : {}), ...(rules ? { rules } : {}) };
  }
  return clip;
}
