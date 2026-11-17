// Sharing spike 1 (docs/superpowers/specs/2026-11-16-recording-sharing-design.md, §5.4 and §10): does a whole ended
// recording upload through the system's background session with the screen locked and the signal dropping, and pick up
// again without losing finished clips? Team-only, like /spike. Not the product UI.
// Open with reprize://spike-upload on a diagnostics build.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import {
  addReplayListener,
  resetUploads,
  startUploads,
  uploadState,
  type UploadEntry,
} from '../../modules/replay-camera';
import { kv, repo } from '../data/mmkv';
import { DIAGNOSTICS_ENABLED } from '../diag/diagLog';
import type { Clip, Session } from '../data/schema';

/** The last run, kept so a relaunch can still check the files in the cloud. */
const RUN_KEY = 'spike.upload.run';
type Run = { run: string; startedAt: number; sessionId: string; heads: Record<string, string>; names: Record<string, string> };
type Signed = { run: string; items: { key: string; put: string; head: string }[] };

const extra = (Constants.expoConfig && Constants.expoConfig.extra) || {};
const supabase: { url?: string; key?: string } = extra.supabase || {};
const spikeKey: string | undefined = extra.spikeKey;

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',');
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Ended recordings with clips, newest first: only an ended recording can be shared (decision 16). */
function endedRecordings(): { session: Session; clips: Clip[] }[] {
  return repo
    .listSessions()
    .filter((item) => item.session.endedAt !== undefined && item.clips > 0)
    .map((item) => ({ session: item.session, clips: repo.listClips(item.session.id) }))
    .sort((a, b) => b.session.startedAt - a.session.startedAt)
    .slice(0, 5);
}

function loadRun(): Run | null {
  const raw = kv.getString(RUN_KEY);
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as Run;
  } catch {
    return null;
  }
}

/** Team-only: in store builds (no diagnostics) a deep link to /spike-upload lands on the home screen. */
export default function SpikeUpload() {
  if (!DIAGNOSTICS_ENABLED) return <Redirect href="/" />;
  return <SpikeUploadScreen />;
}

