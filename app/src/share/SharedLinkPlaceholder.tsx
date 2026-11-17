import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DIAGNOSTICS_ENABLED } from '../diag/diagLog';

/**
 * Phase 0 of sharing: what a shared link opens until the received recording exists. Diagnostics builds show the code,
 * so the team can check the Universal Link; store builds go to the home screen.
 */
export default function SharedLinkPlaceholder() {
  const params = useLocalSearchParams<{ code: string }>();
  if (!DIAGNOSTICS_ENABLED) return <Redirect href="/" />;
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Link recebido</Text>
      <Text style={styles.code}>{params.code}</Text>
      <Text style={styles.note}>O link abriu o app. A tela de verdade chega na fase 1.</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace('/')}>
        <Text style={styles.buttonText}>Ir para o início</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  code: { color: '#FFB000', fontSize: 16, fontVariant: ['tabular-nums'] },
  note: { color: '#D9D9D9', fontSize: 14, textAlign: 'center' },
  button: { marginTop: 12, height: 52, borderRadius: 14, paddingHorizontal: 24, backgroundColor: '#FFB000', justifyContent: 'center' },
  buttonText: { color: '#0A0A0A', fontSize: 16, fontWeight: '800' },
});
