import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { PartnerResult } from '../components/PartnerResult';
import { useT } from '../i18n/useT';
import { type ApplyResult, applyPartnerCode, partner } from '../partner';
import { activatePartnerDiscount } from '../partner/activate';
import { colors, fonts, radius } from '../theme/tokens';

/** "Tenho um código de indicação": the typed way in, for iPhone installs and codes heard by word of mouth. */
export default function PartnerTyped() {
  const { t } = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const apply = async () => {
    if (text.trim() === '' || busy) return;
    setBusy(true);
    try {
      setResult(await applyPartnerCode(text, 'typed'));
    } finally {
      setBusy(false);
    }
  };

  const showForm = result === null || result === 'invalid';

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.body}>
          <Text style={styles.role}>{t('partner.title')}</Text>
          {showForm ? (
            <>
              <TextInput
                accessibilityLabel={t('partner.placeholder')}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!busy}
                maxLength={64}
                onChangeText={setText}
                onSubmitEditing={() => void apply()}
                placeholder={t('partner.placeholder')}
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                style={styles.input}
                value={text}
              />
              {result === 'invalid' ? <Text style={styles.warning}>{t('partner.invalidText')}</Text> : null}
              <Button label={t('partner.apply')} loading={busy} onPress={() => void apply()} />
              <Button label={t('common.close')} variant="secondary" onPress={close} />
            </>
          ) : (
            <PartnerResult
              result={result}
              name={partner.current()?.name}
              discountPercent={partner.current()?.discountPercent}
              onActivate={() => void activatePartnerDiscount(t)}
              onClose={close}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  body: { flex: 1, padding: 20, gap: 16, justifyContent: 'center', alignItems: 'stretch' },
  role: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.muted, textAlign: 'center' },
  input: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    letterSpacing: 3,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: 16,
    minHeight: 64,
    textAlign: 'center',
  },
  warning: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 23, color: colors.warning, textAlign: 'center' },
});
