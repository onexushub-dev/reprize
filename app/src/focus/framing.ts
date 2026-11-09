import type { FocusTrack } from '../data/focusFile';
import type { Zoom } from '../share/editing';

/**
 * The Modo Foco framing at clip time `tMs`, as the editor's zoom: linear between the two nearest keyframes, the nearest one
 * held outside the track. The track has the video's own shape, so one scale fits both sides. Seguir a Bola's 9:16 track
 * (`fit` 'height') is shown in a picture as tall as the 9:16 box: its scale is by the height.
 */
export function framingAt(track: FocusTrack, tMs: number, fit: 'width' | 'height' = 'width'): Zoom {
  const { rects } = track;
  const pos = (tMs - track.startMs) / track.stepMs;
  let rect = rects[0];
  if (pos >= rects.length - 1) rect = rects[rects.length - 1];
  else if (pos > 0) {
    const i = Math.floor(pos);
    const f = pos - i;
    const a = rects[i];
    const b = rects[i + 1];
    rect = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
  }
  const [x, y, width, height] = rect;
  return { scale: 1 / (fit === 'height' ? height : width), cx: x + width / 2, cy: y + height / 2 };
}
