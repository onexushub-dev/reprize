import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Clip, Session } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { CheckIcon, ChevronIcon } from './icons';
import { recordedLabel, sessionLabel } from './format';
import { useClipThumbnail } from './useClipThumbnail';

type Props = {
  session: Session;
  clips: number;
  firstClip?: Clip;
  recordedMs: number;
  onPress: () => void;
  onLongPress?: () => void;
  /** The recording opened last: a "Visto por último" badge. */
  lastSeen?: boolean;
  /** Picking recordings to delete: a circle, filled on the picked ones. */
  selecting?: boolean;
  selected?: boolean;
  /** Now, for whether its link is still live. */
  now: number;
};

/**
 * One recording in Gravações: first clip's frame, name (or sport + date), clips and time, and a line of badges under
 * them (2026-11-20): Visto por último, Compartilhando (a tap opens the share sheet) and Compartilhado por on a received
 * one.
 */
export function GameCard({
  session,
  clips,
  firstClip,
  recordedMs,
  onPress,
  onLongPress,
  lastSeen = false,
  selecting = false,
  selected = false,
  now,
}: Props) {
  const thumb = useClipThumbnail(firstClip?.path ?? '', firstClip?.trim.startMs ?? 0);
  const { t, locale } = useT();
  const label = sessionLabel(session, undefined, locale);
  // A received recording was not recorded on this phone: its time comes with the link (2026-11-20); older links have none.
  const clipCount = t('summary.clips', { count: clips });
  const time = session.received !== undefined ? session.received.recordedMs : recordedMs;
  const detail = time === undefined ? clipCount : t('games.detail', { clips: clipCount, time: recordedLabel(time, locale) });
  const sharing = session.shared !== undefined && session.shared.state === 'active' && session.shared.expiresAt > now;
  const receivedBadge = session.received
    ? session.received.from
      ? t('games.sharedBy', { name: session.received.from })
      : t('games.sharedByUnknown')
    : undefined;
  const hasBadges = lastSeen || sharing || receivedBadge !== undefined;
  const spoken = [label, detail, lastSeen ? t('games.lastSeen') : undefined, receivedBadge, sharing ? t('games.sharing') : undefined]
    .filter((p): p is string => p !== undefined)
    .join(', ');
  const a11y = selecting ? t(selected ? 'games.selectedA11y' : 'games.notSelectedA11y', { label: spoken }) : spoken;
  // As on the clip tiles: a hold that starts the selection ends with the finger lifting, and by then this card already
  // counts as picked; that release must not count as a tap, which would unpick it at once (2026-11-20).
  const held = useRef(false);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
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
        accessibilityActions={onLongPress ? [{ name: 'longpress', label: t('games.select') }] : undefined}
        onAccessibilityAction={onLongPress ? () => onLongPress() : undefined}
        style={styles.main}>
        {selecting ? (
          <View style={[styles.check, selected && styles.checkOn]}>{selected ? <CheckIcon size={14} /> : null}</View>
        ) : null}
        <View style={styles.thumb}>
          {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        </View>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.detail}>{detail}</Text>
          {hasBadges ? <View style={styles.badgeSpace} /> : null}
        </View>
        {selecting ? null : <ChevronIcon size={18} color={colors.muted} />}
      </Pressable>
      {hasBadges ? (
        <View style={[styles.badges, { left: selecting ? 146 : 110, right: selecting ? 10 : 40 }]} pointerEvents="box-none">
          {lastSeen ? (
            <View style={[styles.badge, styles.badgeSeen]}>
              <Text style={[styles.badgeText, { color: colors.soft }]}>{t('games.lastSeen')}</Text>
            </View>
          ) : null}
          {sharing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('games.sharingA11y', { name: label })}
              disabled={selecting}
              hitSlop={6}
              onPress={() => router.push(`/share/${session.id}`)}
              style={[styles.badge, styles.badgeSharing]}>
              <View style={styles.liveDot} />
              <Text style={[styles.badgeText, { color: colors.accent }]}>{t('games.sharing')}</Text>
              {selecting ? null : <ChevronIcon size={12} color={colors.accent} />}
            </Pressable>
          ) : null}
          {receivedBadge !== undefined ? (
            <View style={[styles.badge, styles.badgeReceived]}>
              <Text style={[styles.badgeText, { color: colors.received }]} numberOfLines={1}>
                {receivedBadge}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 10 },
  main: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  thumb: { width: 88, height: 60, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border },
  text: { flex: 1, minWidth: 0, gap: 3 },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  badgeSpace: { height: 26 },
  badges: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 8, borderRadius: 6 },
  badgeSeen: { backgroundColor: colors.border },
  badgeSharing: { backgroundColor: 'rgba(255,176,0,0.14)' },
  badgeReceived: { maxWidth: '100%', backgroundColor: colors.receivedGround },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
});
