import type { UploadItem } from '../../modules/replay-camera/src/ReplayCamera.types';
import { readyBallFile } from '../data/ballFile';
import type { FileProbe } from '../data/repo';
import { focusCovers } from '../data/focusFile';
import type { Clip, Session } from '../data/schema';
import { thumbnailPath } from '../data/thumbnailPath';
import { clipNumber } from '../components/format';
import { cutBytesBound, rebaseRange, shareCutOf, shareLocksOf } from './shareCut';
import type { CreatedShare, ShareInput, ShareUpload } from './shares';

/**
 * A file made on this phone before it is sent (2026-11-22): the clip's cut (passthrough, without sound when muted) or a
 * framing file on the cut's time. Kept with the share until made (`sharePrep.ts`); the upload waits for it.
 */
export type PrepWork =
  | { kind: 'cut'; source: string; startMs: number; endMs: number; muted: boolean }
  | { kind: 'framing'; source: string; startMs: number; endMs: number };

/** A file on this phone that one of the share's uploads carries; `prep`: made first (`path` is empty until then). */
export type LocalShareFile = { kind: ShareUpload['kind']; position: number | null; path: string; prep?: PrepWork };

/** A framing file sent as it is, or put on the cut's time first. */
function framingFile(
  kind: 'focus' | 'ball',
  position: number,
  source: string,
  cut: boolean,
  range: { startMs: number; endMs: number },
): LocalShareFile {
  return cut ? { kind, position, path: '', prep: { kind: 'framing', source, ...range } } : { kind, position, path: source };
}

/** The part of the clip a Jogadores record covers (a record from before ranges covered the whole clip). */
function focusSpan(focus: NonNullable<Clip['focus']>, durationMs: number): { startMs: number; endMs: number } {
  return {
    startMs: focus.startMs === undefined ? 0 : focus.startMs,
    endMs: focus.endMs === undefined ? durationMs : focus.endMs,
  };
}

/**
 * What the server is asked for a recording, and which local file each upload will carry. Clips go in the recording's
 * order (position 1, 2, …); each carries its edit and what the recipient's app needs to show it as the sender left it.
 * Side files are announced only when they exist on the phone. The cover is asked for too; it is exported afterwards
 * (`cover.ts`), so its uploads wait in the plan without a file.
 *
 * What is sent is what the sender left (2026-11-22, `shareCut.ts`): only the cut, without sound when muted, made right
 * after the link (`sharePrep.ts`); the edit on the cut's time (it starts at 0) with what the recipient may not undo
 * (`locks`). Framing files that do not cover the cut are not sent.
 */
export function recordingShareInput(
  session: Session,
  clips: Clip[],
  files: FileProbe,
  /** How long the recording ran (ms), sent so the recipient sees its minutes. */
  recordedMs?: number,
): { input: ShareInput; local: LocalShareFile[] } {
  const local: LocalShareFile[] = [];
  const entries = clips.map((clip, index) => {
    const position = index + 1;
    const cut = shareCutOf(clip);
    const length = Math.max(1, Math.round(cut.endMs - cut.startMs));
    const thumb = thumbnailPath(clip.path);
    const focus = clip.focus && clip.focus.status === 'ready' && focusCovers(clip.focus, clip.trim) ? clip.focus.file : undefined;
    const ball = readyBallFile(clip);
    const hasThumb = files.exists(thumb);
    const hasFocus = focus !== undefined && files.exists(focus);
    const hasBall = ball !== undefined && files.exists(ball);
    const range = { startMs: cut.startMs, endMs: cut.endMs };
    local.push(
      cut.needed
        ? { kind: 'video', position, path: '', prep: { kind: 'cut', source: clip.path, ...range, muted: cut.muted } }
        : { kind: 'video', position, path: clip.path },
    );
    if (hasThumb) local.push({ kind: 'thumb', position, path: thumb });
    if (focus !== undefined && hasFocus) {
      local.push(framingFile('focus', position, focus, cut.needed, range));
    }
    if (ball !== undefined && hasBall) {
      local.push(framingFile('ball', position, ball, cut.needed, range));
    }
    const whole = { startMs: 0, endMs: length };
    const locks = shareLocksOf(clip);
    const fileBytes = files.sizeBytes(clip.path);
    return {
      position,
      bytes: cut.needed ? cutBytesBound(fileBytes) : Math.max(1, fileBytes),
      durationMs: length,
      edit: {
        number: clipNumber(clip, index),
        name: clip.name,
        createdAt: clip.createdAt,
        source: clip.source,
        // The cut file starts at the cut: the whole of it is the clip, and nothing before or after can be reached.
        trim: whole,
        bounds: whole,
        contentStartMs: clip.contentStartMs === undefined ? undefined : Math.max(0, clip.contentStartMs - cut.startMs),
        shortSide: clip.shortSide,
        edit: clip.edit,
        focus: hasFocus && clip.focus ? rebaseRange(focusSpan(clip.focus, clip.durationMs), cut) : undefined,
        ball: hasBall && clip.ball ? { ...rebaseRange(clip.ball, cut), sport: clip.ball.sport, rules: clip.ball.rules } : undefined,
        locks: Object.keys(locks).length > 0 ? locks : undefined,
      },
      hasThumb,
      hasFocus,
      hasBall,
    };
  });
  const title = session.name ? session.name : undefined;
  const sport = session.ballSport && session.ballSport.sport ? session.ballSport.sport : undefined;
  const input: ShareInput = { kind: 'recording', title, sport, cover: true, clips: entries };
  if (recordedMs !== undefined) input.recordedMs = Math.max(0, Math.round(recordedMs));
  return { input, local };
}

/** A file still to be made for an upload: its upload's key, and what to make. */
export type PrepJob = PrepWork & { id: string };

/** The files to make before their uploads can start, in the order of the plan. */
export function prepJobs(share: Pick<CreatedShare, 'uploads'>, local: LocalShareFile[]): PrepJob[] {
  const jobs: PrepJob[] = [];
  for (const upload of share.uploads) {
    const file = local.find((f) => f.kind === upload.kind && f.position === upload.position);
    if (file !== undefined && file.prep !== undefined) jobs.push({ ...file.prep, id: upload.key });
  }
  return jobs;
}

/**
 * The background upload items: each presigned URL paired with its file on the phone. The cover's uploads, and the
 * files made before sending (`prep`), are kept with an empty path until made (`attachCover`, `sharePrep.ts`); any
 * other upload without a file is left out.
 */
export function uploadItems(share: CreatedShare, local: LocalShareFile[]): UploadItem[] {
  const items: UploadItem[] = [];
  for (const upload of share.uploads) {
    const file = local.find((f) => f.kind === upload.kind && f.position === upload.position);
    const cover = upload.kind === 'cover' || upload.kind === 'coverImage';
    if (file === undefined && !cover) continue;
    items.push({ id: upload.key, path: file === undefined ? '' : file.path, url: upload.url, contentType: upload.contentType });
  }
  return items;
}

/** A cover upload still waiting for its file. */
export function coverPending(items: UploadItem[]): boolean {
  return items.some((item) => item.path === '' && /\/cover\.(mp4|jpg)$/.test(item.id));
}

/** The plan's items with the cover files in place. */
export function attachCover(items: UploadItem[], cover: { video: string; image: string }): UploadItem[] {
  return items.map((item) => {
    if (item.id.endsWith('/cover.mp4')) return { ...item, path: cover.video };
    if (item.id.endsWith('/cover.jpg')) return { ...item, path: cover.image };
    return item;
  });
}