function SpikeUploadScreen() {
  const [recordings] = useState(endedRecordings);
  const [picked, setPicked] = useState(recordings.length > 0 ? recordings[0].session.id : '');
  const [run, setRun] = useState<Run | null>(loadRun);
  const [entries, setEntries] = useState<UploadEntry[]>(uploadState);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Record<string, string>>({});
  // The clock the elapsed time is read against, moved every second while the screen is open.
  const [now, setNow] = useState(() => Date.now());

  const note = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 40));
  const refresh = () => setEntries(uploadState());

  useEffect(() => {
    const subs = [
      addReplayListener('onUploadProgress', () => refresh()),
      addReplayListener('onUploadDone', (e) => {
        const name = run ? run.names[e.id] : e.id;
        note(`${name || e.id}: ${e.ok ? 'enviado' : `falhou (${e.error || e.httpStatus})`} · tentativa ${e.attempts}`);
        refresh();
      }),
      addReplayListener('onUploadRetry', (e) => note(`nova tentativa ${e.attempt + 1}: ${e.error}`)),
    ];
    const app = AppState.addEventListener('change', (state) => {
      note(`app: ${state}`);
      if (state === 'active') refresh();
    });
    return () => {
      subs.forEach((s) => s.remove());
      app.remove();
    };
  }, [run]);

  const recording = recordings.find((r) => r.session.id === picked);
  const mine = run ? entries.filter((e) => run.heads[e.id] !== undefined) : [];
  const total = mine.reduce((sum, e) => sum + e.bytes, 0);
  const sent = mine.reduce((sum, e) => sum + (e.status === 'done' ? e.bytes : e.sent), 0);
  const done = mine.filter((e) => e.status === 'done').length;
  const failed = mine.filter((e) => e.status === 'failed').length;
  const ends = mine.map((e) => e.finishedAt || 0);
  const lastEnd = mine.length > 0 && done + failed === mine.length ? Math.max(...ends) : 0;
  const elapsed = run ? (lastEnd > 0 ? lastEnd : now) - run.startedAt : 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function send() {
    if (!recording) return;
    if (!supabase.url || !supabase.key || !spikeKey) {
      note('faltam REPRIZE_SUPABASE_URL, REPRIZE_SUPABASE_KEY ou REPRIZE_SPIKE_KEY no .env.local');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${supabase.url}/functions/v1/spike-sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: supabase.key, 'x-spike-key': spikeKey },
        body: JSON.stringify({ count: recording.clips.length }),
      });
      if (!response.ok) throw new Error(`spike-sign ${response.status}: ${await response.text()}`);
      const signed = (await response.json()) as Signed;
      resetUploads();
      const heads: Record<string, string> = {};
      const names: Record<string, string> = {};
      const items = recording.clips.map((clip, i) => {
        heads[clip.id] = signed.items[i].head;
        names[clip.id] = `clipe ${String(i + 1).padStart(2, '0')}`;
        return { id: clip.id, path: clip.path, url: signed.items[i].put, contentType: 'video/mp4' };
      });
      const next: Run = { run: signed.run, startedAt: Date.now(), sessionId: recording.session.id, heads, names };
      kv.set(RUN_KEY, JSON.stringify(next));
      setRun(next);
      setChecks({});
      if (!startUploads(items)) throw new Error('esta build não tem o envio em segundo plano');
      note(`envio começou: ${items.length} clipes`);
      refresh();
    } catch (error) {
      note(`erro: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  /** Asks the cloud for each file's size and compares it with the file on the phone. */
  async function verify() {
    if (!run) return;
    const result: Record<string, string> = {};
    for (const entry of mine) {
      try {
        const head = await fetch(run.heads[entry.id], { method: 'HEAD' });
        const length = Number(head.headers.get('content-length'));
        if (!head.ok) result[entry.id] = `HTTP ${head.status}`;
        else result[entry.id] = length === entry.bytes ? 'igual ao do celular' : `diferente (${length} de ${entry.bytes})`;
      } catch (error) {
        result[entry.id] = String(error);
      }
    }
    setChecks(result);
    note('conferência na nuvem feita');
  }

  function report(): string {
    const rate = elapsed > 0 ? (sent * 8) / (elapsed / 1000) / 1e6 : 0;
    return [
      'Reprize · teste 1: envio em segundo plano',
      `Aparelho: ${Device.modelName} · ${Platform.OS} ${Device.osVersion}`,
      `Gravação: ${recording ? recording.session.name || recording.session.id : run ? run.sessionId : '-'}`,
      `Clipes: ${done} enviados, ${failed} com falha, de ${mine.length}`,
      `Total: ${mb(total)} MB em ${secs(elapsed)} (${rate.toFixed(1).replace('.', ',')} Mbps)`,
      '',
      ...mine.map((e) => {
        const name = run ? run.names[e.id] : e.id;
        const time = e.finishedAt && e.startedAt ? secs(e.finishedAt - e.startedAt) : '-';
        const check = checks[e.id] ? ` · nuvem: ${checks[e.id]}` : '';
        return `${name}: ${e.status} · ${mb(e.bytes)} MB · ${time} · ${e.attempts} tentativa(s)${e.error ? ` · ${e.error}` : ''}${check}`;
      }),
      '',
      ...log,
    ].join('\n');
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>Voltar</Text>
        </Pressable>
        <Text style={styles.title}>Teste 1 · envio em segundo plano</Text>
      </View>

      <Text style={styles.label}>Gravação encerrada</Text>
      {recordings.length === 0 ? <Text style={styles.step}>Grave, salve alguns clipes e encerre a gravação antes.</Text> : null}
      <View style={styles.chips}>
        {recordings.map((r) => (
          <Pressable
            key={r.session.id}
            accessibilityRole="button"
            style={[styles.chip, r.session.id === picked && styles.chipOn]}
            onPress={() => setPicked(r.session.id)}>
            <Text style={[styles.chipText, r.session.id === picked && styles.chipTextOn]}>
              {new Date(r.session.startedAt).toLocaleString().slice(0, 16)} · {r.clips.length} clipes
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={busy || !recording}
        style={[styles.button, styles.primary, (busy || !recording) && styles.disabled]}
        onPress={() => void send()}>
        <Text style={styles.primaryText}>{busy ? 'Preparando…' : 'Enviar gravação'}</Text>
      </Pressable>

      {run ? (
        <View style={styles.panel}>
          <Text style={styles.stat}>
            {done} de {mine.length} enviados{failed > 0 ? ` · ${failed} com falha` : ''}
          </Text>
          <Text style={styles.stat}>
            {mb(sent)} de {mb(total)} MB · {secs(elapsed)}
          </Text>
          {mine.map((e) => (
            <Text key={e.id} style={styles.row}>
              {run.names[e.id]} · {mb(e.bytes)} MB ·{' '}
              {e.status === 'done' ? 'ok' : e.status === 'failed' ? 'falhou' : `${Math.round((e.sent / Math.max(e.bytes, 1)) * 100)}%`}
              {e.attempts > 1 ? ` · ${e.attempts} tentativas` : ''}
              {checks[e.id] ? ` · nuvem: ${checks[e.id]}` : ''}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={[styles.button, styles.secondary]} onPress={() => void verify()}>
          <Text style={styles.secondaryText}>Conferir na nuvem</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={[styles.button, styles.secondary]} onPress={() => void Share.share({ message: report() })}>
          <Text style={styles.secondaryText}>Relatório</Text>
        </Pressable>
      </View>

      <Text style={styles.step}>Rodada A. Toque em Enviar e bloqueie a tela na hora. Desbloqueie depois de 2 minutos: os clipes devem estar enviados.</Text>
      <Text style={styles.step}>Rodada B. Envie de novo, ligue o modo avião no meio por 30 s e desligue. O envio deve continuar sozinho.</Text>
      <Text style={styles.step}>Rodada C. Envie de novo e vá para outro app (sem fechar o Reprize) por 2 minutos.</Text>
      <Text style={styles.step}>Em cada rodada: Conferir na nuvem, depois Relatório. Não feche o app pelo multitarefa: o iOS cancela o envio nesse caso.</Text>

      {log.map((line, i) => (
        <Text key={`${i}-${line}`} style={styles.log}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  content: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 48, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  back: { color: '#FFB000', fontSize: 16, fontWeight: '600' },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  label: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#141414' },
  chipOn: { backgroundColor: '#FFB000' },
  chipText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: '#0A0A0A' },
  button: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primary: { backgroundColor: '#FFB000' },
  primaryText: { color: '#0A0A0A', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  panel: { padding: 12, borderRadius: 12, backgroundColor: '#141414', gap: 4 },
  stat: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  row: { color: '#D9D9D9', fontSize: 13, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 12 },
  secondary: { flex: 1, backgroundColor: '#141414', borderWidth: 1, borderColor: '#FFB000' },
  secondaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  step: { color: '#D9D9D9', fontSize: 14, lineHeight: 20 },
  log: { color: '#B3B3B3', fontSize: 12 },
});
