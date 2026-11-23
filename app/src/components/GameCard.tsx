import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { receivedVideoPath } from '../cloud/receivedPaths';
import type { Clip, Session } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { CheckIcon, ChevronIcon, DownloadIcon } from './icons';
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
  // A received recording not downloaded yet shows the still of its first clip, downloaded on its own (§5.4).
  const waiting = firstClip === undefined && session.received !== undefined;
  const previewPath =
    firstClip !== undefined ? firstClip.path : session.received !== undefined ? receivedVideoPath(session.received.shareId, 1) : '';
  const thumb = useClipThumbnail(previewPath, firstClip !== undefined ? firstClip.trim.startMs : 0);
  const { t, locale } = useT();
  const label = sessionLabel(session, undefined, locale);
  // A received recording was not recorded on this phone: its time comes with the link (2026-11-20); older links have none.
  const clipCount = t('summary.clips', { count: waiting && session.received !== undefined ? session.received.total : clips });
  const time = session.received !== undefined ? session.received.recordedMs : recordedMs;
  const detail = time === undefined ? clipCount : t('games.detail', { clips: clipCount, time: recordedLabel(time, locale) });
  const sharing = session.shared !== undefined && session.shared.state === 'active' && session.shared.expiresAt > now;
  const receivedBadge = session.received
    ? session.received.from
      ? t('games.sharedBy', { name: session.received.from })
      : t('games.sharedByUnknown')
    : undefined;
  const hasBadges = lastSeen || sharing || receivedBadge !== undefined;
  const spoken = [
    label,
    detail,
    receivedBadge,
    waiting ? t('games.notDownloaded') : undefined,
    sharing ? t('games.sharing') : undefined,
    lastSeen ? t('games.lastSeen') : undefined,
  ]
    .filter((p): p is string => p !== undefined)
    .join(', ');
  const a11y = selecting ? t(selected ? 'games.selectedA11y' : 'games.notSelectedA11y', { label: spoken }) : spoken;
  // As on the clip tiles: a hold that starts the selection ends with the finger lifting, and by then this card already
  // counts as picked; that release must not count as a tap, which would unpick it at once (2026-11-20).
  const held = useRef(false);
  // The badges sit over the card (the Compartilhando one is its own button), so the text column keeps room for them.
  // When they wrap onto a second line (a long "Compartilhada por" name with Visto por último), that room grows with
  // them instead of the badges climbing over the clips and time (2026-11-22).
  const [badgeHeight, setBadgeHeight] = useState(BADGE_ROW);
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
          {/* Not downloaded yet (2026-11-22): the frame dimmed with the download mark, as on the recording's grid, instead
              of one more badge beside "Visto por último". Said in words to VoiceOver. */}
          {waiting ? (
            <View style={styles.notDownloaded} testID="not-downloaded">
              <DownloadIcon color={colors.text} size={20} />
            </View>
          ) : null}
        </View>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.detail}>{detail}</Text>
          {hasBadges ? <View style={{ height: badgeHeight + BADGE_GAP }} testID="badge-space" /> : null}
        </View>
        {selecting ? null : <ChevronIcon size={18} color={colors.muted} />}
      </Pressable>
      {hasBadges ? (
        <View
          style={[styles.badges, { left: selecting ? 146 : 110, right: selecting ? 10 : 40 }]}
          pointerEvents="box-none"
          testID="badges"
          onLayout={(e) => {
            const height = Math.ceil(e.nativeEvent.layout.height);
            if (height > 0 && height !== badgeHeight) setBadgeHeight(height);
          }}>
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
          {/* Always the last badge (2026-11-22): it only says which recording was opened last. */}
          {lastSeen ? (
            <View style={[styles.badge, styles.badgeSeen]} testID="badge-last-seen">
              <Text style={[styles.badgeText, { color: colors.soft }]}>{t('games.lastSeen')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One line of badges, and the space above it. */
const BADGE_ROW = 22;
const BADGE_GAP = 4;

const styles = StyleSheet.create({
  // The whole card takes the tap, its margin too (2026-11-22: the margin around the round check missed taps, which had
  // to land right on it or on the recording).
  // Floating cards (2026-11-22): a fine light edge and a soft shadow keep each recording apart on the dark ground.
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  main: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10 },
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
  notDownloaded: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,10,0.45)',
  },
  text: { flex: 1, minWidth: 0, gap: 3 },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  badges: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 8, borderRadius: 6 },
  badgeSeen: { backgroundColor: colors.border },
  badgeSharing: { backgroundColor: 'rgba(255,176,0,0.14)' },
  badgeReceived: { maxWidth: '100%', backgroundColor: colors.receivedGround },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
});
