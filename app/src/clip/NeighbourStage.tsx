import { Image as ExpoImage } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { knownShape, rememberShape } from '../components/clipShape';
import { useClipThumbnail } from '../components/useClipThumbnail';
import { readyBallFile } from '../data/ballFile';
import { readFocusFile } from '../data/focusFile';
import type { Clip } from '../data/schema';
import { readEdit, turnedSize } from '../share/editing';
import { ShareOverlay } from '../share/ShareOverlay';
import { colors } from '../theme/tokens';
import { ballContent, clipStage, openingZoom, pictureTransform, previewBox, turned } from './stage';

/** Neighbours are measured this long after the open clip, so they never hold it up. */
const NEIGHBOUR_WAIT_MS = 300;

type Props = {
  clip: { path?: string; trim?: Clip['trim']; edit?: Clip['edit']; focus?: Clip['focus']; ball?: Clip['ball'] };
  tier: Parameters<typeof clipStage>[0];
  area: { width: number; height: number };
};

/**
 * A neighbouring clip as it will look the moment it opens: its first frame in its own frame, with Modo Foco's framing (or
 * its zoom by hand), turned, with the app mark. A still, so a swipe costs no extra video playing.
 */
export function NeighbourStage({ clip, tier, area }: Props) {
  const path = clip.path || '';
  const startMs = clip.trim ? clip.trim.startMs : 0;
  const uri = useClipThumbnail(path, startMs);
  const [size, setSize] = useState(() => knownShape(path));
  // Its shape too, so that if the swipe lands there the screen opens laid out, with Salvar/Enviar ready.
  useEffect(() => {
    if (!uri || !path || size) return;
    // After the open clip has had its turn: this one only matters if the finger goes there.
    const timer = setTimeout(() => {
      Image.getSize(uri)
        .then(({ width, height }) => {
          rememberShape(path, { width, height });
          setSize({ width, height });
        })
        .catch(() => {});
    }, NEIGHBOUR_WAIT_MS);
    return () => clearTimeout(timer);
  }, [uri, path, size]);

  const focusFile = clip.focus && clip.focus.status === 'ready' ? clip.focus.file : undefined;
  const rotation = readEdit(clip.edit).rotation;
  const landscape = size ? turnedSize(size, rotation).width > turnedSize(size, rotation).height : false;
  const track = useMemo(
    () => (focusFile && size ? readFocusFile(focusFile, landscape ? 'landscape' : 'portrait') : undefined),
    [focusFile, size, landscape],
  );
  const ballFile = clip.trim ? readyBallFile({ ball: clip.ball, trim: clip.trim }) : undefined;
  const ballTrack = useMemo(() => (ballFile && size ? readFocusFile(ballFile, 'portrait') : undefined), [ballFile, size]);

  if (!uri) return null;
  if (!size || !clip.trim) return <ExpoImage source={{ uri }} contentFit="contain" style={StyleSheet.absoluteFill} />;

  const stage = clipStage(tier, clip.edit, clip.trim, size, track ? focusFile : undefined, undefined, undefined, ballTrack ? ballFile : undefined);
  const { frame, layout } = stage.preview;
  const box = previewBox(frame, layout, area);
  const zoom = openingZoom(clip.edit, track, startMs, stage.ball ? ballTrack : undefined);
  // Seguir a Bola: the still at its own shape, as tall as the 9:16 box, moved to the ball.
  const content = stage.ball ? ballContent(stage.shape, box.video) : box.video;
  const place = stage.ball
    ? { position: 'absolute' as const, left: (box.video.width - content.width) / 2, top: 0, width: content.width, height: content.height }
    : StyleSheet.absoluteFill;
  return (
    <View style={[styles.preview, { width: box.width, height: box.height }]}>
      <View style={[styles.box, box.video]}>
        <View testID="neighbour-picture" style={[place, { transform: pictureTransform(zoom, content) }]}>
          <ExpoImage source={{ uri }} contentFit="contain" style={turned(content, rotation)} />
        </View>
      </View>
      <View style={StyleSheet.absoluteFill}>
        <ShareOverlay frame={frame} layout={layout} scale={box.scale} watermark={stage.watermark} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { overflow: 'hidden', backgroundColor: colors.ground },
  box: { position: 'absolute', overflow: 'hidden' },
});
