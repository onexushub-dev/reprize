import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';

type Props = {
  visible: boolean;
  /** "Cortar o lance primeiro": the switch stays off and the cut is there to drag. */
  onCut: (hideNextTime: boolean) => void;
  /** "Seguir o clipe todo": Seguir a Bola goes on for the cut as it is. */
  onGo: (hideNextTime: boolean) => void;
  onClose: () => void;
};

/**
 * Seguir a Bola's first-use sheet (spec 2026-11-09 §4.1, layout B1): what it does and why to cut first. Shown on every
 * first tap of the switch until "Não mostrar de novo" is kept on (it starts on), as `PrepareSheet`.
 */
export function BallIntroSheet({ visible, onCut, onGo, onClose }: Props) {
  const { t } = useT();
  const [hide, setHide] = useState(true);
  const rows = [
    { title: t('clip.ballIntroCutTitle'), body: t('clip.ballIntroCutBody') },
    { title: t('clip.ballIntroOnceTitle'), body: t('clip.ballIntroOnceBody') },
    { title: t('clip.ballIntroPostTitle'), body: t('clip.ballIntroPostBody') },
  ];
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={t('common.cancel')} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text accessibilityRole="header" style={styles.title}>
            {t('clip.ballIntroTitle')}
          </Text>
          <Text style={styles.intro}>{t('clip.ballIntroBody')}</Text>
          <View style={styles.list}>
            {rows.map((row, i) => (
              <View key={row.title} style={styles.row}>
                <View style={styles.number}>
                  <Text style={styles.numberText}>{i + 1}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowBody}>{row.body}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={styles.toggle}>
            <Text style={styles.toggleText}>{t('clip.ballIntroDontShow')}</Text>
            <Switch
              value={hide}
              onValueChange={setHide}
              accessibilityLabel={t('clip.ballIntroDontShow')}
              trackColor={{ true: colors.accent, false: colors.border }}
            />
          </View>
          <Button label={t('clip.ballIntroCut')} onPress={() => onCut(hide)} />
          <Button label={t('clip.ballIntroGo')} variant="secondary" onPress={() => onGo(hide)} />
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
    gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.text, marginTop: 6, textTransform: 'uppercase' },
  intro: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.soft, marginTop: -6 },
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.ground },
  number: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  numberText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.onAccent },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  rowBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted },
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
});
