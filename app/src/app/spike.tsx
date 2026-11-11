// Etapa 0 spike screen: exercises the ReplayCamera module for the field test. Not the product UI.
import * as Device from 'expo-device';
import { Directory, File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  addReplayListener,
  ReplayCameraView,
  requestPermissions,
  saveClip,
  setGestureTrace,
  startSession,
  stopSession,
  type ThermalLevel,
  type TriggerSource,
} from '../../modules/replay-camera';
import { createGestureTest } from '../diag/gestureTest';
import { DIAGNOSTICS_ENABLED } from '../diag/diagLog';
import { Redirect } from 'expo-router';

const bufferDir = new Directory(Paths.cache, 'replay-buffer');
/** Zooms to test with (0.5 = ultra-wide) and the real distances the tester can mark, in metres. */
const ZOOMS = [0.5, 0.7, 1, 2];
const DISTANCES = [3, 5, 8, 10, 12, 15, 18, 20, 25, 30];
/** What the tester is trying, marked before each series so the report can tell the gestures apart. */
const KINDS = ['aceno alto', 'aceno baixo', 'aceno + palmas', 'palmas', 'T', 'jogo normal'];
const QUALITY = '1080p60';
const EMPTY_COUNTS: Record<TriggerSource, number> = { screen: 0, gesture: 0, remote: 0, watch: 0, voice: 0, phone: 0 };

