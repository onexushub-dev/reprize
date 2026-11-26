import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import type { BatchCard } from '../share/useBatchActions';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';

type Props = {
  card: BatchCard;
  onClose: () => void;
};

/** What a batch ended with when it needs saying: a failure, or clips that did not come out. */
export function BatchResultCard({ card, onClose }: Props) {
  const { t } = useT();
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View accessibilityRole="alert" style={styles.card}>
        <Text style={styles.text}>{card.text}</Text>
        {card.detail ? <Text style={styles.timing}>{card.detail}</Text> : null}
        <Button label={t('common.close')} variant="secondary" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: 'rgba(12,12,12,0.96)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text, textAlign: 'center' },
  timing: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: 'center' },
});
