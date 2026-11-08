// TEMP(diag-remote): field-test diagnostics; this whole file goes with its commit.
import { Redirect, router } from 'expo-router';
import { shareAsync } from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DIAG_AREAS,
  type DiagArea,
  DIAGNOSTICS_ENABLED,
  diagClear,
  diagFileUri,
  diagSubscribe,
  diagText,
  parseLine,
} from '../diag/diagLog';
import { colors, fonts, radius } from '../theme/tokens';

/** What the log shows: everything, only warnings, or one area (2026-11-08 spec §6). */
type Filter = 'TODOS' | 'ALERTAS' | DiagArea;

/**
 * Diagnóstico (field tests; temporary, Portuguese only): the in-app log, filtered by area, and its file for the share
 * sheet (AirDrop to the Mac, WhatsApp…). As much of the screen as possible goes to the lines.
 */
export default function Diag() {
  // Builds without REPRIZE_DIAGNOSTICS=1 have no such screen: a deep link lands on the home screen.
  if (!DIAGNOSTICS_ENABLED) return <Redirect href="/" />;
  return <DiagScreen />;
}

function DiagScreen() {
  const [text, setText] = useState(() => diagText());
  const [filter, setFilter] = useState<Filter>('TODOS');

  useEffect(() => diagSubscribe(() => setText(diagText())), []);

  const share = () => {
    const uri = diagFileUri();
    if (uri === undefined) {
      Alert.alert('Não foi possível abrir o arquivo do diagnóstico.');
      return;
    }
    shareAsync(uri, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle: 'Diagnóstico do Reprize' }).catch(
      () => {},
    );
  };

  const confirmClear = () =>
    Alert.alert('Limpar o diagnóstico?', 'Todas as linhas registradas até agora serão apagadas.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Limpar', style: 'destructive', onPress: diagClear },
    ]);

  const all = text.length === 0 ? [] : text.split('\n');
  const parsed = all.map((line) => ({ line, ...parseLine(line) }));
  const present = DIAG_AREAS.filter((a) => parsed.some((p) => p.area === a));
  const filters: Filter[] = ['TODOS', 'ALERTAS', ...present];
  const shown = parsed.filter((p) => filter === 'TODOS' || (filter === 'ALERTAS' ? p.warn : p.area === filter));
  // Newest on top here; the shared file stays in order and complete.
  const newestFirst = shown
    .map((p) => p.line)
    .reverse()
    .join('\n');

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12} style={styles.headerButton}>
            <Text style={styles.link}>Voltar</Text>
          </Pressable>
          <Text style={styles.title}>Diagnóstico</Text>
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="button" onPress={confirmClear} hitSlop={8} style={styles.headerButton}>
              <Text style={styles.linkSoft}>Limpar</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={share} hitSlop={8} style={styles.headerButton}>
              <Text style={styles.link}>Compartilhar</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filters}>
          {filters.map((f) => (
            <Pressable
              key={f}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === f }}
              onPress={() => setFilter(f)}
              hitSlop={{ top: 8, bottom: 8 }}
              style={[styles.filter, filter === f ? styles.filterOn : null]}>
              <Text style={[styles.filterText, filter === f ? styles.filterTextOn : null]}>
                {f === 'TODOS' ? 'Todos' : f === 'ALERTAS' ? '⚠ Alertas' : f}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.count}>
          {shown.length} linhas{filter === 'TODOS' ? '' : ` de ${all.length}`} · mais recentes no topo
        </Text>
        <ScrollView style={styles.log} contentContainerStyle={styles.logBody}>
          <Text selectable style={styles.logText}>
            {shown.length === 0 ? 'Nada registrado ainda.' : newestFirst}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  body: { flex: 1, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 8 },
  headerActions: { flexDirection: 'row', gap: 16 },
  headerButton: { minHeight: 44, justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
  link: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.accent },
  linkSoft: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.soft },
  // A horizontal ScrollView grows to fill a column: held at its content's height.
  filterBar: { flexGrow: 0, flexShrink: 0 },
  filters: { gap: 6, alignItems: 'center' },
  filter: {
    height: 28,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  filterOn: { backgroundColor: colors.accent },
  filterText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.text },
  filterTextOn: { color: colors.ground },
  count: { fontFamily: fonts.body, fontSize: 12, color: colors.soft },
  log: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.card },
  logBody: { padding: 10 },
  logText: { fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 15, color: colors.text },
});
