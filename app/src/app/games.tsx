import { router } from 'expo-router';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickBar } from '../components/SelectionBar';
import { Chip } from '../components/Chip';
import { GameCard } from '../components/GameCard';
import { EmptyState } from '../components/EmptyState';
import { dayTitle } from '../components/format';
import { DateFilterSheet } from '../components/DateFilterSheet';
import { BackIcon, CalendarIcon, CloseIcon, LinkShareIcon, ReplayIcon, TrashIcon } from '../components/icons';
import { lastOpenedSession, subscribeLastOpened } from '../data/lastOpened';
import { removeFile, repo } from '../data/mmkv';
import { useT } from '../i18n/useT';
import { SHARING_ENABLED } from '../account/flags';
import { track } from '../analytics';
import { openPaywall } from '../payments/feedback';
import { canShare } from '../payments/limits';
import { useProActive } from '../share/entitlement';
import { colors, fonts, footer } from '../theme/tokens';

type Filter = 'all' | 'mine' | 'received';

/**
 * Gravações: past recordings with at least one clip, newest first, under the day they were made. Once a recording has
 * been received, a filter tells them apart. Selecionar picks several to delete at once (2026-11-20).
 */
export default function Games() {
  const { t, locale } = useT();
  const version = useSyncExternalStore(repo.subscribe, repo.version);
  // The recording seen last: this list repaints the moment one opens (it stays mounted underneath).
  const lastSeenId = useSyncExternalStore(subscribeLastOpened, lastOpenedSession);
  const games = useMemo(
    () =>
      repo.listSessions().map((g) => ({
        ...g,
        recordedMs: repo.sessionStats(g.session.id).recordedMs,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
    [version],
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const hasReceived = games.some((g) => g.session.received !== undefined);
  const byKind = !hasReceived || filter === 'all' ? games : games.filter((g) => (g.session.received !== undefined) === (filter === 'received'));
  // Filtrar por data: one day at a time, picked on a calendar (the days with recordings shown can be picked).
  const [day, setDay] = useState<string | undefined>(undefined);
  const [pickingDay, setPickingDay] = useState(false);
  const dayKey = (at: number) => new Date(at).toDateString();
  const shown = day === undefined ? byKind : byKind.filter((g) => dayKey(g.session.startedAt) === day);
  // The clock for which links are still live and which day is today, read again every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  const sections = useMemo(() => {
    const out: { title: string; data: typeof shown }[] = [];
    for (const game of shown) {
      const title = dayTitle(game.session.startedAt, now, locale, { today: t('games.today'), yesterday: t('games.yesterday') });
      const last = out[out.length - 1];
      if (last && last.title === title) last.data.push(game);
      else out.push({ title, data: [game] });
    }
    return out;
  }, [shown, now, locale, t]);
  const days = useMemo(() => {
    const out: { key: string; at: number; title: string; count: number }[] = [];
    for (const game of byKind) {
      const key = dayKey(game.session.startedAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.count += 1;
      else
        out.push({
          key,
          at: game.session.startedAt,
          title: dayTitle(game.session.startedAt, now, locale, { today: t('games.today'), yesterday: t('games.yesterday') }),
          count: 1,
        });
    }
    return out;
  }, [byKind, now, locale, t]);
  const dayShown = day === undefined ? undefined : days.find((d) => d.key === day);
  // A recording still being recorded has no end yet: it is never offered for deleting.
  const pickedGames = games.filter((g) => picked.includes(g.session.id) && g.session.endedAt !== undefined);

  const stopSelecting = () => {
    setSelecting(false);
    setPicked([]);
  };
  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((p) => p !== id) : [...current, id]));
  // "Todos" picks every recording shown (the filter and the day apply) that has ended; "Limpar" once they all are.
  const pickable = shown.filter((g) => g.session.endedAt !== undefined).map((g) => g.session.id);
  const allPicked = pickable.length > 0 && pickable.every((id) => picked.includes(id));
  const pickAll = () => setPicked(allPicked ? [] : pickable);

  // Compartilhar (2026-11-22): one recording by link, as from its "…" (several at once comes later). Only a recording
  // made here, ended, with clips; on the free plan the paywall first.
  const shareAllowed = canShare(useProActive() ? 'paid' : 'free');
  const toShare = pickedGames.length === 1 ? pickedGames[0] : undefined;
  const shareable = toShare !== undefined && toShare.session.received === undefined && toShare.clips > 0;
  async function shareRecording() {
    if (toShare === undefined) return;
    if (!shareAllowed) {
      track('pro_feature_blocked', { feature: 'share' });
      const outcome = await openPaywall(t, 'locked_feature');
      if (outcome !== 'purchased' && outcome !== 'restored') return;
    }
    stopSelecting();
    router.push(`/share/${toShare.session.id}`);
  }

  const confirmDelete = () => {
    const count = pickedGames.length;
    if (count === 0) return;
    Alert.alert(t('games.deleteManyTitle', { count }), t('games.deleteManyBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          for (const game of pickedGames) repo.deleteSession(game.session.id).forEach((path) => removeFile(path));
          stopSelecting();
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <BackIcon />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {t('games.title')}
        </Text>
        {/* Selecting (2026-11-22), as on a recording's screen: "Todos"/"Limpar" in amber, and an ✕ to stop. */}
        {selecting ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={allPicked ? t('summary.clearSelection') : t('summary.selectAll')}
              onPress={pickAll}
              style={styles.pill}>
              <Text style={[styles.pillText, styles.pillTextAccent]}>{allPicked ? t('summary.clear') : t('summary.all')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('summary.cancelSelection')}
              onPress={stopSelecting}
              style={styles.close}>
              <CloseIcon size={18} />
            </Pressable>
          </>
        ) : games.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setSelecting(true)} style={styles.pill}>
            <Text style={styles.pillText}>{t('games.select')}</Text>
          </Pressable>
        ) : null}
      </View>
      {games.length > 0 ? (
        <View style={styles.filters}>
          {hasReceived ? (
            <>
              <Chip label={t('received.all')} selected={filter === 'all'} onPress={() => setFilter('all')} />
              <Chip label={t('received.mine')} selected={filter === 'mine'} onPress={() => setFilter('mine')} />
              <Chip label={t('received.receivedFilter')} selected={filter === 'received'} onPress={() => setFilter('received')} />
            </>
          ) : null}
          <View style={styles.filtersEnd} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('games.dateFilter')}
            onPress={() => setPickingDay(true)}
            style={[styles.calendar, day !== undefined && styles.calendarOn]}>
            <CalendarIcon size={18} color={day !== undefined ? colors.onAccent : colors.text} />
          </Pressable>
        </View>
      ) : null}
      {dayShown ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('games.clearDate', { day: dayShown.title })}
          onPress={() => setDay(undefined)}
          style={styles.dayChip}>
          <Text style={styles.dayChipText}>{dayShown.title}</Text>
          <CloseIcon size={14} color={colors.accent} />
        </Pressable>
      ) : null}
      <SectionList
        sections={sections}
        keyExtractor={(g) => g.session.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <EmptyState icon={<ReplayIcon color={colors.accent} size={40} />} title={t('games.emptyTitle')} message={t('games.emptyMessage')} />
        }
        renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
        extraData={[selecting, picked, lastSeenId]}
        renderItem={({ item }) => {
          const ended = item.session.endedAt !== undefined;
          return (
            <GameCard
              session={item.session}
              clips={item.clips}
              firstClip={item.firstClip}
              recordedMs={item.recordedMs}
              now={now}
              lastSeen={item.session.id === lastSeenId}
              selecting={selecting && ended}
              selected={picked.includes(item.session.id)}
              onPress={() => (selecting ? ended && toggle(item.session.id) : router.push(`/session/${item.session.id}`))}
              onLongPress={
                ended && !selecting
                  ? () => {
                      setSelecting(true);
                      setPicked([item.session.id]);
                    }
                  : undefined
              }
            />
          );
        }}
      />
      {/* A calendar (2026-11-21): any past day, month or year, the days with recordings lit. */}
      <DateFilterSheet
        visible={pickingDay}
        onClose={() => setPickingDay(false)}
        days={days}
        selected={day}
        onPick={setDay}
        locale={locale}
        now={now}
      />
      {/* No "Nova gravação" (2026-11-22): the camera is the screen under this one, one back away. */}
      {/* Selecting: the same bar as a recording's clips (2026-11-22): Compartilhar on the left, Apagar on the right. */}
      {selecting ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PickBar
            text={
              pickedGames.length === 0
                ? t('games.tapRecordings')
                : t('games.selectedRecordings', { count: pickedGames.length })
            }
            left={
              SHARING_ENABLED
                ? [
                    {
                      label: t('summary.shareButton'),
                      hint: pickedGames.length > 1 ? t('games.shareOne') : undefined,
                      disabled: !shareable,
                      onPress: () => void shareRecording(),
                      icon: <LinkShareIcon size={26} color={colors.accent} />,
                    },
                  ]
                : []
            }
            right={[
              {
                label: pickedGames.length === 0 ? t('common.delete') : t('games.deleteMany', { count: pickedGames.length }),
                disabled: pickedGames.length === 0,
                onPress: confirmDelete,
                icon: <TrashIcon size={26} color={colors.accent} />,
              },
            ]}
          />
        </SafeAreaView>
      ) : (
        // Room for the home bar under the list (the screen's own safe area leaves the bottom to the selection bar).
        <SafeAreaView edges={['bottom']} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground, paddingHorizontal: footer.side, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 30, color: colors.text },
  pill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  pillTextAccent: { color: colors.accent },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filtersEnd: { flex: 1 },
  calendar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(255,176,0,0.14)',
  },
  dayChipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent },
  list: { gap: 8, paddingBottom: 24 },
  day: {
    paddingTop: 10,
    paddingLeft: 4,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.1,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  // Edge to edge over the screen's side margins, as on a recording's clips.
  footer: {
    marginHorizontal: -footer.side,
    paddingHorizontal: footer.side - 4,
    paddingTop: 6,
    paddingBottom: footer.bottom,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
