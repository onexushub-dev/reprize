import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';
import { BatteryIcon, NoCaseIcon, SunIcon } from './icons';

type Props = {
  visible: boolean;
  /** "Entendi, começar": `hideNextTime` = the player kept "Não mostrar de novo" on. */
  onStart: (hideNextTime: boolean) => void;
  onClose: () => void;
};

/** The tip's icon, a stroke icon in the accent. */
function TipIcon({ kind }: { kind: 'case' | 'sun' | 'battery' }) {
  if (kind === 'case') return <NoCaseIcon color={colors.accent} size={24} />;
  if (kind === 'sun') return <SunIcon color={colors.accent} size={24} />;
  return <BatteryIcon color={colors.accent} size={24} />;
}

/**
 * Before the first recording (2026-11-08 spec): how to keep the iPhone steady for a whole game, as advice for a better
 * recording, never as a problem of the app. Shown until the player turns "Não mostrar de novo" on (it starts on).
 */
export function PrepareSheet({ visible, onStart, onClose }: Props) {
  const { t } = useT();
  const [hide, setHide] = useState(true);
  const tips: { kind: 'case' | 'sun' | 'battery'; title: string; body: string }[] = [
    { kind: 'case', title: t('prepare.caseTitle'), body: t('prepare.caseBody') },
    { kind: 'sun', title: t('prepare.sunTitle'), body: t('prepare.sunBody') },
    { kind: 'battery', title: t('prepare.batteryTitle'), body: t('prepare.batteryBody') },
  ];
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={t('common.cancel')} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text accessibilityRole="header" style={styles.title}>
            {t('prepare.title')}
          </Text>
          <Text style={styles.intro}>{t('prepare.intro')}</Text>
          <View style={styles.list}>
            {tips.map((tip) => (
              <View key={tip.kind} style={styles.row}>
                <View style={styles.icon}>
                  <TipIcon kind={tip.kind} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{tip.title}</Text>
                  <Text style={styles.rowBody}>{tip.body}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={styles.toggle}>
            <Text style={styles.toggleText}>{t('prepare.dontShow')}</Text>
            <Switch
              value={hide}
              onValueChange={setHide}
              accessibilityLabel={t('prepare.dontShow')}
              trackColor={{ true: colors.accent, false: colors.border }}
            />
          </View>
          <Button label={t('prepare.start')} onPress={() => onStart(hide)} />
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
  title: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.text, marginTop: 6 },
  intro: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.soft, marginTop: -6 },
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.ground },
  icon: { width: 28, alignItems: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  rowBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted },
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
});
