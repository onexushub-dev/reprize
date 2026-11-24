import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { colors, fonts } from '../theme/tokens';
import { useT } from '../i18n/useT';
import { INSETS } from './insets';

type Props = {
  /** The video, laid out for the space between the top bar and the panel. */
  renderStage: (area: { width: number; height: number }) => ReactNode;
  onCancel: () => void;
  onDone: () => void;
  /** The open tool's panel. */
  panel: ReactNode;
  /** Play + trim bar, always shown while editing. */
  cut: ReactNode;
  toolBar: ReactNode;
};

/** Edit mode: Cancelar · EDITAR · Concluir, the video, the open tool's panel, the cut and the tool bar. */
export function ClipEdit({ renderStage, onCancel, onDone, panel, cut, toolBar }: Props) {
  const { t } = useT();
  const window = useWindowDimensions();
  // Until the stage is measured, about the space it gets; the video shows once it is measured, so it never jumps from
  // the guess to its place (2026-11-22: the "blink" when Editar was tapped).
  const [area, setArea] = useState(() => ({ width: window.width, height: Math.round(window.height * 0.45) }));
  const [measured, setMeasured] = useState(false);
  return (
    <View style={[styles.root, { paddingTop: INSETS.top, paddingBottom: INSETS.bottom }]}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={onCancel} hitSlop={8} style={styles.cancel}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('clip.editTitle')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('clip.done')} onPress={onDone} hitSlop={8} style={styles.done}>
          <Text style={styles.doneText}>{t('clip.done')}</Text>
        </Pressable>
      </View>
      <View
        style={styles.stage}
        onLayout={(e) => {
          setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
          setMeasured(true);
        }}>
        <View style={[styles.fill, !measured && styles.hidden]}>{renderStage(area)}</View>
      </View>
      <View style={styles.panel}>{panel}</View>
      <View style={styles.cut}>{cut}</View>
      <View style={styles.tools}>{toolBar}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  top: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancel: { minHeight: 44, justifyContent: 'center' },
  cancelText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  title: { fontFamily: fonts.displayBold, fontSize: 20, letterSpacing: 0.8, color: colors.text },
  done: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.accent,
    justifyContent: 'center',
  },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.onAccent },
  stage: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
  hidden: { opacity: 0 },
  panel: { paddingHorizontal: 16, paddingTop: 12 },
  cut: { paddingHorizontal: 16, paddingTop: 12, gap: 6 },
  tools: { marginTop: 10, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.surface },
});
