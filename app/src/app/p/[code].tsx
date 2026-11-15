import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PartnerResult } from '../../components/PartnerResult';
import { useT } from '../../i18n/useT';
import { type ApplyResult, applyPartnerCode, partner } from '../../partner';
import { activatePartnerDiscount } from '../../partner/activate';
import { colors, fonts } from '../../theme/tokens';

/** Where `reprizeapp.com/p/CODE` and `reprize://p/CODE` land: applies the partner code and shows what it gives. */
export default function PartnerLink() {
  const { t } = useT();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const [result, setResult] = useState<ApplyResult | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void applyPartnerCode(code ?? '', 'link').then(setResult);
  }, [code]);

  // Opened straight from a link there is no screen behind this one: replace it, so closing never returns here.
  const close = () => router.replace('/');

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.role}>{t('partner.title')}</Text>
        {result === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <PartnerResult
            result={result}
            name={partner.current()?.name}
            onActivate={() => void activatePartnerDiscount(t)}
            onClose={close}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  body: { flex: 1, padding: 20, gap: 16, justifyContent: 'center', alignItems: 'stretch' },
  role: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.muted, textAlign: 'center' },
});
