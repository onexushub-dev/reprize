import { Image } from 'react-native';

import { createThumbnail } from '../../modules/replay-camera';
import { clipStage } from '../clip/stage';
import { knownShape, rememberShape } from '../components/clipShape';
import { readyBallFile } from '../data/ballFile';
import { readFocusFile } from '../data/focusFile';
import type { Clip } from '../data/schema';
import { readEdit, turnedSize } from './editing';
import type { ExportOptions } from './exportOptions';
import type { ShortSide } from './exportSize';

export type Orientation = 'portrait' | 'landscape';
type Size = { width: number; height: number };
type Tier = Parameters<typeof clipStage>[0];

export type ClipJob = {
  options: ExportOptions;
  frame: Size;
  layout: ReturnType<typeof clipStage>['layout'];
  /** The same key means the same exported file: the clip, every edit, the frame and the plan's mark. */
  key: string;
  watermark: boolean;
  /** What the app shows: the export's frame, or Seguir a Bola's vertical frame (also on a free plan). */
  preview: ReturnType<typeof clipStage>['preview'];
  /** Seguir a Bola is what the preview shows. */
  ball: boolean;
};

/**
 * One clip's export, as the clip screen, the batch and the compilation all make it. `orientation` forces the frame
 * (a compilation has one); without it the clip's own shape decides. `trackFound` is for a caller that already read the
 * Modo Foco framing (the clip screen), so the file is not read on every render.
 */
export function clipExportJob(
  clip: Clip,
  plan: Tier,
  videoSize: Size,
  orientation?: Orientation,
  trackFound?: boolean,
  side?: ShortSide,
  /** As `trackFound`, for Seguir a Bola's file of the current cut. */
  ballFound?: boolean,
): ClipJob {
  const shape = turnedSize(videoSize, readEdit(clip.edit).rotation);
  const landscape = orientation ? orientation === 'landscape' : shape.width > shape.height;
  const file = clip.focus && clip.focus.status === 'ready' ? clip.focus.file : undefined;
  const found =
    file !== undefined && (trackFound !== undefined ? trackFound : readFocusFile(file, landscape ? 'landscape' : 'portrait') !== undefined);
  const ballFile = readyBallFile(clip);
  const ballOk =
    ballFile !== undefined && (ballFound !== undefined ? ballFound : readFocusFile(ballFile, 'portrait') !== undefined);
  // A forced frame is passed as the shape the stage lays out in; the video still keeps its own shape inside it.
  const stage = clipStage(
    plan,
    clip.edit,
    clip.trim,
    videoSize,
    found ? file : undefined,
    orientation ? landscape : undefined,
    side,
    ballOk ? ballFile : undefined,
  );
  const options = stage.options;
  return {
    options,
    frame: stage.frame,
    layout: stage.layout,
    key: JSON.stringify([clip.path, options, stage.layout]),
    watermark: options.watermark,
    preview: stage.preview,
    ball: stage.ball,
  };
}

/** The compilation's frame: the orientation most clips have, a tie going to the first clip's. `shapes` are as turned. */
export function compilationOrientation(shapes: Size[]): Orientation {
  const wide = shapes.filter((s) => s.width > s.height).length;
  const tall = shapes.length - wide;
  if (wide !== tall) return wide > tall ? 'landscape' : 'portrait';
  const first = shapes[0];
  return first !== undefined && first.width > first.height ? 'landscape' : 'portrait';
}

/** A clip's picture size: already known, or measured from its thumbnail (and remembered). */
export async function clipShapeOf(clip: Clip): Promise<Size> {
  const known = knownShape(clip.path);
  if (known) return known;
  const thumb = await createThumbnail(clip.path, clip.trim.startMs);
  const size = await Image.getSize(`file://${thumb}`);
  const shape = { width: size.width, height: size.height };
  rememberShape(clip.path, shape);
  return shape;
}