function bufferMb(): number {
  try {
    const bytes = bufferDir.list().reduce((sum, item) => sum + (item.size ?? 0), 0);
    return Math.round(bytes / (1024 * 1024));
  } catch {
    return 0;
  }
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Team-only: in store builds (no diagnostics) a deep link to /spike lands on the home screen. */
export default function Spike() {
  if (!DIAGNOSTICS_ENABLED) return <Redirect href="/" />;
  return <SpikeScreen />;
}

function SpikeScreen() {
  useKeepAwake();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [clips, setClips] = useState(0);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [thermal, setThermal] = useState<ThermalLevel>('nominal');
  const [degraded, setDegraded] = useState(false);
  const [mb, setMb] = useState(0);
  const [maxMb, setMaxMb] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [received, setReceived] = useState(0);
  const [starting, setStarting] = useState(false);
  const [pose, setPose] = useState('');
  const saving = useRef(false);
  // Gesture test: every gesture sample, the marked distances and the triggers, for the report to share.
  const test = useRef(createGestureTest());
  const [zoom, setZoom] = useState(1); // the app opens at 1x
  const [distance, setDistance] = useState<number | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [testLine, setTestLine] = useState('');

  const note = (line: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 6));

  async function save(source: TriggerSource) {
    if (saving.current) return note(`gatilho ${source} ignorado: já salvando`);
    saving.current = true;
    try {
      const clip = await saveClip({ source, at: Date.now() });
      setClips((c) => c + 1);
      setLastMs(clip.durationMs);
      setCounts((c) => ({ ...c, [source]: c[source] + 1 }));
      note(`salvo via ${source}: ${(clip.durationMs / 1000).toFixed(1)}s`);
    } catch (e: any) {
      note(`erro ao salvar: ${e?.code ?? e}`);
    } finally {
      saving.current = false;
    }
  }

  // Every native trigger is counted on arrival, so a missed X and a failed save can be told apart.
  const onTrigger = useEffectEvent((source: TriggerSource) => {
    test.current.fire(source);
    setReceived((n) => n + 1);
    note(`gatilho recebido: ${source}`);
    save(source);
  });

  useEffect(() => {
    const subs = [
      addReplayListener('onTrigger', (e) => onTrigger(e.source)),
      addReplayListener('onThermalChange', (e) => {
        setThermal(e.level);
        setDegraded(e.degraded);
        note(`temperatura: ${e.level}${e.degraded ? ' (720p30)' : ''}`);
      }),
      addReplayListener('onGestureDebug', (e) =>
        setPose(
          `pose: ${e.people} pessoa(s) · analisadas ${e.posed ?? '?'} · dos tiles ${e.fromTiles ?? '?'} · menor ${e.smallestPx ?? '?'} px · ${e.samples}/s · ori ${e.orientation}` +
            (e.people > 0
              ? ` · conf ${(e.minConf ?? 0).toFixed(2)} · faltam [${e.missing ?? ''}] · pulsos acima do nariz ${e.wristGap ?? '?'} ombros (precisa > 0.35) · cotovelos acima ${e.elbowsUp ?? '?'} · braços ${e.isX} · mãos no alto ${e.raised ?? '?'} · aceno ${e.waved ?? '?'}`
              : '')
        )
      ),
      addReplayListener('onGestureTrace', (e) => test.current.addTrace(e)),
      addReplayListener('onInterrupted', () => note('interrompido')),
      addReplayListener('onResumed', () => note('retomado')),
      // Native errors after start always end the session.
      addReplayListener('onError', (e) => {
        setStartedAt(null);
        note(`erro (sessão encerrada): ${e.code} ${e.message}`);
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      setGestureTrace(false);
    };
  }, []);

  useEffect(() => {
    if (startedAt === null) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      setTestLine(test.current.summary());
    }, 1000);
    const disk = setInterval(() => {
      const current = bufferMb();
      setMb(current);
      setMaxMb((m) => Math.max(m, current));
    }, 5000);
    return () => {
      clearInterval(tick);
      clearInterval(disk);
    };
  }, [startedAt]);

  async function toggle() {
    if (startedAt !== null) {
      setGestureTrace(false);
      await stopSession();
      setStartedAt(null);
      note('parado');
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      if (!(await requestPermissions())) return note('permissão negada');
      await startSession({ lens: 'ultraWide', zoom, maxQuality: QUALITY });
      setGestureTrace(true);
      setStartedAt(Date.now());
      setClips(0);
      setCounts(EMPTY_COUNTS);
      setReceived(0);
      setMaxMb(0);
      note('gravando');
    } catch (e: any) {
      note(`erro ao iniciar: ${e?.code ?? e}`);
    } finally {
      setStarting(false);
    }
  }

  const running = startedAt !== null;

  function markDistance(meters: number | null) {
    setDistance(meters);
    test.current.mark(meters);
    note(meters === null ? 'distância real: sem marca' : `distância real: ${meters} m`);
  }

  function markKind(next: string | null) {
    setKind(next);
    test.current.kind(next);
    note(next === null ? 'gesto: sem marca' : `gesto: ${next}`);
  }

  function shareTest() {
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const file = new File(Paths.cache, `gesto-teste-${stamp}.txt`);
      if (!file.exists) file.create();
      file.write(test.current.report({ device: `${Device.modelName ?? 'iPhone'} (iOS ${Device.osVersion ?? '?'})`, zoom, quality: QUALITY }));
      shareAsync(file.uri, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle: 'Teste do gesto' }).catch(() => {});
    } catch (e) {
      note(`erro ao compartilhar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function confirmClear() {
    Alert.alert('Limpar o teste do gesto?', 'As amostras, as distâncias marcadas e os gatilhos registrados serão apagados.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Limpar',
        style: 'destructive',
        onPress: () => {
          test.current.clear();
          setDistance(null);
          setKind(null);
          setTestLine('');
        },
      },
    ]);
  }

  return (
    <View style={styles.root}>
      <ReplayCameraView style={StyleSheet.absoluteFill} />
      <View style={styles.panel}>
        <Text style={styles.stat}>
          {running ? clock(now - startedAt) : '--:--:--'} · {clips} lances · último{' '}
          {lastMs === null ? '-' : `${(lastMs / 1000).toFixed(1)}s`}
        </Text>
        <Text style={styles.stat}>
          salvos: tela {counts.screen} · gesto {counts.gesture} · controle {counts.remote} · relógio{' '}
          {counts.watch} · celular {counts.phone} · gatilhos recebidos {received}
        </Text>
        <Text style={styles.stat}>
          temp {thermal}
          {degraded ? ' (720p30)' : ''} · buffer {mb} MB (máx {maxMb})
        </Text>
        {pose ? <Text style={styles.stat}>{pose}</Text> : null}
        {testLine ? <Text style={styles.stat}>{testLine}</Text> : null}
        {log.map((line) => (
          <Text key={line} style={styles.log}>
            {line}
          </Text>
        ))}
      </View>
      <View style={styles.testPanel}>
        {running ? null : (
          <View style={styles.chips}>
            <Text style={styles.chipLabel}>zoom</Text>
            {ZOOMS.map((z) => (
              <Pressable key={z} style={[styles.chip, zoom === z && styles.chipOn]} onPress={() => setZoom(z)}>
                <Text style={[styles.chipText, zoom === z && styles.chipTextOn]}>{z}x</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={styles.chips}>
          <Text style={styles.chipLabel}>distância real</Text>
          <Pressable style={[styles.chip, distance === null && styles.chipOn]} onPress={() => markDistance(null)}>
            <Text style={[styles.chipText, distance === null && styles.chipTextOn]}>—</Text>
          </Pressable>
          {DISTANCES.map((m) => (
            <Pressable key={m} style={[styles.chip, distance === m && styles.chipOn]} onPress={() => markDistance(m)}>
              <Text style={[styles.chipText, distance === m && styles.chipTextOn]}>{m}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.chips}>
          <Text style={styles.chipLabel}>gesto</Text>
          <Pressable style={[styles.chip, kind === null && styles.chipOn]} onPress={() => markKind(null)}>
            <Text style={[styles.chipText, kind === null && styles.chipTextOn]}>—</Text>
          </Pressable>
          {KINDS.map((k) => (
            <Pressable key={k} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => markKind(k)}>
              <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{k}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.testActions}>
          <Pressable style={[styles.button, styles.toggle, styles.small]} onPress={shareTest}>
            <Text style={styles.buttonText}>Compartilhar teste</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.toggle, styles.small]} onPress={confirmClear}>
            <Text style={styles.buttonText}>Limpar teste</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.toggle, starting && styles.disabled]}
          disabled={starting}
          onPress={toggle}>
          <Text style={styles.buttonText}>{running ? 'Parar' : 'Iniciar'}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.save, !running && styles.disabled]}
          disabled={!running}
          onPress={() => {
            test.current.fire('screen');
            save('screen');
          }}>
          <Text style={styles.saveText}>Salvar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  panel: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    gap: 4,
  },
  stat: { color: '#FFFFFF', fontSize: 14, fontVariant: ['tabular-nums'] },
  log: { color: '#B3B3B3', fontSize: 12 },
  actions: { position: 'absolute', bottom: 40, left: 16, right: 16, flexDirection: 'row', gap: 12 },
  button: { height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  toggle: { flex: 1, backgroundColor: '#141414' },
  save: { flex: 2, backgroundColor: '#FFB000' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  saveText: { color: '#0A0A0A', fontSize: 20, fontWeight: '800' },
  testPanel: { position: 'absolute', bottom: 120, left: 12, right: 12, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chipLabel: { color: '#FFFFFF', fontSize: 13, marginRight: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)' },
  chipOn: { backgroundColor: '#FFB000' },
  chipText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: '#0A0A0A' },
  testActions: { flexDirection: 'row', gap: 12 },
  small: { height: 44 },
});
