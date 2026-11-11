import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SportIcon, TickIcon } from '../../components/sportIcons';
import type { RecordingSportId } from '../../data/schema';
import { hasBallModel, RECORDING_SPORTS, type SportHow } from '../../focus/sportCheck';
import type { MessageKey } from '../../i18n';
import { useT } from '../../i18n/useT';
import { colors, fonts, radius } from '../../theme/tokens';

/** Each sport's name in the catalog. */
export const SPORT_LABEL: Record<RecordingSportId, MessageKey> = {
  basquete: 'clip.sportBasquete',
  beachTennis: 'clip.sportBeachTennis',
  tenis: 'clip.sportTenis',
  futevolei: 'clip.sportFutevolei',
  futebol: 'clip.sportFutebol',
  volei: 'clip.sportVolei',
  voleiPraia: 'clip.sportVoleiPraia',
  handebol: 'clip.sportHandebol',
  outro: 'clip.sportOutro',
};

/**
 * The recording's sport (spec 2026-11-11 §3, S2): one row per sport, the chosen one ticked. A sport worked out by itself
 * comes first, on an amber-tinted row with "IDENTIFICADO"; not known = nothing ticked. A tap chooses and closes.
 */
export function SportSheet({
  visible,
  sport,
  how,
  onChoose,
  onClose,
}: {
  visible: boolean;
  sport: RecordingSportId | undefined;
  how: SportHow | undefined;
  onChoose: (sport: RecordingSportId) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const detected = how === 'detected' ? sport : undefined;
  const order = detected !== undefined ? [detected, ...RECORDING_SPORTS.filter((s) => s !== detected)] : RECORDING_SPORTS;
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('clip.sportSheetClose')} onPress={onClose} style={styles.scrim} />
      <SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.head}>
          <Text style={styles.title}>{t('clip.sportSheetTitle')}</Text>
          <Text style={styles.hint}>{t('clip.sportSheetHint')}</Text>
        </View>
        <ScrollView bounces={false}>
          <View accessibilityRole="radiogroup">
            {order.map((id) => {
              const chosen = sport === id;
              const first = detected === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityLabel={t(SPORT_LABEL[id])}
                  accessibilityState={{ checked: chosen }}
                  onPress={() => onChoose(id)}
                  style={[styles.row, first ? styles.rowDetected : null]}>
                  <SportIcon sport={id} size={22} color={chosen || first ? colors.accent : colors.soft} />
                  <View style={styles.rowText}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name}>{t(SPORT_LABEL[id])}</Text>
                      {first ? (
                        <View style={styles.pill}>
                          <Text style={styles.pillText}>{t('clip.sportDetectedPill')}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.modes}>{t(hasBallModel(id) ? 'clip.sportModesBall' : 'clip.sportModesPlayers')}</Text>
                  </View>
                  {chosen ? <TickIcon /> : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 10,
    paddingBottom: 12,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#3A3A3A' },
  head: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 4 },
  title: { fontFamily: fonts.displayBold, fontSize: 24, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.text },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  rowDetected: { backgroundColor: '#1E1A10', marginBottom: 6 },
  rowText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  modes: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  pill: { borderRadius: 9, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 7, paddingVertical: 2 },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.3, color: colors.accent },
});
