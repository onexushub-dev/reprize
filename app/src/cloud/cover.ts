import type { ExportClipOptions, ExportedClip } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { Clip } from '../data/schema';
import { clipExportJob, type ClipJob } from '../share/clipExport';
import { colors } from '../theme/tokens';

type Size = { width: number; height: number };

export type CoverDeps = {
  shapeOf: (clip: Clip) => Promise<Size>;
  /** Draws and captures the app mark for a look (`useOverlayCapturer`). */
  capture: (job: Pick<ClipJob, 'frame' | 'layout' | 'watermark'>) => Promise<string>;
  exportClip: (options: ExportClipOptions) => Promise<ExportedClip>;
  /** A still of a video at this time (the native thumbnail, 640 px at most). */
  still: (videoPath: string, atMs: number) => Promise<string>;
};

/**
 * The web page's preview of a share (sharing design, decision 6): the first clip as the free plan exports it, with the
 * app mark and never with sound, plus a still of it for the social preview. Test builds with the field-test unlock
 * export at their unlocked quality; the mark and the silence stay.
 */
export async function exportCover(clip: Clip, deps: CoverDeps): Promise<{ video: string; image: string }> {
  const shape = await deps.shapeOf(clip);
  const job = clipExportJob(clip, 'free', shape);
  const overlayPngPath = await deps.capture(job);
  const made = await deps.exportClip({
    clipPath: clip.path,
    ...job.options,
    muted: true,
    overlayPngPath,
    background: colors.ground,
  });
  const image = await deps.still(made.path, Math.min(1000, Math.max(0, made.durationMs / 2)));
  return { video: made.path, image };
}
