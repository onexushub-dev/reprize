import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Clip, Session } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { TrashIcon } from './icons';
import { recordedLabel, sessionLabel } from './format';
import { useClipThumbnail } from './useClipThumbnail';

type Props = {
  session: Session;
  clips: number;
  firstClip?: Clip;
  recordedMs: number;
  onPress: () => void;
  onLongPress?: () => void;
  onDelete?: () => void;
  /** The recording opened last: a "Visto por último" badge. */
  lastSeen?: boolean;
};

/** One past game in "My recordings": first lance's frame, name (or sport + date), lances and time. */
export function GameCard({ session, clips, firstClip, recordedMs, onPress, onLongPress, onDelete, lastSeen = false }: Props) {
  const thumb = useClipThumbnail(firstClip?.path ?? '', firstClip?.trim.startMs ?? 0);
  const { t, locale } = useT();
  const label = sessionLabel(session, undefined, locale);
  const detail = t('games.detail', { clips: t('summary.clips', { count: clips }), time: recordedLabel(recordedMs, locale) });
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={lastSeen ? `${label}, ${detail}, ${t('games.lastSeen')}` : `${label}, ${detail}`}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityActions={onLongPress ? [{ name: 'longpress', label: t('games.deleteRecording') }] : undefined}
        onAccessibilityAction={onLongPress ? () => onLongPress() : undefined}
        style={styles.main}>
        <View style={styles.thumb}>
          {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        </View>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={2}>
            {label}
          </Text>
          <Text style={styles.detail}>{detail}</Text>
          {lastSeen ? (
            <View style={styles.seen}>
              <Text style={styles.seenText}>{t('games.lastSeen')}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {onDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('games.deleteRecordingNamed', { name: label })}
          hitSlop={6}
          onPress={onDelete}
          style={styles.trash}>
          <TrashIcon color={colors.rec} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 10,
    gap: 4,
  },
  main: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center' },
  trash: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 96, height: 64, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.border },
  text: { flex: 1, gap: 4 },
  label: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.soft },
  seen: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: colors.accent },
  seenText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.onAccent },
});
