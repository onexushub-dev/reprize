import { type Directory, File } from 'expo-file-system';
import { AppState } from 'react-native';

import { createThumbnail, exportClip } from '../../modules/replay-camera';
import { repo } from '../data/mmkv';
import { diag } from '../diag/diagLog';
import { clipShapeOf, type ClipJob } from '../share/clipExport';
import { uploadQueue } from './appUploadQueue';
import { exportCover } from './cover';
import { attachCover, coverPending } from './shareInput';
import { saveUploadPlan, shareFilesDir, uploadPlan } from './uploadPlan';

const running = new Set<string>();

/** Moves a made file into the share's own folder (the exports cache is emptied at launch). Returns its new path. */
async function keep(path: string, dir: Directory, name: string): Promise<string> {
  const dest = new File(dir, name);
  if (dest.exists) dest.delete();
  const source = new File(`file://${path}`);
  await source.copy(dest);
  try {
    source.delete();
  } catch {
    // the copy is what counts
  }
  return decodeURIComponent(dest.uri.replace(/^file:\/\//, ''));
}

/**
 * Makes the cover of the recording's live link if its plan still waits for it, then hands it to the upload queue. Runs
 * on the share sheet, which draws the app mark (`capture`); a sheet closed too early leaves it for the next opening.
 */
export async function ensureCover(
  sessionId: string,
  capture: (job: Pick<ClipJob, 'frame' | 'layout' | 'watermark'>) => Promise<string>,
  again = true,
): Promise<void> {
  const session = repo.getSession(sessionId);
  const shared = session ? session.shared : undefined;
  if (shared === undefined || shared.state !== 'active' || running.has(shared.shareId)) return;
  const plan = uploadPlan(shared.shareId);
  if (plan === undefined || !coverPending(plan.items)) return;
  const clips = repo.listClips(sessionId);
  if (clips.length === 0) return;
  running.add(shared.shareId);
  let failed = false;
  try {
    const made = await exportCover(clips[0], {
      shapeOf: clipShapeOf,
      capture,
      exportClip,
      still: createThumbnail,
    });
    const dir = shareFilesDir(shared.shareId);
    dir.create({ intermediates: true, idempotent: true });
    const cover = { video: await keep(made.video, dir, 'cover.mp4'), image: await keep(made.image, dir, 'cover.jpg') };
    // Read again: the plan may have been forgotten (link turned off) while the cover was made.
    const now = uploadPlan(shared.shareId);
    if (now === undefined) return;
    saveUploadPlan(shared.shareId, { ...now, items: attachCover(now.items, cover) });
    diag('envio: capa pronta');
    uploadQueue.sync();
  } catch (e) {
    diag(`envio: capa FALHOU (${e instanceof Error ? e.message : String(e)})`);
    failed = true;
  } finally {
    running.delete(shared.shareId);
  }
  // Stopped by iOS while the app was away, and reported only once it was back: the return to the front has already
  // passed, so make it again now.
  if (failed && again && AppState.currentState === 'active') await ensureCover(sessionId, capture, false);
}
