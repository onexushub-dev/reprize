import type { UploadItem } from '../../modules/replay-camera/src/ReplayCamera.types';
import { readyBallFile } from '../data/ballFile';
import type { FileProbe } from '../data/repo';
import type { Clip, Session } from '../data/schema';
import { thumbnailPath } from '../data/thumbnailPath';
import { clipNumber } from '../components/format';
import type { CreatedShare, ShareInput, ShareUpload } from './shares';

/** A file on this phone that one of the share's uploads carries. */
export type LocalShareFile = { kind: ShareUpload['kind']; position: number | null; path: string };

/**
 * What the server is asked for a recording, and which local file each upload will carry. Clips go in the recording's
 * order (position 1, 2, …); each carries its edit and what the recipient's app needs to show it as the sender left it.
 * Side files are announced only when they exist on the phone. The cover is asked for too; it is exported afterwards
 * (`cover.ts`), so its uploads wait in the plan without a file.
 */
export function recordingShareInput(
  session: Session,
  clips: Clip[],
  files: FileProbe,
): { input: ShareInput; local: LocalShareFile[] } {
  const local: LocalShareFile[] = [];
  const entries = clips.map((clip, index) => {
    const position = index + 1;
    const thumb = thumbnailPath(clip.path);
    const focus = clip.focus && clip.focus.status === 'ready' ? clip.focus.file : undefined;
    const ball = readyBallFile(clip);
    const hasThumb = files.exists(thumb);
    const hasFocus = focus !== undefined && files.exists(focus);
    const hasBall = ball !== undefined && files.exists(ball);
    local.push({ kind: 'video', position, path: clip.path });
    if (hasThumb) local.push({ kind: 'thumb', position, path: thumb });
    if (focus !== undefined && hasFocus) local.push({ kind: 'focus', position, path: focus });
    if (ball !== undefined && hasBall) local.push({ kind: 'ball', position, path: ball });
    return {
      position,
      bytes: Math.max(1, files.sizeBytes(clip.path)),
      durationMs: Math.max(1, Math.round(clip.durationMs)),
      edit: {
        number: clipNumber(clip, index),
        name: clip.name,
        createdAt: clip.createdAt,
        source: clip.source,
        trim: clip.trim,
        bounds: clip.bounds,
        contentStartMs: clip.contentStartMs,
        shortSide: clip.shortSide,
        edit: clip.edit,
        focus: hasFocus && clip.focus ? { startMs: clip.focus.startMs, endMs: clip.focus.endMs } : undefined,
        ball: hasBall && clip.ball ? { startMs: clip.ball.startMs, endMs: clip.ball.endMs, sport: clip.ball.sport, rules: clip.ball.rules } : undefined,
      },
      hasThumb,
      hasFocus,
      hasBall,
    };
  });
  const title = session.name ? session.name : undefined;
  const sport = session.ballSport && session.ballSport.sport ? session.ballSport.sport : undefined;
  return { input: { kind: 'recording', title, sport, cover: true, clips: entries }, local };
}

/**
 * The background upload items: each presigned URL paired with its file on the phone. The cover's uploads are kept with
 * an empty path until the cover is made (`attachCover`); any other upload without a file is left out.
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
