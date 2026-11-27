import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { PhoneSideways, PhoneUpright } from '../components/PhoneDrawings';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';

type Props = { visible: boolean; onClose: () => void };

/**
 * Why Bola is not offered on a clip recorded upright (design-bola-vertical, 2026-11-27): the video already fills the
 * 9:16 frame, so there is nowhere for the camera to go; recorded sideways it can follow the ball. Opened from the dimmed
 * Bola card; "Entendi" closes it. Styled as `BallIntroSheet`.
 */
export function BallVerticalSheet({ visible, onClose }: Props) {
  const { t } = useT();
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={t('common.cancel')} style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet} testID="ball-vertical-sheet">
          <View style={styles.grabber} />
          <Text accessibilityRole="header" style={styles.title}>
            {t('clip.ballVerticalTitle')}
          </Text>
          <View style={styles.row}>
            <View style={styles.card}>
              <View style={styles.art}>
                <PhoneUpright framed />
              </View>
              <View style={styles.text}>
                <Text style={styles.cardTitle}>{t('clip.ballVerticalUprightTitle')}</Text>
                <Text style={styles.cardBody}>{t('clip.ballVerticalUprightBody')}</Text>
              </View>
            </View>
            <View style={[styles.card, styles.cardGood]}>
              <View style={styles.art}>
                <PhoneSideways />
              </View>
              <View style={styles.text}>
                <Text style={[styles.cardTitle, { color: colors.accent }]}>{t('clip.ballVerticalSidewaysTitle')}</Text>
                <Text style={styles.cardBody}>{t('clip.ballVerticalSidewaysBody')}</Text>
              </View>
            </View>
          </View>
          <Button label={t('clip.ballVerticalOk')} onPress={onClose} />
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
    gap: 16,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32, color: colors.text, marginTop: 6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: 10 },
  card: {
    flex: 1,
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.ground,
    backgroundColor: colors.ground,
  },
  cardGood: { borderColor: colors.accent },
  art: { height: 112, alignItems: 'center', justifyContent: 'center' },
  text: { gap: 4 },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text, textAlign: 'center' },
  cardBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted, textAlign: 'center' },
});
