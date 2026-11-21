import { Image } from 'expo-image';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Clip, TriggerSource } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { seconds } from './format';
import { CheckIcon, DownloadIcon, MicIcon, PhoneIcon, RemoteIcon, TagIcon, TapIcon, WatchIcon, WaveIcon } from './icons';
import { sourceLabel } from './sourceLabel';
import { useClipThumbnail } from './useClipThumbnail';

type Props = {
  clip: Clip;
  number: number;
  /** The tile's width: three to a row, edge to edge. */
  width: number;
  onPress: () => void;
  onLongPress?: () => void;
  /** Picking clips: every tile shows a circle, filled on the picked ones. */
  selecting?: boolean;
  selected?: boolean;
};

/** How the clip was saved, as a small white icon. */
function SourceIcon({ source }: { source: TriggerSource }) {
  const color = colors.text;
  switch (source) {
    case 'gesture':
      return <WaveIcon color={color} size={14} />;
    case 'remote':
      return <RemoteIcon color={color} size={14} />;
    case 'voice':
      return <MicIcon color={color} size={14} />;
    case 'watch':
      return <WatchIcon color={color} size={14} />;
    case 'phone':
      return <PhoneIcon color={color} size={14} />;
    default:
      return <TapIcon color={color} size={14} />;
  }
}

/** Tiles are a little taller than wide, like the Photos grid with portrait videos. */
export const TILE_RATIO = 4 / 3;

/**
 * One clip of a recording, as in the Photos grid (2026-11-20): the frame edge to edge, the clip's number at the top left,
 * its label (etiqueta) at the top right, how it was saved (and a check once it went to the gallery or was sent) at the
 * bottom left, its length at the bottom right.
 */
export function ClipCard({ clip, number, width, onPress, onLongPress, selecting = false, selected = false }: Props) {
  const { t, locale } = useT();
  const thumb = useClipThumbnail(clip.path, clip.trim.startMs);
  const duration = seconds(clip.trim.endMs - clip.trim.startMs);
  const base = t('summary.clipA11y', {
    number,
    name: clip.name ? ` · ${clip.name}` : '',
    duration,
    source: sourceLabel(clip.source, locale),
  });
  const sent = clip.savedAt ? t('summary.savedA11y', { label: base }) : clip.sharedAt ? t('summary.sharedA11y', { label: base }) : base;
  const label = selecting ? t(selected ? 'summary.selectedA11y' : 'summary.notSelectedA11y', { label: sent }) : sent;
  // A hold that starts the selection ends with the finger lifting, and by then this card already counts as picked:
  // that release must not count as a tap, which would unpick it at once.
  const held = useRef(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selecting ? { checked: selected } : undefined}
      onPressIn={() => {
        held.current = false;
      }}
      onPress={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onPress();
      }}
      onLongPress={
        onLongPress
          ? () => {
              held.current = true;
              onLongPress();
            }
          : undefined
      }
      style={[styles.tile, { width, height: Math.round(width * TILE_RATIO) }]}>
      {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <Text style={styles.number}>{number}</Text>
      {clip.name ? (
        <View style={styles.label}>
          <TagIcon color={colors.accent} size={11} />
          <Text style={styles.labelText} numberOfLines={1}>
            {clip.name}
          </Text>
        </View>
      ) : null}
      <View style={styles.shade} />
      <View style={styles.bottomLeft}>
        <SourceIcon source={clip.source} />
        {clip.savedAt || clip.sharedAt ? <CheckIcon color={colors.accent} size={13} /> : null}
      </View>
      {selecting ? (
        <View style={[styles.check, selected && styles.checkOn]}>{selected ? <CheckIcon size={13} /> : null}</View>
      ) : (
        <Text style={styles.duration}>{duration}</Text>
      )}
    </Pressable>
  );
}

/**
 * A clip of a received recording that has not arrived yet, in the same grid: its number, "Baixando" on the one coming
 * now and "Na fila" on the others.
 */
export function PendingClipTile({ number, width, downloading }: { number: number; width: number; downloading: boolean }) {
  const { t } = useT();
  return (
    <View
      accessible
      accessibilityLabel={t('summary.pendingA11y', { number })}
      style={[styles.tile, styles.pending, { width, height: Math.round(width * TILE_RATIO) }]}>
      <Text style={[styles.number, styles.pendingNumber]}>{number}</Text>
      <DownloadIcon color={colors.muted} size={20} />
      <Text style={styles.pendingText}>{downloading ? t('summary.downloading') : t('summary.pending')}</Text>
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 };

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.surface, overflow: 'hidden' },
  number: { position: 'absolute', top: 5, left: 7, fontFamily: fonts.display, fontSize: 18, color: colors.text, ...shadow },
  label: {
    position: 'absolute',
    top: 6,
    right: 6,
    maxWidth: '64%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingLeft: 6,
    paddingRight: 7,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(10,10,10,0.62)',
  },
  labelText: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 11, color: colors.text },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 34, backgroundColor: 'rgba(0,0,0,0.35)' },
  bottomLeft: { position: 'absolute', left: 7, bottom: 7, flexDirection: 'row', alignItems: 'center', gap: 4 },
  duration: { position: 'absolute', right: 7, bottom: 6, fontFamily: fonts.bodyBold, fontSize: 12, color: colors.text, ...shadow },
  check: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent },
  pending: { alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface },
  pendingNumber: { color: colors.muted },
  pendingText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.muted },
});
