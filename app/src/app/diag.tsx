// TEMP(diag-remote): Bluetooth remote investigation; this whole file goes with its commit.
import { Redirect, router } from 'expo-router';
import { shareAsync } from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { bluetoothConnected } from '../../modules/replay-camera';
import { Button } from '../components/Button';
import {
  DIAGNOSTICS_ENABLED,
  diag,
  diagClear,
  diagFileUri,
  diagFlags,
  diagSubscribe,
  diagText,
  setDiagFlags,
} from '../diag/diagLog';
import { colors, fonts, radius } from '../theme/tokens';

/**
 * Diagnóstico (Bluetooth remote investigation; temporary, Portuguese only): the in-app log, a switch to record without
 * screen economy, and the log's file for the share sheet (AirDrop to the Mac, WhatsApp…).
 */
export default function Diag() {
  // Builds without REPRIZE_DIAGNOSTICS=1 have no such screen: a deep link lands on the home screen.
  if (!DIAGNOSTICS_ENABLED) return <Redirect href="/" />;
  return <DiagScreen />;
}

function DiagScreen() {
  const [text, setText] = useState(() => diagText());
  const [economyOff, setEconomyOff] = useState(() => diagFlags().economyOff);
  const [volumePathOff, setVolumePathOff] = useState(() => diagFlags().volumePathOff);
  const [gestureOff, setGestureOff] = useState(() => diagFlags().gestureOff);

  useEffect(() => diagSubscribe(() => setText(diagText())), []);

  // Can the app see the Bluetooth selfie remote at all (BLE, connected now)? The answer goes to the log.
  const [probe, setProbe] = useState<string>();
  const probeBluetooth = () => {
    setProbe('Procurando…');
    bluetoothConnected(true)
      .then((r) => {
        const found =
          r === undefined
            ? 'sem suporte neste aparelho'
            : r.devices.length === 0
              ? `Bluetooth ${r.state}, nenhum aparelho BLE conectado visível`
              : `Bluetooth ${r.state}, conectados: ${r.devices.map((d) => `${d.name} [${d.services.join(', ')}]`).join('; ')}`;
        diag(`bluetooth: ${found}`);
        setProbe(found);
      })
      .catch((e: unknown) => {
        diag(`bluetooth: falhou (${String(e)})`);
        setProbe('Falhou');
      });
  };

  const toggleEconomy = (off: boolean) => {
    setEconomyOff(off);
    setDiagFlags({ ...diagFlags(), economyOff: off });
  };

  // Presses only as capture events: shows whether the volume path keeps them from arriving. Takes effect at the next
  // recording (the remote starts listening again).
  const toggleVolumePath = (off: boolean) => {
    setVolumePathOff(off);
    setDiagFlags({ ...diagFlags(), volumePathOff: off });
  };

  // Two recordings in the same conditions, with and without the gesture: how much heat and battery it costs. Takes
  // effect at the next recording.
  const toggleGesture = (off: boolean) => {
    setGestureOff(off);
    setDiagFlags({ ...diagFlags(), gestureOff: off });
  };

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
  const count = all.length;
  // Newest on top here; the shared file stays in order.
  const newestFirst = all.slice().reverse().join('\n');

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.title}>Diagnóstico</Text>
        <Text style={styles.note}>
          Registra o controle Bluetooth, o áudio, o calor e a tela durante as gravações. Depois de um teste, toque em
          Compartilhar e mande o arquivo.
        </Text>

        <View style={styles.row}>
          <Text style={styles.rowName}>Desligar a economia de tela nas gravações</Text>
          <Switch
            value={economyOff}
            onValueChange={toggleEconomy}
            trackColor={{ true: colors.accent, false: colors.surface }}
            accessibilityLabel="Desligar a economia de tela nas gravações"
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.rowName}>Desligar o caminho pelo volume (só captura)</Text>
          <Switch
            value={volumePathOff}
            onValueChange={toggleVolumePath}
            trackColor={{ true: colors.accent, false: colors.surface }}
            accessibilityLabel="Desligar o caminho pelo volume (só captura)"
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.rowName}>Desligar o gesto nas gravações (medir calor e bateria)</Text>
          <Switch
            value={gestureOff}
            onValueChange={toggleGesture}
            trackColor={{ true: colors.accent, false: colors.surface }}
            accessibilityLabel="Desligar o gesto nas gravações"
          />
        </View>

        <View style={styles.probe}>
          <Button label="Procurar o controle no Bluetooth" variant="secondary" onPress={probeBluetooth} />
          {probe !== undefined ? <Text style={styles.note}>{probe}</Text> : null}
        </View>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button label="Compartilhar" onPress={share} />
          </View>
          <View style={styles.action}>
            <Button label="Limpar" variant="secondary" onPress={confirmClear} />
          </View>
        </View>

        <Text style={styles.count}>{count} linhas (mais recentes no topo)</Text>
        <ScrollView style={styles.log} contentContainerStyle={styles.logBody}>
          <Text selectable style={styles.logText}>
            {count === 0 ? 'Nada registrado ainda.' : newestFirst}
          </Text>
        </ScrollView>

        <Button label="Voltar" variant="secondary" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  body: { flex: 1, padding: 20, gap: 12 },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 34, color: colors.text },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.soft },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  rowName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 12 },
  probe: { gap: 6 },
  action: { flex: 1 },
  count: { fontFamily: fonts.body, fontSize: 13, color: colors.soft },
  log: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.card },
  logBody: { padding: 12 },
  logText: { fontFamily: 'Menlo', fontSize: 11, lineHeight: 16, color: colors.text },
});
