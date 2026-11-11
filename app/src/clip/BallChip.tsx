import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CloseIcon } from '../components/icons';
import { ballEstimate, type BallProgress } from '../focus/ballQueue';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { SCRIM } from './IconButton';

/**
 * What the chip says: ready, waiting, analysing (with its progress), cooling the phone, failed, or not available on
 * this video (test 47a: the clip went back to Modo Foco; the Foco panel says why).
 */
export type BallChipState =
  | { kind: 'ready'; sparse: boolean }
  | { kind: 'working'; progress: BallProgress | undefined }
  | { kind: 'failed'; hot: boolean }
  | { kind: 'unsuitable' };

type Props = {
  state: BallChipState;
  /** ✕ while it works: Seguir a Bola off (what was found is kept). */
  onCancel: () => void;
  /** A tap on a failed chip: try again. */
  onRetry: () => void;
};

/** How often the estimate is redrawn while nothing new arrives. */
const TICK_MS = 1000;

/**
 * Seguir a Bola on the video (spec 2026-11-09 §4.1, layouts A2/A3): the progress only here, never in the panel — a chip
 * with the percentage and the time left, a thin bar and ✕; "Seguir a Bola · 9:16" once ready.
 */
export function BallChip({ state, onCancel, onRetry }: Props) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  const working = state.kind === 'working';
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [working]);

  if (state.kind === 'ready') {
    return (
      <View pointerEvents="none" style={styles.wrap}>
        <View style={styles.chip}>
          <View style={styles.dot} />
          <Text style={styles.text}>{t('clip.ballTag')}</Text>
        </View>
        {state.sparse ? <Text style={styles.sparse}>{t('clip.ballSparse')}</Text> : null}
      </View>
    );
  }
  if (state.kind === 'unsuitable') {
    return (
      <View pointerEvents="none" style={styles.wrap}>
        <View style={styles.chip}>
          <Text style={styles.text}>{t('clip.ballUnsuitable')}</Text>
        </View>
      </View>
    );
  }
  if (state.kind === 'failed') {
    return (
      <View pointerEvents="box-none" style={styles.wrap}>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.chip}>
          <Text style={styles.text}>{state.hot ? t('clip.ballHot') : t('clip.ballFailed')}</Text>
        </Pressable>
      </View>
    );
  }
  const p = state.progress;
  let label = t('clip.ballWaiting');
  let fraction = 0;
  if (p && p.state === 'cooling') label = t('clip.ballCooling');
  // started, before the first frames are counted (an older clip's Modo Foco file made again first, test 50)
  else if (p && p.state === 'running' && p.total === 0) label = t('clip.ballPreparing');
  else if (p && p.state !== 'waiting' && p.total > 0) {
    const e = ballEstimate(p, now);
    label = t('clip.ballAnalysing', { percent: e.percent, seconds: e.secondsLeft });
    fraction = e.percent / 100;
  }
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.chip} accessibilityRole="progressbar" accessibilityLabel={label}>
        <Text style={styles.text}>{label}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('clip.ballCancel')} hitSlop={10} onPress={onCancel}>
          <CloseIcon size={14} />
        </Pressable>
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 10, left: 10, right: 10, alignItems: 'center', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: SCRIM,
    overflow: 'hidden',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  text: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 12, color: colors.text },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  fill: { height: 2, backgroundColor: colors.accent },
  sparse: {
    maxWidth: 300,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
    backgroundColor: SCRIM,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
