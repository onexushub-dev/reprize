import { Image } from 'expo-image';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Clip, TriggerSource } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { seconds, timeOfDay } from './format';
import { CheckIcon, MicIcon, PhoneIcon, RemoteIcon, TapIcon, WatchIcon, WaveIcon } from './icons';
import { sourceLabel } from './sourceLabel';
import { useClipThumbnail } from './useClipThumbnail';

type Props = {
  clip: Clip;
  number: number;
  onPress: () => void;
  onLongPress?: () => void;
  /** Picking clips to delete: the card shows a check circle and is dimmed until picked. */
  selecting?: boolean;
  selected?: boolean;
  /** Its label as a chip to tap ("+ Etiqueta" without one), opening the label sheet (2026-11-07 spec §6). */
  onLabel?: () => void;
};

/** How the clip was saved, as a small accent icon. */
function SourceIcon({ source }: { source: TriggerSource }) {
  const color = colors.accent;
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

export function ClipCard({ clip, number, onPress, onLongPress, selecting = false, selected = false, onLabel }: Props) {
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
      style={[styles.card, selecting && !selected && styles.unpicked]}>
      {/* Top strip: the label (who or what), or "+ Etiqueta" (option C, 2026-11-07). */}
      {onLabel !== undefined && !selecting ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            clip.name ? t('summary.labelA11y', { number, label: clip.name }) : t('summary.addLabelA11y', { number })
          }
          onPress={onLabel}
          style={styles.strip}>
          <Text style={clip.name ? styles.labelText : styles.addText} numberOfLines={1}>
            {clip.name ? clip.name : t('summary.addLabel')}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.strip}>
          <Text style={styles.labelText} numberOfLines={1}>
            {clip.name ? clip.name : ' '}
          </Text>
        </View>
      )}
      <View style={styles.thumb}>
        {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <View style={[styles.tag, { left: 8, top: 8 }]}>
          <Text style={styles.tagText}>{`#${number}`}</Text>
        </View>
        {selecting ? null : (
          <View style={[styles.tag, { right: 8, top: 8 }]}>
            <Text style={styles.timeText}>{timeOfDay(clip.createdAt, locale)}</Text>
          </View>
        )}
        <View style={[styles.tag, { right: 8, bottom: 8 }]}>
          <Text style={styles.tagText}>{duration}</Text>
        </View>
        {clip.savedAt || clip.sharedAt ? (
          <View style={[styles.tag, styles.done, { left: 8, bottom: 8 }]}>
            <CheckIcon color={colors.accent} size={12} />
            <Text style={styles.tagText}>{clip.savedAt ? t('summary.savedTag') : t('summary.sharedTag')}</Text>
          </View>
        ) : null}
        {selecting ? (
          <View style={[styles.check, selected && styles.checkOn]}>{selected ? <CheckIcon size={16} /> : null}</View>
        ) : null}
      </View>
      {/* Bottom strip: only how it was saved, centred. */}
      <View style={styles.source}>
        <SourceIcon source={clip.source} />
        <Text style={styles.sourceText} numberOfLines={1}>
          {sourceLabel(clip.source, locale)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  strip: { height: 36, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  labelText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text, textAlign: 'center' },
  addText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent, textAlign: 'center' },
  thumb: { height: 120, backgroundColor: colors.ground },
  tag: {
    position: 'absolute',
    backgroundColor: 'rgba(12,12,12,0.85)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.text },
  timeText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.text },
  unpicked: { opacity: 0.6 },
  check: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: 'rgba(12,12,12,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  source: { height: 34, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sourceText: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 12, color: colors.soft },
});
