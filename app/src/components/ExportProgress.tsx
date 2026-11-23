import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { type AppLocale, currentLocale, translate } from '../i18n';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { GLASS } from './GlassButton';

export type ExportJob = {
  kind: 'save' | 'share' | 'compile';
  stage: 'preparing' | 'joining' | 'delivering';
  /** A batch: how many clips are finished of how many. */
  step?: { done: number; total: number };
  /** How far the video (or the batch) is, 0..1, once the phone reports it (2026-11-23). */
  progress?: number;
  /** Cancelar was tapped: the button reads "Cancelando…" and waits until the video stops. */
  cancelling?: boolean;
};

export function exportTitle(job: ExportJob, locale: AppLocale = currentLocale()): string {
  if (job.stage === 'joining') return translate(locale, 'batch.joining');
  if (job.stage === 'preparing') {
    if (job.step) return translate(locale, 'batch.preparing', { done: Math.min(job.step.done + 1, job.step.total), total: job.step.total });
    return translate(locale, 'clip.exportPreparing');
  }
  return translate(locale, job.kind === 'save' ? 'clip.exportSaving' : 'clip.exportSharing');
}

type Props = { job: ExportJob; /** Stops the export: a Cancelar under the ring while the video is being made. */ onCancel?: () => void };

const PIE = 46;

/** The ring of the iPhone's "Baixando…" card: an outline with an amber wedge growing inside it. */
function Pie({ progress }: { progress: number }) {
  const c = PIE / 2;
  const r = c - 6;
  const p = Math.max(0, Math.min(1, progress));
  const angle = p * 2 * Math.PI;
  const x = c + r * Math.sin(angle);
  const y = c - r * Math.cos(angle);
  const wedge = p >= 0.999 ? undefined : `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
  return (
    <Svg width={PIE} height={PIE} viewBox={`0 0 ${PIE} ${PIE}`} accessibilityElementsHidden>
      <Circle cx={c} cy={c} r={c - 1.5} stroke="rgba(255,255,255,0.55)" strokeWidth={2.5} fill="none" />
      <Circle cx={c} cy={c} r={r} fill="rgba(255,255,255,0.10)" />
      {wedge === undefined ? <Circle cx={c} cy={c} r={r} fill={colors.accent} /> : p > 0 ? <Path d={wedge} fill={colors.accent} /> : null}
    </Svg>
  );
}

/**
 * The card over the screen while a video is made and handed over (2026-11-23, after the iPhone's own): glass, the
 * title at the top, a ring filling in amber with the percent, and Cancelar while the video is still being made.
 */
export function ExportProgress({ job, onCancel }: Props) {
  const { t, locale } = useT();
  const title = exportTitle(job, locale);
  const making = job.stage !== 'delivering';
  const progress = making ? job.progress : 1;
  const percent = progress === undefined ? undefined : Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const cancel = making && onCancel !== undefined ? onCancel : undefined;
  return (
    <View pointerEvents={cancel ? 'box-none' : 'none'} style={styles.wrap}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={title}
        accessibilityValue={percent === undefined ? undefined : { min: 0, max: 100, now: percent }}
        style={[styles.card, !making && styles.cardTitleOnly]}>
        <Text style={[styles.title, !making && styles.titleOnly]}>{title}</Text>
        {/* Once the video is made (gallery write, share sheet) only the title is left: the ring has nothing to say. */}
        {making ? (
          <View style={styles.middle}>
            {percent === undefined ? (
              <View style={styles.spinner} testID="export-spinner">
                <ActivityIndicator size="large" color={colors.accent} />
              </View>
            ) : (
              <View testID="export-ring">
                <Pie progress={percent / 100} />
              </View>
            )}
            {percent !== undefined ? <Text style={styles.percent}>{`${percent}%`}</Text> : null}
          </View>
        ) : null}
        {cancel ? (
          job.cancelling === true ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('clip.exportCancelling')}
              accessibilityState={{ disabled: true, busy: true }}
              disabled
              style={[styles.cancel, styles.cancelling]}>
              <Text style={[styles.cancelText, styles.cancellingText]}>{t('clip.exportCancelling')}</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={cancel} style={styles.cancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: 300,
    gap: 18,
    paddingTop: 22,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderRadius: 30,
    backgroundColor: 'rgba(36,36,36,0.94)',
    borderWidth: 1,
    borderColor: GLASS.rim,
    borderTopColor: GLASS.rimTop,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text, paddingHorizontal: 6 },
  // Only the title (handing over): centred, with the same room above and below.
  cardTitleOnly: { paddingBottom: 22 },
  titleOnly: { textAlign: 'center' },
  middle: { alignItems: 'center', gap: 8 },
  spinner: { width: PIE, height: PIE, alignItems: 'center', justifyContent: 'center' },
  percent: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  cancel: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  cancelText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.text },
  cancelling: { backgroundColor: 'rgba(255,255,255,0.06)' },
  cancellingText: { color: colors.muted },
});
