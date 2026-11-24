import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppLocale } from '../i18n';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { ChevronIcon } from './icons';

/** A day that has recordings: `key` is its `Date.toDateString()`. */
export type RecordedDay = { key: string; at: number; count: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  days: RecordedDay[];
  selected?: string;
  /** A day picked, or undefined for every date. */
  onPick: (key: string | undefined) => void;
  locale: AppLocale;
  /** The clock (today's mark, the last month offered). */
  now: number;
};

type Month = { year: number; month: number };

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const monthIndex = (m: Month) => m.year * 12 + m.month;
const monthOf = (at: number): Month => {
  const d = new Date(at);
  return { year: d.getFullYear(), month: d.getMonth() };
};

/**
 * Filtrar por data as a calendar (2026-11-21): month by month, back to the first recording, the days with recordings
 * lit (the others can't be picked); a tap on the month opens a month and year picker to jump far back.
 */
export function DateFilterSheet({ visible, onClose, days, selected, onPick, locale, now }: Props) {
  const { t } = useT();
  const counts = new Map(days.map((d) => [d.key, d.count]));
  const latest = monthOf(now);
  const earliest = days.length > 0 ? monthOf(Math.min(...days.map((d) => d.at))) : latest;
  const selectedDay = selected === undefined ? undefined : days.find((d) => d.key === selected);
  const start = selectedDay !== undefined ? monthOf(selectedDay.at) : days.length > 0 ? monthOf(days[0].at) : latest;
  const [shownMonth, setShown] = useState<Month>(start);
  const [choosing, setChoosing] = useState(false);
  // Opened again: from the picked day's month (or the newest recording's).
  const [openedFor, setOpenedFor] = useState(visible);
  if (visible !== openedFor) {
    setOpenedFor(visible);
    if (visible) {
      setShown(start);
      setChoosing(false);
    }
  }

  const canBack = monthIndex(shownMonth) > monthIndex(earliest);
  const canNext = monthIndex(shownMonth) < monthIndex(latest);
  const step = (by: number) => {
    const index = monthIndex(shownMonth) + by;
    setShown({ year: Math.floor(index / 12), month: index % 12 });
  };
  const monthTitle = capital(
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(shownMonth.year, shownMonth.month, 1)),
  );

  // Weekday initials from a known Sunday, so they follow the language (the week starts on Sunday, as in Brazil).
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2026, 10, 22 + i)),
  );
  const firstWeekday = new Date(shownMonth.year, shownMonth.month, 1).getDay();
  const length = new Date(shownMonth.year, shownMonth.month + 1, 0).getDate();
  const cells: (number | undefined)[] = [
    ...Array.from({ length: firstWeekday }, () => undefined),
    ...Array.from({ length }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(undefined);
  const today = new Date(now).toDateString();
  const dayLabel = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });

  const pick = (key: string | undefined) => {
    onPick(key);
    onClose();
  };

  const years: number[] = [];
  for (let y = latest.year; y >= earliest.year; y -= 1) years.push(y);
  const monthHas = (m: Month) => days.some((d) => {
    const at = monthOf(d.at);
    return at.year === m.year && at.month === m.month;
  });

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={t('common.close')} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text accessibilityRole="header" style={styles.title}>
            {t('games.dateFilter')}
          </Text>

          <View style={styles.head}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('games.previousMonth')}
              accessibilityState={{ disabled: !canBack }}
              disabled={!canBack || choosing}
              hitSlop={8}
              onPress={() => step(-1)}
              style={[styles.arrow, (!canBack || choosing) && styles.off]}>
              <View style={styles.flip}>
                <ChevronIcon size={20} />
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('games.pickMonth', { month: monthTitle })}
              accessibilityState={{ expanded: choosing }}
              onPress={() => setChoosing(!choosing)}
              style={styles.monthButton}>
              <Text style={styles.month}>{monthTitle}</Text>
              <View style={choosing ? styles.up : styles.down}>
                <ChevronIcon size={14} color={colors.accent} />
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('games.nextMonth')}
              accessibilityState={{ disabled: !canNext }}
              disabled={!canNext || choosing}
              hitSlop={8}
              onPress={() => step(1)}
              style={[styles.arrow, (!canNext || choosing) && styles.off]}>
              <ChevronIcon size={20} />
            </Pressable>
          </View>

          {choosing ? (
            <View testID="month-picker" style={styles.picker}>
              <View style={styles.years}>
                {years.map((year) => (
                  <Pressable
                    key={year}
                    accessibilityRole="button"
                    accessibilityState={{ selected: year === shownMonth.year }}
                    onPress={() => {
                      const month = Math.min(year === latest.year ? latest.month : 11, shownMonth.month);
                      setShown({ year, month: year === earliest.year ? Math.max(month, earliest.month) : month });
                    }}
                    style={[styles.year, year === shownMonth.year && styles.yearOn]}>
                    <Text style={[styles.yearText, year === shownMonth.year && styles.yearTextOn]}>{year}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.months}>
                {Array.from({ length: 12 }, (_, month) => {
                  const m = { year: shownMonth.year, month };
                  const inRange = monthIndex(m) >= monthIndex(earliest) && monthIndex(m) <= monthIndex(latest);
                  const has = monthHas(m);
                  const name = new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(m.year, month, 1)).replace('.', '');
                  return (
                    <Pressable
                      key={month}
                      accessibilityRole="button"
                      accessibilityLabel={capital(new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(m.year, month, 1)))}
                      accessibilityState={{ disabled: !inRange, selected: month === shownMonth.month }}
                      disabled={!inRange}
                      onPress={() => {
                        setShown(m);
                        setChoosing(false);
                      }}
                      style={[styles.monthCell, month === shownMonth.month && styles.monthCellOn, !inRange && styles.off]}>
                      <Text style={[styles.monthCellText, has && styles.monthCellHas, month === shownMonth.month && styles.monthCellTextOn]}>
                        {capital(name)}
                      </Text>
                      {has ? <View style={[styles.dot, month === shownMonth.month && styles.dotOn]} /> : <View style={styles.dotSpace} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            <View testID="calendar">
              <View style={styles.week}>
                {weekdays.map((w, i) => (
                  <Text key={i} style={styles.weekday}>
                    {w.toUpperCase()}
                  </Text>
                ))}
              </View>
              <View style={styles.grid}>
                {cells.map((d, i) => {
                  if (d === undefined) return <View key={i} style={styles.cell} />;
                  const date = new Date(shownMonth.year, shownMonth.month, d);
                  const key = date.toDateString();
                  const count = counts.get(key);
                  const on = key === selected;
                  return (
                    <View key={i} style={styles.cell}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          count !== undefined
                            ? `${dayLabel.format(date)}, ${t('games.dayCount', { count })}`
                            : dayLabel.format(date)
                        }
                        accessibilityState={{ disabled: count === undefined, selected: on }}
                        disabled={count === undefined}
                        onPress={() => pick(key)}
                        style={[styles.dayButton, key === today && styles.today, on && styles.dayOn]}>
                        <Text style={[styles.dayText, count !== undefined && styles.dayHas, on && styles.dayTextOn]}>{d}</Text>
                        {count !== undefined ? <View style={[styles.dot, on && styles.dotOn]} /> : <View style={styles.dotSpace} />}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: selected === undefined }}
            onPress={() => pick(undefined)}
            style={[styles.all, selected === undefined && styles.allOn]}>
            <Text style={[styles.allText, selected === undefined && styles.allTextOn]}>{t('games.allDates')}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground },
  flip: { transform: [{ rotate: '180deg' }] },
  off: { opacity: 0.3 },
  monthButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12 },
  month: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
  down: { transform: [{ rotate: '90deg' }] },
  up: { transform: [{ rotate: '-90deg' }] },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 12, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  dayButton: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1, borderColor: colors.border },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, opacity: 0.6 },
  dayHas: { fontFamily: fonts.bodyBold, color: colors.text, opacity: 1 },
  dayTextOn: { color: colors.onAccent },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent, marginTop: 2 },
  dotOn: { backgroundColor: colors.onAccent },
  dotSpace: { height: 7 },
  picker: { gap: 12 },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  year: { height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center', backgroundColor: colors.ground },
  yearOn: { backgroundColor: colors.accent },
  yearText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  yearTextOn: { color: colors.onAccent },
  months: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  monthCell: { width: '25%', height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  monthCellOn: { backgroundColor: colors.accent },
  monthCellText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  monthCellHas: { fontFamily: fonts.bodyBold, color: colors.text },
  monthCellTextOn: { color: colors.onAccent },
  all: { minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground },
  allOn: { borderWidth: 1, borderColor: colors.accent },
  allText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  allTextOn: { color: colors.accent },
});
