import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CloseIcon } from '../components/icons';
import { ProgressRing, TickIcon } from '../components/sportIcons';
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
  /** Just got ready while on screen: "✓ Bola encontrada" for a moment (spec 2026-11-11, P1). */
  | { kind: 'found' }
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
 * Seguir a Bola on the clip screen (spec 2026-11-11, P1): while it works a pill "Rastreando a bola · 62%" with a ring and
 * ✕ (in the editor the progress is on the Bola card instead); "✓ Bola encontrada" for a moment once ready, then
 * "Seguir a Bola · 9:16".
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
  if (state.kind === 'found') {
    return (
      <View pointerEvents="none" style={styles.wrap}>
        <View style={[styles.chip, styles.found]} accessibilityRole="text">
          <TickIcon size={16} />
          <Text style={[styles.text, styles.foundText]}>{t('clip.ballFound')}</Text>
        </View>
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
  let percent: number | undefined;
  if (p && p.state === 'cooling') label = t('clip.ballCooling');
  else if (p && p.state === 'running' && p.total > 0 && p.done > 0) {
    percent = ballEstimate(p, now).percent;
    label = t('clip.ballAnalysing', { percent });
  }
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.chip} accessibilityRole="progressbar" accessibilityLabel={label}>
        {percent !== undefined ? <ProgressRing progress={percent / 100} size={20} /> : <ActivityIndicator size="small" color={colors.accent} />}
        <Text style={styles.text}>{label}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('clip.ballCancel')} hitSlop={10} onPress={onCancel} style={styles.stop}>
          <CloseIcon size={12} />
        </Pressable>
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
  text: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text },
  found: { borderWidth: 1, borderColor: colors.accent },
  foundText: { color: colors.accent, fontFamily: fonts.bodyBold },
  stop: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
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
